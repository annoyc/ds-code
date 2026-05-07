import type { CreateMessageFn, RlmConfig, RlmUsage, RpcRequest, RpcResponse } from "./types.js";

const DEFAULT_CONFIG: RlmConfig = {
	childModel: "deepseek-v4-flash",
	maxDepth: 1,
	maxBatch: 16,
	timeoutMs: 120_000,
	temperature: 0.4,
	topP: 0.9,
	maxTokens: 4096,
};

export class RlmBridge {
	private config: RlmConfig;
	private createMessage: CreateMessageFn;
	private depthRemaining: number;
	private cumulativeUsage: RlmUsage = { inputTokens: 0, outputTokens: 0 };

	constructor(
		createMessage: CreateMessageFn,
		config?: Partial<RlmConfig>,
		depthRemaining?: number,
	) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.createMessage = createMessage;
		this.depthRemaining = depthRemaining ?? this.config.maxDepth;
	}

	getUsage(): RlmUsage {
		return { ...this.cumulativeUsage };
	}

	resetUsage(): void {
		this.cumulativeUsage = { inputTokens: 0, outputTokens: 0 };
	}

	private mergeUsage(other: RlmUsage): void {
		this.cumulativeUsage.inputTokens += other.inputTokens;
		this.cumulativeUsage.outputTokens += other.outputTokens;
	}

	async dispatchLlm(prompt: string, system?: string): Promise<string> {
		const timeoutMs = this.config.timeoutMs;
		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		const timeoutPromise = new Promise<never>((_, reject) => {
			timeoutId = setTimeout(() => {
				reject(new Error(`llm_query timed out after ${timeoutMs}ms`));
			}, timeoutMs);
		});
		try {
			const response = await Promise.race([
				this.createMessage({
					model: this.config.childModel,
					system,
					messages: [{ role: "user", content: prompt }],
					maxTokens: this.config.maxTokens,
					temperature: this.config.temperature,
					topP: this.config.topP,
					stream: false,
				}),
				timeoutPromise,
			]);
			this.cumulativeUsage.inputTokens += response.usage.input;
			this.cumulativeUsage.outputTokens += response.usage.output;
			return response.content;
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			throw new Error(`llm_query failed: ${message}`);
		} finally {
			if (timeoutId !== undefined) clearTimeout(timeoutId);
		}
	}

	async dispatchLlmBatch(prompts: string[], system?: string): Promise<string[]> {
		if (prompts.length === 0) return [];
		const max = this.config.maxBatch;
		if (prompts.length > max) {
			const msg = `batch too large: ${prompts.length} > ${max}`;
			return prompts.map(() => msg);
		}
		const settled = await Promise.allSettled(prompts.map((p) => this.dispatchLlm(p, system)));
		return settled.map((s) =>
			s.status === "fulfilled" ? s.value : `Error: ${String((s as PromiseRejectedResult).reason)}`,
		);
	}

	async dispatchRlm(prompt: string, system?: string): Promise<string> {
		if (this.depthRemaining === 0) {
			return this.dispatchLlm(prompt, system);
		}
		const { RlmRepl } = await import("./repl.js");
		const childBridge = new RlmBridge(this.createMessage, this.config, this.depthRemaining - 1);
		const repl = new RlmRepl(childBridge);
		await repl.start();
		try {
			const answer = await repl.runTurn(prompt, "");
			this.mergeUsage(childBridge.getUsage());
			return answer;
		} finally {
			await repl.stop();
		}
	}

	async dispatch(request: RpcRequest): Promise<RpcResponse> {
		switch (request.method) {
			case "FINAL":
				return { type: "final", result: request.params.result };
			case "llm_query":
				try {
					const result = await this.dispatchLlm(request.params.prompt, request.params.system);
					return { type: "single", result };
				} catch (e) {
					const message = e instanceof Error ? e.message : String(e);
					return { type: "error", message };
				}
			case "llm_query_batched": {
				const results = await this.dispatchLlmBatch(
					request.params.prompts,
					request.params.system,
				);
				return { type: "batch", results };
			}
			case "rlm_query":
				try {
					const result = await this.dispatchRlm(request.params.prompt, request.params.system);
					return { type: "single", result };
				} catch (e) {
					const message = e instanceof Error ? e.message : String(e);
					return { type: "error", message };
				}
		}
	}
}

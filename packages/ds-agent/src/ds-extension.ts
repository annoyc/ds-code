import { randomUUID } from "node:crypto";
import {
	type CostCurrency,
	CostTracker,
	type CreateMessageFn,
	type CreateMessageRequest,
	calculateTurnCost,
	createRlmToolDefinition,
	createSubAgentTools,
	ExecPolicyEngine,
	formatCostEstimate,
	LspClient,
	type Ruleset,
	SideGitSnapshots,
	SubAgentManager,
	type SubAgentResult,
} from "@deepseek/ds-core";
import { type DsConfig, getSessionsDir } from "./config.js";
import { isYoloMode } from "./modes/yolo-mode.js";

interface ToolCallEvent {
	type: "tool_call";
	toolCallId: string;
	toolName: string;
	input: Record<string, unknown>;
}

interface ToolCallEventResult {
	block?: boolean;
	reason?: string;
}

interface ToolResultEvent {
	type: "tool_result";
	toolCallId: string;
	toolName: string;
	input: Record<string, unknown>;
	content: Array<{ type: string; text?: string }>;
	isError: boolean;
}

interface ToolResultEventResult {
	content?: Array<{ type: string; text: string }>;
}

interface TurnEndEvent {
	type: "turn_end";
	turnIndex: number;
	message: {
		role: string;
		usage?: {
			input: number;
			output: number;
			cacheRead: number;
			cacheWrite?: number;
			totalTokens?: number;
		};
		model?: string;
	};
}

interface TurnStartEvent {
	type: "turn_start";
	turnIndex: number;
	timestamp: number;
}

interface SessionStartEvent {
	type: "session_start";
}

interface SessionShutdownEvent {
	type: "session_shutdown";
}

interface ExtensionContext {
	cwd: string;
}

interface AgentToolResult {
	content: Array<{ type: "text"; text: string }>;
	isError?: boolean;
}

type ExtensionHandler<E, R = void> = (event: E, ctx: ExtensionContext) => Promise<R | undefined> | R | undefined;

interface ExtensionAPI {
	on(event: "tool_call", handler: ExtensionHandler<ToolCallEvent, ToolCallEventResult>): void;
	on(event: "tool_result", handler: ExtensionHandler<ToolResultEvent, ToolResultEventResult>): void;
	on(event: "turn_start", handler: ExtensionHandler<TurnStartEvent>): void;
	on(event: "turn_end", handler: ExtensionHandler<TurnEndEvent>): void;
	on(event: "session_start", handler: ExtensionHandler<SessionStartEvent>): void;
	on(event: "session_shutdown", handler: ExtensionHandler<SessionShutdownEvent>): void;
	on(event: string, handler: ExtensionHandler<any, any>): void;
	registerTool(tool: any): void;
	registerCommand(
		name: string,
		options: { description?: string; handler: (ctx: ExtensionContext) => Promise<void> | void },
	): void;
}

export function createDsExtensionFactory(config: DsConfig, sharedCostTracker?: CostTracker) {
	const costTracker = sharedCostTracker ?? new CostTracker();
	const policyEngine = buildExecPolicyEngine(config);
	const isYolo = isYoloMode();
	const currency = config.costCurrency as CostCurrency;
	const modelId = config.model;

	return (pi: ExtensionAPI) => {
		pi.on("tool_call", (_event: ToolCallEvent) => {
			if (isYolo) {
				return { block: false };
			}

			if (_event.toolName === "bash" && policyEngine) {
				const command = String(_event.input.command ?? "");
				const decision = policyEngine.check({
					command,
					cwd: process.cwd(),
					askForApproval: "auto",
				});

				if (decision.type === "forbidden") {
					return {
						block: true,
						reason: decision.reason ?? `Command blocked by exec policy: ${command}`,
					};
				}
			}

			return undefined;
		});

		pi.on("message_end", (event: Record<string, any>) => {
			try {
				const msg = event?.message;
				if (!msg || msg.role !== "assistant" || !msg.usage?.cost) return undefined;
				const usedModel = (msg.model as string) ?? modelId;
				const cost = calculateTurnCost(usedModel, {
					input: msg.usage.input ?? 0,
					output: msg.usage.output ?? 0,
					cacheRead: msg.usage.cacheRead ?? 0,
				});
				if (!cost) return undefined;
				const nativeCost = currency === "cny" ? cost.cny : cost.usd;
				return {
					message: {
						...msg,
						usage: { ...msg.usage, cost: { ...msg.usage.cost, total: nativeCost } },
					},
				};
			} catch {
				return undefined;
			}
		});

		pi.on("turn_end", (event: TurnEndEvent) => {
			const msg = event.message;
			if (msg?.role !== "assistant" || !msg.usage) {
				return;
			}

			const usedModel = (msg as { model?: string }).model ?? modelId;
			costTracker.report(usedModel, {
				input: msg.usage.input,
				output: msg.usage.output,
				cacheRead: msg.usage.cacheRead,
			});

			const estimate = costTracker.getCurrent();
			if (estimate.usd > 0 || estimate.cny > 0) {
				const formatted = formatCostEstimate(estimate, currency);
				const tokens = msg.usage.input + msg.usage.output;
				console.error(
					`\x1b[2m[ds] Turn ${event.turnIndex + 1}: ${tokens} tokens, session cost: ${formatted}\x1b[0m`,
				);
			}
		});

		registerRlmTool(pi, config);
		registerSubAgentTools(pi, config);

		if (config.lspEnabled) {
			const lspClient = new LspClient(process.cwd());
			let lspStarted = false;

			const ensureLspStarted = async () => {
				if (!lspStarted) {
					lspStarted = true;
					await lspClient.start().catch(() => {
						lspStarted = false;
					});
				}
			};

			pi.on("tool_result", async (event: ToolResultEvent) => {
				if (event.isError) return undefined;

				const isFileModification = event.toolName === "edit" || event.toolName === "write";
				if (!isFileModification) return undefined;

				const filePath = String(event.input.file_path ?? event.input.filePath ?? "");
				if (!filePath) return undefined;

				await ensureLspStarted();

				await lspClient.notifyFileChanged(filePath);
				const diagnostics = await lspClient.waitForDiagnostics(filePath, { timeout: 3000 });

				if (diagnostics.length > 0) {
					const formatted = lspClient.formatDiagnostics(diagnostics);
					const errors = diagnostics.filter((d) => d.severity === "error");
					if (errors.length > 0) {
						return {
							content: [
								...(event.content as Array<{ type: string; text: string }>),
								{ type: "text", text: `\n\n${formatted}` },
							],
						};
					}
				}
				return undefined;
			});

			pi.on("session_shutdown", async () => {
				if (lspStarted) {
					await lspClient.stop();
				}
			});
		}

		const sideGit = new SideGitSnapshots(process.cwd());
		let sideGitReady = false;

		pi.on("session_start", async () => {
			await sideGit.initialize();
			sideGitReady = sideGit.isEnabled();
			if (sideGitReady && process.env.DS_DEBUG) {
				console.error("[ds] SideGit snapshots enabled");
			}
		});

		pi.on("turn_start", async (event: TurnStartEvent) => {
			if (!sideGitReady) return;
			const turnId = `turn-${event.turnIndex}`;
			const sha = await sideGit.createSnapshot(turnId);
			if (sha && process.env.DS_DEBUG) {
				console.error(`[ds] SideGit snapshot: ${turnId} -> ${sha.slice(0, 8)}`);
			}
		});

		pi.registerCommand("snapshot-list", {
			description: "List all SideGit snapshots for this session",
			handler: async () => {
				const snapshots = await sideGit.listSnapshots();
				if (snapshots.length === 0) {
					console.log("No snapshots available.");
				} else {
					console.log(`Snapshots (${snapshots.length}):`);
					for (const s of snapshots) {
						console.log(`  - ${s}`);
					}
				}
			},
		});

		pi.registerCommand("snapshot-restore", {
			description: "Restore a SideGit snapshot by turn ID (e.g. /snapshot-restore turn-3)",
			handler: async () => {
				const snapshots = await sideGit.listSnapshots();
				if (snapshots.length === 0) {
					console.log("No snapshots available to restore.");
					return;
				}
				const latest = snapshots[snapshots.length - 1]!;
				const ok = await sideGit.restoreSnapshot(latest);
				console.log(ok ? `Restored snapshot: ${latest}` : `Failed to restore snapshot: ${latest}`);
			},
		});
	};
}

function buildExecPolicyEngine(config: DsConfig): ExecPolicyEngine | null {
	const hasTrusted = config.execPolicy.trustedPrefixes.length > 0;
	const hasDenied = config.execPolicy.deniedPrefixes.length > 0;

	const rulesets: Ruleset[] = [ExecPolicyEngine.builtinDefault()];

	if (hasTrusted || hasDenied) {
		rulesets.push({
			layer: "user",
			trustedPrefixes: config.execPolicy.trustedPrefixes,
			deniedPrefixes: config.execPolicy.deniedPrefixes,
		});
	}

	return new ExecPolicyEngine(rulesets);
}

function createDeepSeekMessageFn(config: DsConfig): CreateMessageFn {
	const apiKey = process.env.DEEPSEEK_API_KEY ?? config.apiKey;
	const baseUrl = config.baseUrl;

	return async (request: CreateMessageRequest) => {
		const response = await fetch(`${baseUrl}/chat/completions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				model: request.model,
				messages: [...(request.system ? [{ role: "system", content: request.system }] : []), ...request.messages],
				max_tokens: request.maxTokens,
				temperature: request.temperature,
				top_p: request.topP,
				stream: false,
			}),
		});

		if (!response.ok) {
			throw new Error(`DeepSeek API error: ${response.status} ${response.statusText}`);
		}

		const data = (await response.json()) as {
			choices?: Array<{ message?: { content?: string } }>;
			usage?: { prompt_tokens?: number; completion_tokens?: number };
		};

		return {
			content: data.choices?.[0]?.message?.content ?? "",
			usage: {
				input: data.usage?.prompt_tokens ?? 0,
				output: data.usage?.completion_tokens ?? 0,
			},
		};
	};
}

function registerRlmTool(pi: ExtensionAPI, config: DsConfig): void {
	const createMessage = createDeepSeekMessageFn(config);
	const rlmDef = createRlmToolDefinition(createMessage);

	pi.registerTool({
		name: rlmDef.name,
		label: rlmDef.label,
		description: rlmDef.description,
		parameters: rlmDef.parameters,
		promptSnippet:
			"rlm: Process large content using a recursive child LLM that can query it without consuming parent context.",
		async execute(
			toolCallId: string,
			params: Record<string, unknown>,
			signal: AbortSignal | undefined,
		): Promise<AgentToolResult> {
			try {
				const result = await rlmDef.execute(toolCallId, params as any, signal);
				return result as AgentToolResult;
			} catch (e) {
				const message = e instanceof Error ? e.message : String(e);
				return {
					content: [{ type: "text", text: `RLM error: ${message}` }],
					isError: true,
				};
			}
		},
	});
}

function parseSubAgentResult(text: string): SubAgentResult {
	const sections: Record<string, string> = {};
	const headingRe = /^###\s+(SUMMARY|EVIDENCE|CHANGES|RISKS|BLOCKERS)\s*$/gim;
	let lastKey: string | undefined;
	let lastIdx = 0;

	for (const match of text.matchAll(headingRe)) {
		if (lastKey !== undefined) {
			sections[lastKey] = text.slice(lastIdx, match.index).trim();
		}
		lastKey = match[1]!.toLowerCase();
		lastIdx = match.index! + match[0].length;
	}
	if (lastKey !== undefined) {
		sections[lastKey] = text.slice(lastIdx).trim();
	}

	return {
		summary: sections.summary ?? text.slice(0, 500),
		evidence: sections.evidence,
		changes: sections.changes,
		risks: sections.risks,
		blockers: sections.blockers,
		rawOutput: text,
	};
}

function registerSubAgentTools(pi: ExtensionAPI, config: DsConfig): void {
	const createMessage = createDeepSeekMessageFn(config);
	const sessionsDir = getSessionsDir();

	const manager = new SubAgentManager(
		{
			maxConcurrent: 4,
			stepTimeout: 120_000,
			defaultModel: "deepseek-v4-flash",
			persistPath: `${sessionsDir}/subagents.json`,
			sessionBootId: randomUUID(),
		},
		async (ctx) => {
			const prompt = `${ctx.systemPrompt}\n\n---\n\nTask:\n${ctx.info.prompt}`;

			const response = await createMessage({
				model: ctx.info.model,
				system: ctx.systemPrompt,
				messages: [{ role: "user", content: ctx.info.prompt }],
				maxTokens: 4096,
				temperature: 0.4,
				topP: 0.9,
				stream: false,
			});

			void prompt;
			return parseSubAgentResult(response.content);
		},
	);

	const tools = createSubAgentTools(manager);

	for (const tool of tools) {
		pi.registerTool({
			name: tool.name,
			label: tool.name.replace(/_/g, " "),
			description: tool.description,
			parameters: tool.parameters,
			promptSnippet: `${tool.name}: ${tool.description}`,
			async execute(
				toolCallId: string,
				params: Record<string, unknown>,
				signal: AbortSignal | undefined,
			): Promise<AgentToolResult> {
				try {
					const text = await tool.execute(toolCallId, params as any, signal ?? new AbortController().signal);
					return { content: [{ type: "text", text }] };
				} catch (e) {
					const message = e instanceof Error ? e.message : String(e);
					return {
						content: [{ type: "text", text: `SubAgent error: ${message}` }],
						isError: true,
					};
				}
			},
		});
	}
}

import { readFile } from "node:fs/promises";
import { Type, type Static } from "typebox";
import { RlmBridge } from "./bridge.js";
import { RlmRepl } from "./repl.js";
import type { CreateMessageFn } from "./types.js";

export const RLM_TOOL_NAME = "rlm";
export const DEFAULT_CHILD_MODEL = "deepseek-v4-flash";
export const DEFAULT_MAX_DEPTH = 1;

const MAX_INLINE_BYTES = 50 * 1024;

const rlmParamsSchema = Type.Object({
	file_path: Type.Optional(
		Type.String({ description: "Path to the file containing large content to process" }),
	),
	content: Type.Optional(Type.String({ description: "Inline content to process (limited to 50KB)" })),
	prompt: Type.String({ description: "The task/question to apply to the content" }),
	max_depth: Type.Optional(
		Type.Number({ description: "Maximum RLM recursion depth", default: 1 }),
	),
});

export type RlmToolParams = Static<typeof rlmParamsSchema>;

function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
	if (!signal) return promise;
	return new Promise((resolve, reject) => {
		const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
		if (signal.aborted) {
			onAbort();
			return;
		}
		signal.addEventListener("abort", onAbort);
		promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
	});
}

export function createRlmToolDefinition(createMessage: CreateMessageFn) {
	return {
		name: RLM_TOOL_NAME,
		label: "RLM",
		description:
			"Process large content that exceeds the context window using Recursive Language Model. The content is processed in a separate environment where a child LLM can query it iteratively without consuming the parent context.",
		parameters: rlmParamsSchema,
		async execute(
			_toolCallId: string,
			params: RlmToolParams,
			signal?: AbortSignal,
		) {
			if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

			const fp = params.file_path?.trim();
			const inline = params.content;
			const hasPath = fp !== undefined && fp.length > 0;
			const hasContent = inline !== undefined && inline.length > 0;
			if (hasPath === hasContent) {
				throw new Error("rlm: provide exactly one of file_path or content");
			}
			if (hasContent) {
				const bytes = Buffer.byteLength(inline!, "utf8");
				if (bytes > MAX_INLINE_BYTES) {
					throw new Error(`rlm: inline content exceeds ${MAX_INLINE_BYTES} bytes`);
				}
			}

			const body = hasPath ? await readFile(fp!, "utf8") : inline!;
			if (body.trim().length === 0) {
				throw new Error("rlm: input is empty after loading");
			}

			const bridge = new RlmBridge(createMessage, {
				childModel: DEFAULT_CHILD_MODEL,
				maxDepth: params.max_depth ?? DEFAULT_MAX_DEPTH,
			});
			const repl = new RlmRepl(bridge);
			await abortable(repl.start(), signal);
			try {
				const text = await abortable(repl.runTurn(body, params.prompt), signal);
				return {
					content: [{ type: "text" as const, text }],
				};
			} finally {
				await repl.stop();
			}
		},
	};
}

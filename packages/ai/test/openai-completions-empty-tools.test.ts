import { beforeEach, describe, expect, it, vi } from "vitest";
import { getModel } from "../src/models.js";
import { streamSimple } from "../src/stream.js";

const mockState = vi.hoisted(() => ({
	lastParams: undefined as unknown,
	lastClientOptions: undefined as unknown,
}));

vi.mock("openai", () => {
	class FakeOpenAI {
		constructor(options: unknown) {
			mockState.lastClientOptions = options;
		}

		chat = {
			completions: {
				create: (params: unknown) => {
					mockState.lastParams = params;
					const stream = {
						async *[Symbol.asyncIterator]() {
							yield {
								choices: [{ delta: {}, finish_reason: "stop" }],
								usage: {
									prompt_tokens: 1,
									completion_tokens: 1,
									prompt_tokens_details: { cached_tokens: 0 },
									completion_tokens_details: { reasoning_tokens: 0 },
								},
							};
						},
					};
					const promise = Promise.resolve(stream) as Promise<typeof stream> & {
						withResponse: () => Promise<{
							data: typeof stream;
							response: { status: number; headers: Headers };
						}>;
					};
					promise.withResponse = async () => ({
						data: stream,
						response: { status: 200, headers: new Headers() },
					});
					return promise;
				},
			},
		};
	}

	return { default: FakeOpenAI };
});

describe("openai-completions empty tools handling", () => {
	beforeEach(() => {
		mockState.lastParams = undefined;
		mockState.lastClientOptions = undefined;
	});

	it("omits tools field when context.tools is an empty array", async () => {
		const baseModel = getModel("deepseek", "deepseek-v4-flash")!;
		const model = { ...baseModel, api: "openai-completions" as const };

		await streamSimple(
			model,
			{
				messages: [{ role: "user", content: "hi", timestamp: Date.now() }],
				tools: [],
			},
			{ apiKey: "test" },
		).result();

		const params = mockState.lastParams as { tools?: unknown };
		expect("tools" in (params as object)).toBe(false);
	});

	it("omits tools field when context.tools is undefined", async () => {
		const baseModel = getModel("deepseek", "deepseek-v4-flash")!;
		const model = { ...baseModel, api: "openai-completions" as const };

		await streamSimple(
			model,
			{
				messages: [{ role: "user", content: "hi", timestamp: Date.now() }],
			},
			{ apiKey: "test" },
		).result();

		const params = mockState.lastParams as { tools?: unknown };
		expect("tools" in (params as object)).toBe(false);
	});

	it("still emits tools: [] for Anthropic/LiteLLM proxy when conversation has tool history", async () => {
		const baseModel = getModel("deepseek", "deepseek-v4-flash")!;
		const model = { ...baseModel, api: "openai-completions" as const };

		await streamSimple(
			model,
			{
				messages: [
					{ role: "user", content: "use the tool", timestamp: Date.now() },
					{
						role: "assistant",
						content: [
							{
								type: "toolCall",
								id: "t1",
								name: "noop",
								arguments: {},
							},
						],
						stopReason: "toolUse",
						usage: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							totalTokens: 0,
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
						},
						api: "openai-completions",
						provider: "deepseek",
						model: "deepseek-v4-flash",
						timestamp: Date.now(),
					},
					{
						role: "toolResult",
						toolCallId: "t1",
						toolName: "noop",
						content: [{ type: "text", text: "done" }],
						isError: false,
						timestamp: Date.now(),
					},
				],
				tools: [],
			},
			{ apiKey: "test" },
		).result();

		const params = mockState.lastParams as { tools?: unknown[] };
		expect(Array.isArray(params.tools)).toBe(true);
		expect(params.tools).toEqual([]);
	});
});

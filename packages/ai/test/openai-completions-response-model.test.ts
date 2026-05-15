import { beforeEach, describe, expect, it, vi } from "vitest";
import { getModel } from "../src/models.js";
import { complete } from "../src/stream.js";

// When the upstream echoes a different concrete model id than requested, we surface it on `responseModel`.

const mockState = vi.hoisted(() => ({
	chunks: [] as unknown[],
}));

vi.mock("openai", () => {
	class FakeOpenAI {
		chat = {
			completions: {
				create: () => {
					const chunks = mockState.chunks;
					const stream = {
						async *[Symbol.asyncIterator]() {
							for (const chunk of chunks) yield chunk;
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

describe("openai-completions responseModel", () => {
	beforeEach(() => {
		mockState.chunks = [];
	});

	it("surfaces routed chunk.model on responseModel without changing model", async () => {
		mockState.chunks = [
			{
				id: "chatcmpl-1",
				model: "deepseek-v4-pro",
				choices: [{ index: 0, delta: { content: "hi" } }],
			},
			{
				id: "chatcmpl-1",
				model: "deepseek-v4-pro",
				choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
				usage: {
					prompt_tokens: 10,
					completion_tokens: 5,
					prompt_tokens_details: { cached_tokens: 0 },
					completion_tokens_details: { reasoning_tokens: 0 },
				},
			},
		];

		const model = getModel("deepseek", "deepseek-v4-flash");
		const message = await complete(
			model,
			{ messages: [{ role: "user", content: "hi", timestamp: Date.now() }] },
			{ apiKey: "test" },
		);

		expect(message.model).toBe("deepseek-v4-flash");
		expect(message.responseModel).toBe("deepseek-v4-pro");
		expect(message.provider).toBe("deepseek");
		expect(message.stopReason).toBe("stop");
	});

	it("leaves responseModel undefined when chunks echo the requested id", async () => {
		mockState.chunks = [
			{
				id: "chatcmpl-2",
				model: "deepseek-v4-flash",
				choices: [{ index: 0, delta: { content: "hi" } }],
			},
			{
				id: "chatcmpl-2",
				model: "deepseek-v4-flash",
				choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
				usage: {
					prompt_tokens: 1,
					completion_tokens: 1,
					prompt_tokens_details: { cached_tokens: 0 },
					completion_tokens_details: { reasoning_tokens: 0 },
				},
			},
		];

		const model = getModel("deepseek", "deepseek-v4-flash");
		const message = await complete(
			model,
			{ messages: [{ role: "user", content: "hi", timestamp: Date.now() }] },
			{ apiKey: "test" },
		);

		expect(message.model).toBe("deepseek-v4-flash");
		expect(message.responseModel).toBeUndefined();
	});

	it("ignores empty or missing chunk.model", async () => {
		mockState.chunks = [
			{ id: "chatcmpl-3", choices: [{ index: 0, delta: { content: "hi" } }] },
			{ id: "chatcmpl-3", model: "", choices: [{ index: 0, delta: { content: "!" } }] },
			{
				id: "chatcmpl-3",
				choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
				usage: {
					prompt_tokens: 1,
					completion_tokens: 2,
					prompt_tokens_details: { cached_tokens: 0 },
					completion_tokens_details: { reasoning_tokens: 0 },
				},
			},
		];

		const model = getModel("deepseek", "deepseek-v4-flash");
		const message = await complete(
			model,
			{ messages: [{ role: "user", content: "hi", timestamp: Date.now() }] },
			{ apiKey: "test" },
		);

		expect(message.model).toBe("deepseek-v4-flash");
		expect(message.responseModel).toBeUndefined();
	});
});

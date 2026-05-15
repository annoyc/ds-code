import { describe, expect, it } from "vitest";
import { getModel } from "../src/models.js";
import { complete, stream } from "../src/stream.js";
import type { Api, Context, Model, StreamOptions } from "../src/types.js";

type StreamOptionsWithExtras = StreamOptions & Record<string, unknown>;

async function testAbortSignal<TApi extends Api>(llm: Model<TApi>, options: StreamOptionsWithExtras = {}) {
	const context: Context = {
		messages: [
			{
				role: "user",
				content: "What is 15 + 27? Think step by step. Then list 50 first names.",
				timestamp: Date.now(),
			},
		],
		systemPrompt: "You are a helpful assistant.",
	};

	let abortFired = false;
	let text = "";
	const controller = new AbortController();
	const response = await stream(llm, context, { ...options, signal: controller.signal });
	for await (const event of response) {
		if (abortFired) return;
		if (event.type === "text_delta" || event.type === "thinking_delta") {
			text += event.delta;
		}
		if (text.length >= 50) {
			controller.abort();
			abortFired = true;
		}
	}
	const msg = await response.result();

	expect(msg.stopReason).toBe("aborted");
	expect(msg.content.length).toBeGreaterThan(0);

	context.messages.push(msg);
	context.messages.push({
		role: "user",
		content: "Please continue, but only generate 5 names.",
		timestamp: Date.now(),
	});

	const followUp = await complete(llm, context, options);
	expect(followUp.stopReason).toBe("stop");
	expect(followUp.content.length).toBeGreaterThan(0);
}

async function testImmediateAbort<TApi extends Api>(llm: Model<TApi>, options: StreamOptionsWithExtras = {}) {
	const controller = new AbortController();

	controller.abort();

	const context: Context = {
		messages: [{ role: "user", content: "Hello", timestamp: Date.now() }],
	};

	const response = await complete(llm, context, { ...options, signal: controller.signal });
	expect(response.stopReason).toBe("aborted");
}

async function testAbortThenNewMessage<TApi extends Api>(llm: Model<TApi>, options: StreamOptionsWithExtras = {}) {
	const controller = new AbortController();
	controller.abort();

	const context: Context = {
		messages: [{ role: "user", content: "Hello, how are you?", timestamp: Date.now() }],
	};

	const abortedResponse = await complete(llm, context, { ...options, signal: controller.signal });
	expect(abortedResponse.stopReason).toBe("aborted");
	expect(abortedResponse.content.length).toBe(0);

	context.messages.push(abortedResponse);

	context.messages.push({
		role: "user",
		content: "What is 2 + 2?",
		timestamp: Date.now(),
	});

	const followUp = await complete(llm, context, options);
	expect(followUp.stopReason).toBe("stop");
	expect(followUp.content.length).toBeGreaterThan(0);
}

describe("AI Providers Abort Tests", () => {
	describe.skipIf(!process.env.DEEPSEEK_API_KEY)("DeepSeek Provider Abort", () => {
		const llm = getModel("deepseek", "deepseek-v4-flash");

		it("should abort mid-stream", { retry: 3 }, async () => {
			await testAbortSignal(llm, { reasoningEffort: "medium" });
		});

		it("should handle immediate abort", { retry: 3 }, async () => {
			await testImmediateAbort(llm);
		});

		it("should handle abort then new message", { retry: 3 }, async () => {
			await testAbortThenNewMessage(llm);
		});
	});
});

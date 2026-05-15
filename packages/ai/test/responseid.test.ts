import { describe, expect, it } from "vitest";
import { getModel } from "../src/models.js";
import { complete } from "../src/stream.js";
import type { Api, Context, Model, StreamOptions } from "../src/types.js";

type StreamOptionsWithExtras = StreamOptions & Record<string, unknown>;

async function expectResponseId<TApi extends Api>(model: Model<TApi>, options: StreamOptionsWithExtras = {}) {
	const context: Context = {
		systemPrompt: "You are a helpful assistant. Be concise.",
		messages: [{ role: "user", content: "Reply with exactly: response id test", timestamp: Date.now() }],
	};

	const response = await complete(model, context, options);

	expect(response.stopReason, response.errorMessage).not.toBe("error");
	expect(response.responseId).toBeTruthy();
	expect(typeof response.responseId).toBe("string");
}

describe("responseId E2E Tests", () => {
	describe.skipIf(!process.env.DEEPSEEK_API_KEY)("DeepSeek Provider", () => {
		const llm = getModel("deepseek", "deepseek-v4-flash");

		it("should expose responseId", { retry: 3, timeout: 30000 }, async () => {
			await expectResponseId(llm);
		});
	});
});

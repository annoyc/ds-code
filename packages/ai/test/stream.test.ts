import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { getModel } from "../src/models.js";
import { complete, stream } from "../src/stream.js";
import type { Api, Context, Model, StreamOptions, Tool, ToolResultMessage } from "../src/types.js";
import { StringEnum } from "../src/utils/typebox-helpers.js";

type StreamOptionsWithExtras = StreamOptions & Record<string, unknown>;

// Calculator tool definition (same as examples)
// Note: Using StringEnum helper because some APIs require { type: "string", enum: [...] } format.
const calculatorSchema = Type.Object({
	a: Type.Number({ description: "First number" }),
	b: Type.Number({ description: "Second number" }),
	operation: StringEnum(["add", "subtract", "multiply", "divide"], {
		description: "The operation to perform. One of 'add', 'subtract', 'multiply', 'divide'.",
	}),
});

const calculatorTool: Tool<typeof calculatorSchema> = {
	name: "math_operation",
	description: "Perform basic arithmetic operations",
	parameters: calculatorSchema,
};

async function basicTextGeneration<TApi extends Api>(model: Model<TApi>, options?: StreamOptionsWithExtras) {
	const context: Context = {
		systemPrompt: "You are a helpful assistant. Be concise.",
		messages: [{ role: "user", content: "Reply with exactly: 'Hello test successful'", timestamp: Date.now() }],
	};
	const response = await complete(model, context, options);

	expect(response.role).toBe("assistant");
	expect(response.content).toBeTruthy();
	expect(response.usage.input + response.usage.cacheRead).toBeGreaterThan(0);
	expect(response.usage.output).toBeGreaterThan(0);
	expect(response.errorMessage).toBeFalsy();
	expect(response.content.map((b) => (b.type === "text" ? b.text : "")).join("")).toContain("Hello test successful");

	context.messages.push(response);
	context.messages.push({ role: "user", content: "Now say 'Goodbye test successful'", timestamp: Date.now() });

	const secondResponse = await complete(model, context, options);

	expect(secondResponse.role).toBe("assistant");
	expect(secondResponse.content).toBeTruthy();
	expect(secondResponse.usage.input + secondResponse.usage.cacheRead).toBeGreaterThan(0);
	expect(secondResponse.usage.output).toBeGreaterThan(0);
	expect(secondResponse.errorMessage).toBeFalsy();
	expect(secondResponse.content.map((b) => (b.type === "text" ? b.text : "")).join("")).toContain(
		"Goodbye test successful",
	);
}

async function handleToolCall<TApi extends Api>(model: Model<TApi>, options?: StreamOptionsWithExtras) {
	const context: Context = {
		systemPrompt: "You are a helpful assistant that uses tools when asked.",
		messages: [
			{
				role: "user",
				content: "Calculate 15 + 27 using the math_operation tool.",
				timestamp: Date.now(),
			},
		],
		tools: [calculatorTool],
	};

	const s = await stream(model, context, options);
	let hasToolStart = false;
	let hasToolDelta = false;
	let hasToolEnd = false;
	let accumulatedToolArgs = "";
	let index = 0;
	for await (const event of s) {
		if (event.type === "toolcall_start") {
			hasToolStart = true;
			const toolCall = event.partial.content[event.contentIndex];
			index = event.contentIndex;
			expect(toolCall.type).toBe("toolCall");
			if (toolCall.type === "toolCall") {
				expect(toolCall.name).toBe("math_operation");
				expect(toolCall.id).toBeTruthy();
			}
		}
		if (event.type === "toolcall_delta") {
			hasToolDelta = true;
			const toolCall = event.partial.content[event.contentIndex];
			expect(event.contentIndex).toBe(index);
			expect(toolCall.type).toBe("toolCall");
			if (toolCall.type === "toolCall") {
				expect(toolCall.name).toBe("math_operation");
				accumulatedToolArgs += event.delta;
				expect(toolCall.arguments).toBeDefined();
				expect(typeof toolCall.arguments).toBe("object");
				expect(toolCall.arguments).not.toBeNull();
			}
		}
		if (event.type === "toolcall_end") {
			hasToolEnd = true;
			const toolCall = event.partial.content[event.contentIndex];
			expect(event.contentIndex).toBe(index);
			expect(toolCall.type).toBe("toolCall");
			if (toolCall.type === "toolCall") {
				expect(toolCall.name).toBe("math_operation");
				JSON.parse(accumulatedToolArgs);
				expect(toolCall.arguments).not.toBeUndefined();
				const args = toolCall.arguments as { a: number; b: number; operation: string };
				expect(args.a).toBe(15);
				expect(args.b).toBe(27);
				expect(["add", "subtract", "multiply", "divide"]).toContain(args.operation);
			}
		}
	}

	expect(hasToolStart).toBe(true);
	expect(hasToolDelta).toBe(true);
	expect(hasToolEnd).toBe(true);

	const response = await s.result();
	expect(response.stopReason).toBe("toolUse");
	expect(response.content.some((b) => b.type === "toolCall")).toBeTruthy();
	const toolCall = response.content.find((b) => b.type === "toolCall");
	if (toolCall && toolCall.type === "toolCall") {
		expect(toolCall.name).toBe("math_operation");
		expect(toolCall.id).toBeTruthy();
	} else {
		throw new Error("No tool call found in response");
	}
}

async function handleStreaming<TApi extends Api>(model: Model<TApi>, options?: StreamOptionsWithExtras) {
	let textStarted = false;
	let textChunks = "";
	let textCompleted = false;

	const context: Context = {
		messages: [{ role: "user", content: "Count from 1 to 3", timestamp: Date.now() }],
		systemPrompt: "You are a helpful assistant.",
	};

	const s = stream(model, context, options);

	for await (const event of s) {
		if (event.type === "text_start") {
			textStarted = true;
		} else if (event.type === "text_delta") {
			textChunks += event.delta;
		} else if (event.type === "text_end") {
			textCompleted = true;
		}
	}

	const response = await s.result();

	expect(textStarted).toBe(true);
	expect(textChunks.length).toBeGreaterThan(0);
	expect(textCompleted).toBe(true);
	expect(response.content.some((b) => b.type === "text")).toBeTruthy();
}

async function handleThinking<TApi extends Api>(model: Model<TApi>, options?: StreamOptionsWithExtras) {
	let thinkingStarted = false;
	let thinkingChunks = "";
	let thinkingCompleted = false;

	const context: Context = {
		messages: [
			{
				role: "user",
				content: `Think long and hard about ${(Math.random() * 255) | 0} + 27. Think step by step. Then output the result.`,
				timestamp: Date.now(),
			},
		],
		systemPrompt: "You are a helpful assistant.",
	};

	const s = stream(model, context, options);

	for await (const event of s) {
		if (event.type === "thinking_start") {
			thinkingStarted = true;
		} else if (event.type === "thinking_delta") {
			thinkingChunks += event.delta;
		} else if (event.type === "thinking_end") {
			thinkingCompleted = true;
		}
	}

	const response = await s.result();

	expect(response.stopReason, `Error: ${response.errorMessage}`).toBe("stop");
	expect(thinkingStarted).toBe(true);
	expect(thinkingChunks.length).toBeGreaterThan(0);
	expect(thinkingCompleted).toBe(true);
	expect(response.content.some((b) => b.type === "thinking")).toBeTruthy();
}

async function multiTurn<TApi extends Api>(model: Model<TApi>, options?: StreamOptionsWithExtras) {
	const context: Context = {
		systemPrompt: "You are a helpful assistant that can use tools to answer questions.",
		messages: [
			{
				role: "user",
				content: "Think about this briefly, then calculate 42 * 17 and 453 + 434 using the math_operation tool.",
				timestamp: Date.now(),
			},
		],
		tools: [calculatorTool],
	};

	let allTextContent = "";
	let hasSeenThinking = false;
	let hasSeenToolCalls = false;
	const maxTurns = 5;

	for (let turn = 0; turn < maxTurns; turn++) {
		const response = await complete(model, context, options);

		context.messages.push(response);

		const results: ToolResultMessage[] = [];
		for (const block of response.content) {
			if (block.type === "text") {
				allTextContent += block.text;
			} else if (block.type === "thinking") {
				hasSeenThinking = true;
			} else if (block.type === "toolCall") {
				hasSeenToolCalls = true;

				expect(block.name).toBe("math_operation");
				expect(block.id).toBeTruthy();
				expect(block.arguments).toBeTruthy();

				const { a, b, operation } = block.arguments as { a: number; b: number; operation: string };
				let result: number;
				switch (operation) {
					case "add":
						result = a + b;
						break;
					case "multiply":
						result = a * b;
						break;
					default:
						result = 0;
				}

				results.push({
					role: "toolResult",
					toolCallId: block.id,
					toolName: block.name,
					content: [{ type: "text", text: `${result}` }],
					isError: false,
					timestamp: Date.now(),
				});
			}
		}
		context.messages.push(...results);

		expect(response.stopReason, `Error: ${response.errorMessage}`).not.toBe("error");
		if (response.stopReason === "stop") {
			break;
		}
	}

	expect(hasSeenThinking || hasSeenToolCalls).toBe(true);

	expect(allTextContent).toBeTruthy();
	expect(allTextContent.includes("714")).toBe(true);
	expect(allTextContent.includes("887")).toBe(true);
}

describe("Generate E2E Tests", () => {
	describe.skipIf(!process.env.DEEPSEEK_API_KEY)(
		"DeepSeek Provider (deepseek-v4-flash via OpenAI Completions)",
		() => {
			const llm = getModel("deepseek", "deepseek-v4-flash");

			it("should complete basic text generation", { retry: 3 }, async () => {
				await basicTextGeneration(llm);
			});

			it("should handle tool calling", { retry: 3 }, async () => {
				await handleToolCall(llm);
			});

			it("should handle streaming", { retry: 3 }, async () => {
				await handleStreaming(llm);
			});

			it("should handle thinking mode", { retry: 3 }, async () => {
				await handleThinking(llm, { reasoningEffort: "high" });
			});

			it("should handle multi-turn with thinking and tools", { retry: 3 }, async () => {
				await multiTurn(llm, { reasoningEffort: "high" });
			});
		},
	);
});

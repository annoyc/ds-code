import type { Api, Model } from "@mariozechner/pi-ai";
import { describe, expect, test } from "vitest";
import {
	defaultModelPerProvider,
	findInitialModel,
	parseModelPattern,
	resolveCliModel,
} from "../src/core/model-resolver.js";

const mockDeepseekModels: Model<Api>[] = [
	{
		id: "deepseek-v4-flash",
		name: "DeepSeek V4 Flash",
		api: "openai-completions",
		provider: "deepseek",
		baseUrl: "https://api.deepseek.com",
		reasoning: true,
		input: ["text"],
		cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1 },
		contextWindow: 1_000_000,
		maxTokens: 8192,
	},
	{
		id: "deepseek-v4-pro",
		name: "DeepSeek V4 Pro",
		api: "openai-completions",
		provider: "deepseek",
		baseUrl: "https://api.deepseek.com",
		reasoning: true,
		input: ["text"],
		cost: { input: 2, output: 4, cacheRead: 0.2, cacheWrite: 2 },
		contextWindow: 1_000_000,
		maxTokens: 8192,
	},
];

const mockVendorModels: Model<Api>[] = [
	{
		id: "vendor-model:beta",
		name: "Vendor Beta",
		api: "openai-completions",
		provider: "vendor",
		baseUrl: "https://vendor.example/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 4096,
	},
	{
		id: "other/id:withcolon",
		name: "Other",
		api: "openai-completions",
		provider: "vendor",
		baseUrl: "https://vendor.example/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 4096,
	},
];

const allModels = [...mockDeepseekModels, ...mockVendorModels];

describe("parseModelPattern", () => {
	describe("simple patterns without colons", () => {
		test("exact match returns model with undefined thinking level", () => {
			const result = parseModelPattern("deepseek-v4-flash", allModels);
			expect(result.model?.id).toBe("deepseek-v4-flash");
			expect(result.thinkingLevel).toBeUndefined();
			expect(result.warning).toBeUndefined();
		});

		test("partial match returns best model with undefined thinking level", () => {
			const result = parseModelPattern("flash", allModels);
			expect(result.model?.id).toBe("deepseek-v4-flash");
			expect(result.thinkingLevel).toBeUndefined();
			expect(result.warning).toBeUndefined();
		});

		test("no match returns undefined model and thinking level", () => {
			const result = parseModelPattern("nonexistent", allModels);
			expect(result.model).toBeUndefined();
			expect(result.thinkingLevel).toBeUndefined();
			expect(result.warning).toBeUndefined();
		});
	});

	describe("patterns with valid thinking levels", () => {
		test("flash id with high thinking level", () => {
			const result = parseModelPattern("deepseek-v4-flash:high", allModels);
			expect(result.model?.id).toBe("deepseek-v4-flash");
			expect(result.thinkingLevel).toBe("high");
			expect(result.warning).toBeUndefined();
		});

		test("pro id with medium thinking level", () => {
			const result = parseModelPattern("deepseek-v4-pro:medium", allModels);
			expect(result.model?.id).toBe("deepseek-v4-pro");
			expect(result.thinkingLevel).toBe("medium");
			expect(result.warning).toBeUndefined();
		});

		test("all valid thinking levels work", () => {
			for (const level of ["off", "minimal", "low", "medium", "high", "xhigh"]) {
				const result = parseModelPattern(`flash:${level}`, allModels);
				expect(result.model?.id).toBe("deepseek-v4-flash");
				expect(result.thinkingLevel).toBe(level);
				expect(result.warning).toBeUndefined();
			}
		});
	});

	describe("patterns with invalid thinking levels", () => {
		test("flash:random returns flash with undefined thinking level and warning", () => {
			const result = parseModelPattern("flash:random", allModels);
			expect(result.model?.id).toBe("deepseek-v4-flash");
			expect(result.thinkingLevel).toBeUndefined();
			expect(result.warning).toContain("Invalid thinking level");
			expect(result.warning).toContain("random");
		});
	});

	describe("models with colons in IDs", () => {
		test("vendor-model:beta matches with undefined thinking level", () => {
			const result = parseModelPattern("vendor/vendor-model:beta", allModels);
			expect(result.model?.id).toBe("vendor-model:beta");
			expect(result.thinkingLevel).toBeUndefined();
			expect(result.warning).toBeUndefined();
		});

		test("vendor-model:beta:high matches model with high thinking level", () => {
			const result = parseModelPattern("vendor/vendor-model:beta:high", allModels);
			expect(result.model?.id).toBe("vendor-model:beta");
			expect(result.thinkingLevel).toBe("high");
			expect(result.warning).toBeUndefined();
		});

		test("other/id:withcolon matches raw id", () => {
			const result = parseModelPattern("vendor/other/id:withcolon", allModels);
			expect(result.model?.id).toBe("other/id:withcolon");
			expect(result.thinkingLevel).toBeUndefined();
			expect(result.warning).toBeUndefined();
		});

		test("invalid thinking suffix after colon model id", () => {
			const result = parseModelPattern("vendor/vendor-model:beta:random", allModels);
			expect(result.model?.id).toBe("vendor-model:beta");
			expect(result.thinkingLevel).toBeUndefined();
			expect(result.warning).toContain("Invalid thinking level");
		});
	});

	describe("edge cases", () => {
		test("empty pattern matches via partial matching", () => {
			const result = parseModelPattern("", allModels);
			expect(result.model).not.toBeNull();
			expect(result.thinkingLevel).toBeUndefined();
		});

		test("pattern ending with colon treats empty suffix as invalid", () => {
			const result = parseModelPattern("flash:", allModels);
			expect(result.model?.id).toBe("deepseek-v4-flash");
			expect(result.warning).toContain("Invalid thinking level");
		});
	});
});

describe("resolveCliModel", () => {
	test("resolves --model provider/id without --provider", () => {
		const registry = {
			getAll: () => allModels,
		} as unknown as Parameters<typeof resolveCliModel>[0]["modelRegistry"];

		const result = resolveCliModel({
			cliModel: "deepseek/deepseek-v4-pro",
			modelRegistry: registry,
		});

		expect(result.error).toBeUndefined();
		expect(result.model?.provider).toBe("deepseek");
		expect(result.model?.id).toBe("deepseek-v4-pro");
	});

	test("resolves fuzzy patterns within an explicit provider", () => {
		const registry = {
			getAll: () => allModels,
		} as unknown as Parameters<typeof resolveCliModel>[0]["modelRegistry"];

		const result = resolveCliModel({
			cliProvider: "deepseek",
			cliModel: "pro",
			modelRegistry: registry,
		});

		expect(result.error).toBeUndefined();
		expect(result.model?.provider).toBe("deepseek");
		expect(result.model?.id).toBe("deepseek-v4-pro");
	});

	test("supports --model <pattern>:<thinking> (without explicit --thinking)", () => {
		const registry = {
			getAll: () => allModels,
		} as unknown as Parameters<typeof resolveCliModel>[0]["modelRegistry"];

		const result = resolveCliModel({
			cliModel: "deepseek-v4-flash:high",
			modelRegistry: registry,
		});

		expect(result.error).toBeUndefined();
		expect(result.model?.id).toBe("deepseek-v4-flash");
		expect(result.thinkingLevel).toBe("high");
	});

	test("returns a clear error when there are no models", () => {
		const registry = {
			getAll: () => [],
		} as unknown as Parameters<typeof resolveCliModel>[0]["modelRegistry"];

		const result = resolveCliModel({
			cliProvider: "deepseek",
			cliModel: "deepseek-v4-flash",
			modelRegistry: registry,
		});

		expect(result.model).toBeUndefined();
		expect(result.error).toContain("No models available");
	});

	test("prefers provider/model split when slash prefix matches a registered provider", () => {
		const gatewayModel: Model<Api> = {
			id: "deepseek/deepseek-v4-flash",
			name: "Gateway Flash",
			api: "openai-completions",
			provider: "gateway",
			baseUrl: "https://gateway.example",
			reasoning: true,
			input: ["text"],
			cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 8192,
		};
		const registry = {
			getAll: () => [...allModels, gatewayModel],
		} as unknown as Parameters<typeof resolveCliModel>[0]["modelRegistry"];

		const result = resolveCliModel({
			cliModel: "deepseek/deepseek-v4-flash",
			modelRegistry: registry,
		});

		expect(result.error).toBeUndefined();
		expect(result.model?.provider).toBe("deepseek");
		expect(result.model?.id).toBe("deepseek-v4-flash");
	});

	test("resolves provider-prefixed fuzzy patterns", () => {
		const registry = {
			getAll: () => allModels,
		} as unknown as Parameters<typeof resolveCliModel>[0]["modelRegistry"];

		const result = resolveCliModel({
			cliModel: "vendor/vendor-model",
			modelRegistry: registry,
		});

		expect(result.error).toBeUndefined();
		expect(result.model?.provider).toBe("vendor");
		expect(result.model?.id).toBe("vendor-model:beta");
	});
});

describe("default model selection", () => {
	test("deepseek default tracks current models", () => {
		expect(defaultModelPerProvider.deepseek).toBe("deepseek-v4-pro");
	});

	test("findInitialModel selects deepseek default when available", async () => {
		const registry = {
			getAvailable: async () => [mockDeepseekModels[1], mockDeepseekModels[0]],
		} as unknown as Parameters<typeof findInitialModel>[0]["modelRegistry"];

		const result = await findInitialModel({
			scopedModels: [],
			isContinuing: false,
			modelRegistry: registry,
		});

		expect(result.model?.provider).toBe("deepseek");
		expect(result.model?.id).toBe("deepseek-v4-pro");
	});

	test("findInitialModel falls back to first available when default missing", async () => {
		const registry = {
			getAvailable: async () => [mockVendorModels[0]],
		} as unknown as Parameters<typeof findInitialModel>[0]["modelRegistry"];

		const result = await findInitialModel({
			scopedModels: [],
			isContinuing: false,
			modelRegistry: registry,
		});

		expect(result.model?.provider).toBe("vendor");
		expect(result.model?.id).toBe("vendor-model:beta");
	});
});

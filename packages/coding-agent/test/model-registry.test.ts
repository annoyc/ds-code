import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, Context, Model, OpenAICompletionsCompat } from "@mariozechner/pi-ai";
import { getApiProvider } from "@mariozechner/pi-ai";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.js";
import { clearApiKeyCache, ModelRegistry, type ProviderConfigInput } from "../src/core/model-registry.js";

describe("ModelRegistry", () => {
	let tempDir: string;
	let modelsJsonPath: string;
	let authStorage: AuthStorage;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-test-model-registry-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		modelsJsonPath = join(tempDir, "models.json");
		authStorage = AuthStorage.create(join(tempDir, "auth.json"));
	});

	afterEach(() => {
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true });
		}
		clearApiKeyCache();
	});

	function providerConfig(
		baseUrl: string,
		models: Array<{ id: string; name?: string }>,
		api: string = "openai-completions",
	): ProviderConfigInput {
		return {
			baseUrl,
			apiKey: "TEST_KEY",
			api: api as Api,
			models: models.map((m) => ({
				id: m.id,
				name: m.name ?? m.id,
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 100000,
				maxTokens: 8000,
			})),
		};
	}

	function writeModelsJson(providers: Record<string, ReturnType<typeof providerConfig>>) {
		writeFileSync(modelsJsonPath, JSON.stringify({ providers }));
	}

	function getModelsForProvider(registry: ModelRegistry, provider: string) {
		return registry.getAll().filter((m) => m.provider === provider);
	}

	function toShPath(value: string): string {
		return value.replace(/\\/g, "/").replace(/"/g, '\\"');
	}

	function overrideConfig(baseUrl: string, headers?: Record<string, string>) {
		return { baseUrl, ...(headers && { headers }) };
	}

	function writeRawModelsJson(providers: Record<string, unknown>) {
		writeFileSync(modelsJsonPath, JSON.stringify({ providers }));
	}

	const openAiModel: Model<Api> = {
		id: "test-openai-model",
		name: "Test OpenAI Model",
		api: "openai-completions",
		provider: "stream-demo",
		baseUrl: "https://api.example.com/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 4096,
	};

	const emptyContext: Context = {
		messages: [],
	};

	describe("baseUrl override (no custom models)", () => {
		test("overriding baseUrl keeps all built-in models", () => {
			writeRawModelsJson({
				deepseek: overrideConfig("https://my-proxy.example.com/v1"),
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const dsModels = getModelsForProvider(registry, "deepseek");

			expect(dsModels.length).toBeGreaterThan(1);
			expect(dsModels.some((m) => m.id.includes("deepseek"))).toBe(true);
		});

		test("overriding baseUrl changes URL on all built-in models", () => {
			writeRawModelsJson({
				deepseek: overrideConfig("https://my-proxy.example.com/v1"),
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const dsModels = getModelsForProvider(registry, "deepseek");

			for (const model of dsModels) {
				expect(model.baseUrl).toBe("https://my-proxy.example.com/v1");
			}
		});

		test("overriding headers resolves at request time", async () => {
			writeRawModelsJson({
				deepseek: overrideConfig("https://my-proxy.example.com/v1", {
					"X-Custom-Header": "custom-value",
				}),
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const dsModels = getModelsForProvider(registry, "deepseek");

			for (const model of dsModels) {
				const auth = await registry.getApiKeyAndHeaders(model);
				expect(auth.ok).toBe(true);
				if (auth.ok) {
					expect(auth.headers?.["X-Custom-Header"]).toBe("custom-value");
				}
			}
		});

		test("headers-only override resolves at request time", async () => {
			writeRawModelsJson({
				deepseek: {
					headers: {
						"X-Custom-Header": "custom-value",
					},
				},
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			expect(registry.getError()).toBeUndefined();
			const dsModels = getModelsForProvider(registry, "deepseek");

			for (const model of dsModels) {
				const auth = await registry.getApiKeyAndHeaders(model);
				expect(auth.ok).toBe(true);
				if (auth.ok) {
					expect(auth.headers?.["X-Custom-Header"]).toBe("custom-value");
				}
			}
		});

		test("baseUrl-only override does not affect unrelated custom providers", () => {
			writeRawModelsJson({
				deepseek: overrideConfig("https://my-proxy.example.com/v1"),
				aux: providerConfig("https://aux.example.com/v1", [{ id: "aux-model" }]),
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			expect(registry.find("aux", "aux-model")?.baseUrl).toBe("https://aux.example.com/v1");
		});

		test("can mix baseUrl override and models merge", () => {
			writeRawModelsJson({
				deepseek: overrideConfig("https://deepseek-proxy.example.com/v1"),
				aux: providerConfig("https://aux-proxy.example.com/v1", [{ id: "aux-custom" }]),
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);

			const dsModels = getModelsForProvider(registry, "deepseek");
			expect(dsModels.length).toBeGreaterThan(1);
			expect(dsModels[0].baseUrl).toBe("https://deepseek-proxy.example.com/v1");

			const auxModels = getModelsForProvider(registry, "aux");
			expect(auxModels.some((m) => m.id === "aux-custom")).toBe(true);
		});

		test("refresh() picks up baseUrl override changes", () => {
			writeRawModelsJson({
				deepseek: overrideConfig("https://first-proxy.example.com/v1"),
			});
			const registry = ModelRegistry.create(authStorage, modelsJsonPath);

			expect(getModelsForProvider(registry, "deepseek")[0].baseUrl).toBe("https://first-proxy.example.com/v1");

			writeRawModelsJson({
				deepseek: overrideConfig("https://second-proxy.example.com/v1"),
			});
			registry.refresh();

			expect(getModelsForProvider(registry, "deepseek")[0].baseUrl).toBe("https://second-proxy.example.com/v1");
		});
	});

	describe("custom models merge behavior", () => {
		test("built-in provider custom models inherit api and baseUrl without explicit fields", () => {
			writeRawModelsJson({
				deepseek: {
					models: [
						{
							id: "deepseek-custom",
							name: "Custom DeepSeek",
							reasoning: false,
							input: ["text"],
						},
					],
				},
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			expect(registry.getError()).toBeUndefined();

			const model = registry.find("deepseek", "deepseek-custom");
			expect(model).toBeDefined();
			expect(model?.api).toBe("openai-completions");
			expect(model?.baseUrl).toBe("https://api.deepseek.com");
		});

		test("non-built-in provider custom models still require baseUrl and apiKey", () => {
			writeRawModelsJson({
				"my-custom-provider": {
					models: [
						{
							id: "my-model",
							api: "openai-completions",
							reasoning: false,
							input: ["text"],
						},
					],
				},
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			expect(registry.getError()).toContain("baseUrl");
		});

		test("custom provider with same name as built-in merges with built-in models", () => {
			writeModelsJson({
				deepseek: providerConfig("https://my-proxy.example.com/v1", [{ id: "deepseek-extra" }]),
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const dsModels = getModelsForProvider(registry, "deepseek");

			expect(dsModels.length).toBeGreaterThan(1);
			expect(dsModels.some((m) => m.id === "deepseek-extra")).toBe(true);
			expect(dsModels.some((m) => m.id.includes("deepseek-v4"))).toBe(true);
		});

		test("custom model with same id replaces built-in model by id", () => {
			writeModelsJson({
				aux: providerConfig("https://my-proxy.example.com/v1", [{ id: "shared-id" }]),
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const models = getModelsForProvider(registry, "aux");
			const hits = models.filter((m) => m.id === "shared-id");

			expect(hits).toHaveLength(1);
			expect(hits[0].baseUrl).toBe("https://my-proxy.example.com/v1");
		});

		test("provider-level baseUrl applies to both built-in and custom models", () => {
			writeModelsJson({
				deepseek: providerConfig("https://merged-proxy.example.com/v1", [{ id: "deepseek-extra" }]),
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const dsModels = getModelsForProvider(registry, "deepseek");

			for (const model of dsModels) {
				expect(model.baseUrl).toBe("https://merged-proxy.example.com/v1");
			}
		});

		test("provider-level compat applies to custom models", () => {
			writeRawModelsJson({
				demo: {
					baseUrl: "https://example.com/v1",
					apiKey: "DEMO_KEY",
					api: "openai-completions",
					compat: {
						supportsUsageInStreaming: false,
						maxTokensField: "max_tokens",
					},
					models: [
						{
							id: "demo-model",
							reasoning: false,
							input: ["text"],
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
							contextWindow: 1000,
							maxTokens: 100,
						},
					],
				},
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const compat = registry.find("demo", "demo-model")?.compat as OpenAICompletionsCompat | undefined;

			expect(compat?.supportsUsageInStreaming).toBe(false);
			expect(compat?.maxTokensField).toBe("max_tokens");
		});

		test("model-level compat overrides provider-level compat for custom models", () => {
			writeRawModelsJson({
				demo: {
					baseUrl: "https://example.com/v1",
					apiKey: "DEMO_KEY",
					api: "openai-completions",
					compat: {
						supportsUsageInStreaming: false,
						maxTokensField: "max_tokens",
					},
					models: [
						{
							id: "demo-model",
							reasoning: false,
							input: ["text"],
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
							contextWindow: 1000,
							maxTokens: 100,
							compat: {
								supportsUsageInStreaming: true,
								maxTokensField: "max_completion_tokens",
							},
						},
					],
				},
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const compat = registry.find("demo", "demo-model")?.compat as OpenAICompletionsCompat | undefined;

			expect(compat?.supportsUsageInStreaming).toBe(true);
			expect(compat?.maxTokensField).toBe("max_completion_tokens");
		});

		test("provider-level compat applies to built-in models", () => {
			writeRawModelsJson({
				deepseek: {
					compat: {
						supportsUsageInStreaming: false,
						supportsStrictMode: false,
					},
				},
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const models = getModelsForProvider(registry, "deepseek");

			expect(models.length).toBeGreaterThan(0);
			for (const model of models) {
				const compat = model.compat as OpenAICompletionsCompat | undefined;
				expect(compat?.supportsUsageInStreaming).toBe(false);
				expect(compat?.supportsStrictMode).toBe(false);
			}
		});

		test("model schema accepts thinkingLevelMap and compat supportsStrictMode", () => {
			writeRawModelsJson({
				demo: {
					baseUrl: "https://example.com/v1",
					apiKey: "DEMO_KEY",
					api: "openai-completions",
					models: [
						{
							id: "demo-model",
							reasoning: true,
							input: ["text"],
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
							contextWindow: 1000,
							maxTokens: 100,
							thinkingLevelMap: {
								minimal: null,
								high: "max",
							},
							compat: {
								supportsStrictMode: false,
							},
						},
					],
				},
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const model = registry.find("demo", "demo-model");
			const compat = model?.compat as OpenAICompletionsCompat | undefined;

			expect(registry.getError()).toBeUndefined();
			expect(model?.thinkingLevelMap).toEqual({ minimal: null, high: "max" });
			expect(compat?.supportsStrictMode).toBe(false);
		});

		test("compat schema accepts long cache retention flag", () => {
			writeRawModelsJson({
				demo: {
					baseUrl: "https://example.com",
					apiKey: "DEMO_KEY",
					api: "openai-completions",
					compat: {
						supportsLongCacheRetention: false,
					},
					models: [
						{
							id: "demo-model",
							reasoning: true,
							input: ["text"],
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
							contextWindow: 1000,
							maxTokens: 100,
						},
					],
				},
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const compat = registry.find("demo", "demo-model")?.compat as OpenAICompletionsCompat | undefined;

			expect(registry.getError()).toBeUndefined();
			expect(compat?.supportsLongCacheRetention).toBe(false);
		});

		test("model-level baseUrl overrides provider-level baseUrl for custom models", () => {
			writeRawModelsJson({
				vendor: {
					baseUrl: "https://vendor.example/v1",
					apiKey: "TEST_KEY",
					api: "openai-completions",
					models: [
						{
							id: "alpha",
							baseUrl: "https://alpha.example",
							reasoning: false,
							input: ["text"],
							cost: { input: 0.3, output: 1.2, cacheRead: 0.03, cacheWrite: 0 },
							contextWindow: 204800,
							maxTokens: 131072,
						},
						{
							id: "beta",
							reasoning: false,
							input: ["text"],
							cost: { input: 1, output: 3.2, cacheRead: 0.2, cacheWrite: 0 },
							contextWindow: 204800,
							maxTokens: 131072,
						},
					],
				},
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const alpha = registry.find("vendor", "alpha");
			const beta = registry.find("vendor", "beta");

			expect(alpha?.baseUrl).toBe("https://alpha.example");
			expect(beta?.baseUrl).toBe("https://vendor.example/v1");
		});

		test("modelOverrides still apply when provider also defines models", () => {
			writeRawModelsJson({
				deepseek: {
					models: [
						{
							id: "deepseek-catalog-extra",
							name: "Catalog Extra Model",
							reasoning: false,
							input: ["text"],
						},
					],
					modelOverrides: {
						"deepseek-v4-flash": {
							name: "Overridden Flash Name",
						},
					},
				},
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);

			expect(registry.find("deepseek", "deepseek-catalog-extra")).toBeDefined();
			expect(registry.find("deepseek", "deepseek-v4-flash")?.name).toBe("Overridden Flash Name");
		});

		test("refresh() reloads merged custom models from disk", () => {
			writeModelsJson({
				deepseek: providerConfig("https://first-proxy.example.com/v1", [{ id: "deepseek-extra" }]),
			});
			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			expect(getModelsForProvider(registry, "deepseek").some((m) => m.id === "deepseek-extra")).toBe(true);

			writeModelsJson({
				deepseek: providerConfig("https://second-proxy.example.com/v1", [{ id: "deepseek-extra-2" }]),
			});
			registry.refresh();

			const dsModels = getModelsForProvider(registry, "deepseek");
			expect(dsModels.some((m) => m.id === "deepseek-extra")).toBe(false);
			expect(dsModels.some((m) => m.id === "deepseek-extra-2")).toBe(true);
			expect(dsModels.some((m) => m.id.includes("deepseek-v4"))).toBe(true);
		});

		test("removing custom models from models.json keeps built-in provider models", () => {
			writeModelsJson({
				deepseek: providerConfig("https://proxy.example.com/v1", [{ id: "deepseek-extra" }]),
			});
			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			expect(getModelsForProvider(registry, "deepseek").some((m) => m.id === "deepseek-extra")).toBe(true);

			writeModelsJson({});
			registry.refresh();

			const dsModels = getModelsForProvider(registry, "deepseek");
			expect(dsModels.some((m) => m.id === "deepseek-extra")).toBe(false);
			expect(dsModels.some((m) => m.id.includes("deepseek-v4"))).toBe(true);
		});
	});

	describe("modelOverrides (per-model customization)", () => {
		test("model override applies to a single built-in model", () => {
			writeRawModelsJson({
				deepseek: {
					modelOverrides: {
						"deepseek-v4-flash": {
							name: "Custom Flash Name",
						},
					},
				},
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const flash = registry.find("deepseek", "deepseek-v4-flash");
			const pro = registry.find("deepseek", "deepseek-v4-pro");

			expect(flash?.name).toBe("Custom Flash Name");
			expect(pro?.name).not.toBe("Custom Flash Name");
		});

		test("model override deep merges compat settings", () => {
			writeRawModelsJson({
				deepseek: {
					modelOverrides: {
						"deepseek-v4-flash": {
							compat: {
								supportsStrictMode: false,
							},
						},
					},
				},
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const flash = registry.find("deepseek", "deepseek-v4-flash");
			const compat = flash?.compat as OpenAICompletionsCompat | undefined;
			expect(compat?.supportsStrictMode).toBe(false);
		});

		test("multiple model overrides on same provider", () => {
			writeRawModelsJson({
				deepseek: {
					modelOverrides: {
						"deepseek-v4-flash": {
							compat: { supportsUsageInStreaming: false },
						},
						"deepseek-v4-pro": {
							compat: { supportsLongCacheRetention: false },
						},
					},
				},
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const flash = registry.find("deepseek", "deepseek-v4-flash");
			const pro = registry.find("deepseek", "deepseek-v4-pro");

			const flashCompat = flash?.compat as OpenAICompletionsCompat | undefined;
			const proCompat = pro?.compat as OpenAICompletionsCompat | undefined;
			expect(flashCompat?.supportsUsageInStreaming).toBe(false);
			expect(proCompat?.supportsLongCacheRetention).toBe(false);
		});

		test("model override combined with baseUrl override", () => {
			writeRawModelsJson({
				deepseek: {
					baseUrl: "https://my-proxy.example.com/v1",
					modelOverrides: {
						"deepseek-v4-flash": {
							name: "Proxied Flash",
						},
					},
				},
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const flash = registry.find("deepseek", "deepseek-v4-flash");
			const pro = registry.find("deepseek", "deepseek-v4-pro");

			expect(flash?.baseUrl).toBe("https://my-proxy.example.com/v1");
			expect(flash?.name).toBe("Proxied Flash");
			expect(pro?.baseUrl).toBe("https://my-proxy.example.com/v1");
			expect(pro?.name).not.toBe("Proxied Flash");
		});

		test("model override for non-existent model ID is ignored", () => {
			writeRawModelsJson({
				deepseek: {
					modelOverrides: {
						"nonexistent-model-id": {
							name: "This should not appear",
						},
					},
				},
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			expect(registry.getAll().some((m) => m.id === "nonexistent-model-id")).toBe(false);
			expect(registry.getError()).toBeUndefined();
		});

		test("model override can change cost fields partially", () => {
			writeRawModelsJson({
				deepseek: {
					modelOverrides: {
						"deepseek-v4-flash": {
							cost: { input: 99 },
						},
					},
				},
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const flash = registry.find("deepseek", "deepseek-v4-flash");

			expect(flash?.cost.input).toBe(99);
			expect(flash?.cost.output).toBeGreaterThan(0);
		});

		test("model override can add headers at request time", async () => {
			writeRawModelsJson({
				deepseek: {
					modelOverrides: {
						"deepseek-v4-flash": {
							headers: { "X-Custom-Model-Header": "value" },
						},
					},
				},
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const flash = registry.find("deepseek", "deepseek-v4-flash");
			expect(flash).toBeDefined();

			const auth = await registry.getApiKeyAndHeaders(flash!);
			expect(auth.ok).toBe(true);
			if (auth.ok) {
				expect(auth.headers?.["X-Custom-Model-Header"]).toBe("value");
			}
		});

		test("refresh() picks up model override changes", () => {
			writeRawModelsJson({
				deepseek: {
					modelOverrides: {
						"deepseek-v4-flash": {
							name: "First Name",
						},
					},
				},
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			expect(registry.find("deepseek", "deepseek-v4-flash")?.name).toBe("First Name");

			writeRawModelsJson({
				deepseek: {
					modelOverrides: {
						"deepseek-v4-flash": {
							name: "Second Name",
						},
					},
				},
			});
			registry.refresh();

			expect(registry.find("deepseek", "deepseek-v4-flash")?.name).toBe("Second Name");
		});

		test("removing model override restores built-in values", () => {
			writeRawModelsJson({
				deepseek: {
					modelOverrides: {
						"deepseek-v4-flash": {
							name: "Custom Name",
						},
					},
				},
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			expect(registry.find("deepseek", "deepseek-v4-flash")?.name).toBe("Custom Name");

			writeRawModelsJson({});
			registry.refresh();

			const restoredName = registry.find("deepseek", "deepseek-v4-flash")?.name;
			expect(restoredName).not.toBe("Custom Name");
		});
	});

	describe("dynamic provider lifecycle", () => {
		test("getProviderDisplayName resolves registered and built-in names", () => {
			const registry = ModelRegistry.create(authStorage, modelsJsonPath);

			expect(registry.getProviderDisplayName("deepseek")).toBe("DeepSeek");
			expect(registry.getProviderDisplayName("unknown-provider")).toBe("unknown-provider");

			registry.registerProvider("named-provider", {
				name: "Named Provider",
				baseUrl: "https://provider.test/v1",
				apiKey: "TEST_KEY",
				api: "openai-completions",
				models: [
					{
						id: "demo-model",
						name: "Demo Model",
						reasoning: false,
						input: ["text"],
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
						contextWindow: 128000,
						maxTokens: 4096,
					},
				],
			});
			expect(registry.getProviderDisplayName("named-provider")).toBe("Named Provider");
		});

		test("failed registerProvider does not persist invalid streamSimple config", () => {
			const registry = ModelRegistry.create(authStorage, modelsJsonPath);

			expect(() =>
				registry.registerProvider("broken-provider", {
					streamSimple: (() => {
						throw new Error("should not run");
					}) as never,
				}),
			).toThrow('Provider broken-provider: "api" is required when registering streamSimple.');

			expect(() => registry.refresh()).not.toThrow();
		});

		test("failed registerProvider does not remove existing provider models", () => {
			const registry = ModelRegistry.create(authStorage, modelsJsonPath);

			registry.registerProvider("demo-provider", {
				baseUrl: "https://provider.test/v1",
				apiKey: "TEST_KEY",
				api: "openai-completions",
				models: [
					{
						id: "demo-model",
						name: "Demo Model",
						reasoning: false,
						input: ["text"],
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
						contextWindow: 128000,
						maxTokens: 4096,
					},
				],
			});

			expect(registry.find("demo-provider", "demo-model")).toBeDefined();

			expect(() =>
				registry.registerProvider("demo-provider", {
					baseUrl: "https://provider.test/v2",
					apiKey: "TEST_KEY",
					models: [
						{
							id: "broken-model",
							name: "Broken Model",
							reasoning: false,
							input: ["text"],
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
							contextWindow: 128000,
							maxTokens: 4096,
						},
					],
				}),
			).toThrow('Provider demo-provider, model broken-model: no "api" specified.');

			expect(registry.find("demo-provider", "demo-model")).toBeDefined();
			expect(() => registry.refresh()).not.toThrow();
			expect(registry.find("demo-provider", "demo-model")).toBeDefined();
		});

		test("unregisterProvider removes custom streamSimple override and restores built-in API stream handler", () => {
			const registry = ModelRegistry.create(authStorage, modelsJsonPath);

			registry.registerProvider("stream-override-provider", {
				api: "openai-completions",
				streamSimple: () => {
					throw new Error("custom streamSimple override");
				},
			});

			let threwCustomOverride = false;
			try {
				getApiProvider("openai-completions")?.streamSimple(openAiModel, emptyContext);
			} catch (error) {
				threwCustomOverride = error instanceof Error && error.message === "custom streamSimple override";
			}
			expect(threwCustomOverride).toBe(true);

			registry.unregisterProvider("stream-override-provider");

			let threwCustomOverrideAfterUnregister = false;
			try {
				getApiProvider("openai-completions")?.streamSimple(openAiModel, emptyContext);
			} catch (error) {
				threwCustomOverrideAfterUnregister =
					error instanceof Error && error.message === "custom streamSimple override";
			}
			expect(threwCustomOverrideAfterUnregister).toBe(false);
		});

		describe("dynamic provider override persistence", () => {
			test("baseUrl-only override keeps built-in provider models after refresh", () => {
				const registry = ModelRegistry.create(authStorage, modelsJsonPath);

				registry.registerProvider("deepseek", { baseUrl: "https://proxy.test/deepseek" });
				registry.refresh();

				const dsModels = getModelsForProvider(registry, "deepseek");
				expect(dsModels.length).toBeGreaterThan(1);
				expect(dsModels.every((m) => m.baseUrl === "https://proxy.test/deepseek")).toBe(true);
			});

			test("models-only override replaces built-in provider models after refresh", () => {
				const registry = ModelRegistry.create(authStorage, modelsJsonPath);

				registry.registerProvider("deepseek", {
					...providerConfig("https://custom.test/deepseek", [{ id: "custom-ds" }]),
					baseUrl: "https://custom.test/deepseek",
				});
				registry.refresh();

				expect(getModelsForProvider(registry, "deepseek").map((m) => m.id)).toEqual(["custom-ds"]);
				expect(registry.find("deepseek", "custom-ds")?.baseUrl).toBe("https://custom.test/deepseek");
			});

			test("models plus baseUrl override replaces built-in provider models after refresh", () => {
				const registry = ModelRegistry.create(authStorage, modelsJsonPath);

				registry.registerProvider("deepseek", {
					...providerConfig("https://custom.test/deepseek", [{ id: "custom-ds" }]),
					baseUrl: "https://custom.test/deepseek",
				});
				registry.registerProvider("deepseek", { baseUrl: "https://proxy.test/deepseek" });
				registry.refresh();

				expect(getModelsForProvider(registry, "deepseek").map((m) => m.id)).toEqual(["custom-ds"]);
				expect(registry.find("deepseek", "custom-ds")?.baseUrl).toBe("https://proxy.test/deepseek");
			});

			test("models-only custom provider registration survives refresh", () => {
				const registry = ModelRegistry.create(authStorage, modelsJsonPath);

				registry.registerProvider(
					"custom-provider",
					providerConfig("https://custom.test/v1", [{ id: "custom-a" }, { id: "custom-b" }]),
				);
				registry.refresh();

				expect(getModelsForProvider(registry, "custom-provider").map((m) => m.id)).toEqual([
					"custom-a",
					"custom-b",
				]);
			});

			test("baseUrl-only override keeps custom provider models after refresh", () => {
				const registry = ModelRegistry.create(authStorage, modelsJsonPath);

				registry.registerProvider(
					"custom-provider",
					providerConfig("https://custom.test/v1", [{ id: "custom-a" }, { id: "custom-b" }]),
				);
				registry.registerProvider("custom-provider", { baseUrl: "https://proxy.test/custom" });
				registry.refresh();

				expect(getModelsForProvider(registry, "custom-provider").map((m) => m.id)).toEqual([
					"custom-a",
					"custom-b",
				]);
				expect(
					getModelsForProvider(registry, "custom-provider").every(
						(m) => m.baseUrl === "https://proxy.test/custom",
					),
				).toBe(true);
			});

			test("headers-only override keeps custom provider models after refresh", async () => {
				const registry = ModelRegistry.create(authStorage, modelsJsonPath);

				registry.registerProvider(
					"custom-provider",
					providerConfig("https://custom.test/v1", [{ id: "custom-a" }, { id: "custom-b" }]),
				);
				registry.registerProvider("custom-provider", { headers: { "x-proxy": "enabled" } });
				registry.refresh();

				const models = getModelsForProvider(registry, "custom-provider");
				expect(models.map((m) => m.id)).toEqual(["custom-a", "custom-b"]);
				expect(models.every((m) => m.baseUrl === "https://custom.test/v1")).toBe(true);
				expect(await registry.getApiKeyAndHeaders(models[0])).toMatchObject({
					ok: true,
					headers: { "x-proxy": "enabled" },
				});
			});
		});
	});

	describe("API key resolution", () => {
		function providerWithApiKey(apiKey: string) {
			return {
				baseUrl: "https://example.com/v1",
				apiKey,
				api: "openai-completions",
				models: [
					{
						id: "test-model",
						name: "Test Model",
						reasoning: false,
						input: ["text"],
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
						contextWindow: 100000,
						maxTokens: 8000,
					},
				],
			};
		}

		test("apiKey with ! prefix executes command and uses stdout", async () => {
			writeRawModelsJson({
				"custom-provider": providerWithApiKey("!echo test-api-key-from-command"),
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const apiKey = await registry.getApiKeyForProvider("custom-provider");

			expect(apiKey).toBe("test-api-key-from-command");
		});

		test("apiKey with ! prefix trims whitespace from command output", async () => {
			writeRawModelsJson({
				"custom-provider": providerWithApiKey("!echo '  spaced-key  '"),
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const apiKey = await registry.getApiKeyForProvider("custom-provider");

			expect(apiKey).toBe("spaced-key");
		});

		test("apiKey with ! prefix handles multiline output (uses trimmed result)", async () => {
			writeRawModelsJson({
				"custom-provider": providerWithApiKey("!printf 'line1\\nline2'"),
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const apiKey = await registry.getApiKeyForProvider("custom-provider");

			expect(apiKey).toBe("line1\nline2");
		});

		test("apiKey with ! prefix returns undefined on command failure", async () => {
			writeRawModelsJson({
				"custom-provider": providerWithApiKey("!exit 1"),
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const apiKey = await registry.getApiKeyForProvider("custom-provider");

			expect(apiKey).toBeUndefined();
		});

		test("apiKey with ! prefix returns undefined on nonexistent command", async () => {
			writeRawModelsJson({
				"custom-provider": providerWithApiKey("!nonexistent-command-12345"),
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const apiKey = await registry.getApiKeyForProvider("custom-provider");

			expect(apiKey).toBeUndefined();
		});

		test("apiKey with ! prefix returns undefined on empty output", async () => {
			writeRawModelsJson({
				"custom-provider": providerWithApiKey("!printf ''"),
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const apiKey = await registry.getApiKeyForProvider("custom-provider");

			expect(apiKey).toBeUndefined();
		});

		test("apiKey as environment variable name resolves to env value", async () => {
			const originalEnv = process.env.TEST_API_KEY_12345;
			process.env.TEST_API_KEY_12345 = "env-api-key-value";

			try {
				writeRawModelsJson({
					"custom-provider": providerWithApiKey("TEST_API_KEY_12345"),
				});

				const registry = ModelRegistry.create(authStorage, modelsJsonPath);
				const apiKey = await registry.getApiKeyForProvider("custom-provider");

				expect(apiKey).toBe("env-api-key-value");
			} finally {
				if (originalEnv === undefined) {
					delete process.env.TEST_API_KEY_12345;
				} else {
					process.env.TEST_API_KEY_12345 = originalEnv;
				}
			}
		});

		test("apiKey as literal value is used directly when not an env var", async () => {
			delete process.env.literal_api_key_value;

			writeRawModelsJson({
				"custom-provider": providerWithApiKey("literal_api_key_value"),
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const apiKey = await registry.getApiKeyForProvider("custom-provider");

			expect(apiKey).toBe("literal_api_key_value");
		});

		test("apiKey command can use shell features like pipes", async () => {
			writeRawModelsJson({
				"custom-provider": providerWithApiKey("!echo 'hello world' | tr ' ' '-'"),
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const apiKey = await registry.getApiKeyForProvider("custom-provider");

			expect(apiKey).toBe("hello-world");
		});

		describe("request-time resolution", () => {
			test("command is executed on every provider lookup", async () => {
				const counterFile = join(tempDir, "counter");
				writeFileSync(counterFile, "0");

				const counterPath = toShPath(counterFile);
				const command = `!sh -c 'count=$(cat "${counterPath}"); echo $((count + 1)) > "${counterPath}"; echo "key-value"'`;
				writeRawModelsJson({
					"custom-provider": providerWithApiKey(command),
				});

				const registry = ModelRegistry.create(authStorage, modelsJsonPath);
				await registry.getApiKeyForProvider("custom-provider");
				await registry.getApiKeyForProvider("custom-provider");
				await registry.getApiKeyForProvider("custom-provider");

				const count = parseInt(readFileSync(counterFile, "utf-8").trim(), 10);
				expect(count).toBe(3);
			});

			test("commands are re-executed across registry instances", async () => {
				const counterFile = join(tempDir, "counter");
				writeFileSync(counterFile, "0");

				const counterPath = toShPath(counterFile);
				const command = `!sh -c 'count=$(cat "${counterPath}"); echo $((count + 1)) > "${counterPath}"; echo "key-value"'`;
				writeRawModelsJson({
					"custom-provider": providerWithApiKey(command),
				});

				const registry1 = ModelRegistry.create(authStorage, modelsJsonPath);
				await registry1.getApiKeyForProvider("custom-provider");

				const registry2 = ModelRegistry.create(authStorage, modelsJsonPath);
				await registry2.getApiKeyForProvider("custom-provider");

				const count = parseInt(readFileSync(counterFile, "utf-8").trim(), 10);
				expect(count).toBe(2);
			});

			test("different commands resolve independently", async () => {
				writeRawModelsJson({
					"provider-a": providerWithApiKey("!echo key-a"),
					"provider-b": providerWithApiKey("!echo key-b"),
				});

				const registry = ModelRegistry.create(authStorage, modelsJsonPath);

				const keyA = await registry.getApiKeyForProvider("provider-a");
				const keyB = await registry.getApiKeyForProvider("provider-b");

				expect(keyA).toBe("key-a");
				expect(keyB).toBe("key-b");
			});

			test("failed commands are retried", async () => {
				const counterFile = join(tempDir, "counter");
				writeFileSync(counterFile, "0");

				const counterPath = toShPath(counterFile);
				const command = `!sh -c 'count=$(cat "${counterPath}"); echo $((count + 1)) > "${counterPath}"; exit 1'`;
				writeRawModelsJson({
					"custom-provider": providerWithApiKey(command),
				});

				const registry = ModelRegistry.create(authStorage, modelsJsonPath);
				const key1 = await registry.getApiKeyForProvider("custom-provider");
				const key2 = await registry.getApiKeyForProvider("custom-provider");

				expect(key1).toBeUndefined();
				expect(key2).toBeUndefined();

				const count = parseInt(readFileSync(counterFile, "utf-8").trim(), 10);
				expect(count).toBe(2);
			});

			test("provider auth status reports apiKey environment variables from models.json", () => {
				const envVarName = "TEST_API_KEY_STATUS_TEST_98765";
				const originalEnv = process.env[envVarName];

				try {
					process.env[envVarName] = "status-test-key";

					writeRawModelsJson({
						"custom-provider": providerWithApiKey(envVarName),
					});

					const registry = ModelRegistry.create(authStorage, modelsJsonPath);

					expect(registry.getProviderAuthStatus("custom-provider")).toEqual({
						configured: true,
						source: "environment",
						label: envVarName,
					});
				} finally {
					if (originalEnv === undefined) {
						delete process.env[envVarName];
					} else {
						process.env[envVarName] = originalEnv;
					}
				}
			});

			test("provider auth status reports non-env apiKey values from models.json as a config key", () => {
				writeRawModelsJson({
					"custom-provider": providerWithApiKey("literal_api_key_value"),
				});

				const registry = ModelRegistry.create(authStorage, modelsJsonPath);

				expect(registry.getProviderAuthStatus("custom-provider")).toEqual({
					configured: true,
					source: "models_json_key",
				});
			});

			test("provider auth status reports command apiKey values from models.json without executing them", () => {
				const counterFile = join(tempDir, "status-counter");
				writeFileSync(counterFile, "0");
				const counterPath = toShPath(counterFile);
				const command = `!sh -c 'echo 1 > "${counterPath}"; echo key-value'`;
				writeRawModelsJson({
					"custom-provider": providerWithApiKey(command),
				});

				const registry = ModelRegistry.create(authStorage, modelsJsonPath);

				expect(registry.getProviderAuthStatus("custom-provider")).toEqual({
					configured: true,
					source: "models_json_command",
				});
				expect(readFileSync(counterFile, "utf-8")).toBe("0");
			});

			test("environment variables are not cached (changes are picked up)", async () => {
				const envVarName = "TEST_API_KEY_CACHE_TEST_98765";
				const originalEnv = process.env[envVarName];

				try {
					process.env[envVarName] = "first-value";

					writeRawModelsJson({
						"custom-provider": providerWithApiKey(envVarName),
					});

					const registry = ModelRegistry.create(authStorage, modelsJsonPath);

					const key1 = await registry.getApiKeyForProvider("custom-provider");
					expect(key1).toBe("first-value");

					process.env[envVarName] = "second-value";

					const key2 = await registry.getApiKeyForProvider("custom-provider");
					expect(key2).toBe("second-value");
				} finally {
					if (originalEnv === undefined) {
						delete process.env[envVarName];
					} else {
						process.env[envVarName] = originalEnv;
					}
				}
			});

			test("getAvailable does not execute command-backed apiKey resolution", async () => {
				const counterFile = join(tempDir, "counter");
				writeFileSync(counterFile, "0");

				const counterPath = toShPath(counterFile);
				const command = `!sh -c 'count=$(cat "${counterPath}"); echo $((count + 1)) > "${counterPath}"; echo "key-value"'`;
				writeRawModelsJson({
					"custom-provider": providerWithApiKey(command),
				});

				const registry = ModelRegistry.create(authStorage, modelsJsonPath);
				const available = registry.getAvailable();

				expect(available.some((m) => m.provider === "custom-provider")).toBe(true);
				const count = parseInt(readFileSync(counterFile, "utf-8").trim(), 10);
				expect(count).toBe(0);
			});

			test("getApiKeyAndHeaders resolves authHeader on every request", async () => {
				const tokenFile = join(tempDir, "token");
				writeFileSync(tokenFile, "token-1");
				const tokenPath = toShPath(tokenFile);

				writeRawModelsJson({
					"custom-provider": {
						...providerWithApiKey(`!sh -c 'cat "${tokenPath}"'`),
						authHeader: true,
					},
				});

				const registry = ModelRegistry.create(authStorage, modelsJsonPath);
				const model = registry.find("custom-provider", "test-model");
				expect(model).toBeDefined();

				const auth1 = await registry.getApiKeyAndHeaders(model!);
				expect(auth1).toEqual({
					ok: true,
					apiKey: "token-1",
					headers: { Authorization: "Bearer token-1" },
				});

				writeFileSync(tokenFile, "token-2");

				const auth2 = await registry.getApiKeyAndHeaders(model!);
				expect(auth2).toEqual({
					ok: true,
					apiKey: "token-2",
					headers: { Authorization: "Bearer token-2" },
				});
			});

			test("getApiKeyAndHeaders returns an error for failed authHeader resolution", async () => {
				writeRawModelsJson({
					"custom-provider": {
						...providerWithApiKey("!exit 1"),
						authHeader: true,
					},
				});

				const registry = ModelRegistry.create(authStorage, modelsJsonPath);
				const model = registry.find("custom-provider", "test-model");
				expect(model).toBeDefined();

				const auth = await registry.getApiKeyAndHeaders(model!);
				expect(auth.ok).toBe(false);
				if (!auth.ok) {
					expect(auth.error).toContain('Failed to resolve API key for provider "custom-provider"');
				}
			});
		});
	});
});

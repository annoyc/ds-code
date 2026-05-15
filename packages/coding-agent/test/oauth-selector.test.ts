import { setKeybindings } from "@mariozechner/pi-tui";
import stripAnsi from "strip-ansi";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.js";
import { KeybindingsManager } from "../src/core/keybindings.js";
import { BUILT_IN_PROVIDER_DISPLAY_NAMES } from "../src/core/provider-display-names.js";
import { OAuthSelectorComponent } from "../src/modes/interactive/components/oauth-selector.js";
import { isApiKeyLoginProvider } from "../src/modes/interactive/interactive-mode.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

const originalDeepseekApiKey = process.env.DEEPSEEK_API_KEY;

describe("OAuthSelectorComponent", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	beforeEach(() => {
		setKeybindings(new KeybindingsManager());
	});

	afterEach(() => {
		if (originalDeepseekApiKey === undefined) {
			delete process.env.DEEPSEEK_API_KEY;
		} else {
			process.env.DEEPSEEK_API_KEY = originalDeepseekApiKey;
		}
	});

	it("treats built-in providers as API-key login providers", () => {
		expect(isApiKeyLoginProvider("deepseek")).toBe(true);
		expect(BUILT_IN_PROVIDER_DISPLAY_NAMES.deepseek).toBe("DeepSeek");
	});

	it("treats unknown custom providers as API-key login providers", () => {
		expect(isApiKeyLoginProvider("custom-proxy")).toBe(true);
	});

	it("shows stored API key auth as configured", () => {
		const authStorage = AuthStorage.inMemory({
			deepseek: { type: "api_key", key: "sk-test-key" },
		});
		const selector = new OAuthSelectorComponent(
			"login",
			authStorage,
			[{ id: "deepseek", name: "DeepSeek", authType: "api_key" }],
			() => {},
			() => {},
		);

		const output = stripAnsi(selector.render(120).join("\n"));

		expect(output).toContain("DeepSeek");
		expect(output).toContain("configured");
	});

	it("shows environment API key auth as configured", () => {
		process.env.DEEPSEEK_API_KEY = "test-deepseek-key";
		const authStorage = AuthStorage.inMemory();
		const selector = new OAuthSelectorComponent(
			"login",
			authStorage,
			[{ id: "deepseek", name: "DeepSeek", authType: "api_key" }],
			() => {},
			() => {},
		);

		const output = stripAnsi(selector.render(120).join("\n"));

		expect(output).toContain("DeepSeek");
		expect(output).toContain("✓ env: DEEPSEEK_API_KEY");
		expect(output).not.toContain("unconfigured");
	});

	it("shows custom provider environment API key auth from status resolver", () => {
		const authStorage = AuthStorage.inMemory();
		const selector = new OAuthSelectorComponent(
			"login",
			authStorage,
			[{ id: "ollama", name: "ollama", authType: "api_key" }],
			() => {},
			() => {},
			() => ({ configured: true, source: "environment", label: "OLLAMA_API_KEY" }),
		);

		const output = stripAnsi(selector.render(120).join("\n"));

		expect(output).toContain("ollama");
		expect(output).toContain("✓ env: OLLAMA_API_KEY");
		expect(output).not.toContain("unconfigured");
	});

	it("shows models.json API key auth as configured", () => {
		const authStorage = AuthStorage.inMemory();
		const selector = new OAuthSelectorComponent(
			"login",
			authStorage,
			[{ id: "local-proxy", name: "local-proxy", authType: "api_key" }],
			() => {},
			() => {},
			() => ({ configured: true, source: "models_json_key" }),
		);

		const output = stripAnsi(selector.render(120).join("\n"));

		expect(output).toContain("local-proxy");
		expect(output).toContain("✓ key in models.json");
		expect(output).not.toContain("unconfigured");
	});

	it("shows models.json command auth as configured", () => {
		const authStorage = AuthStorage.inMemory();
		const selector = new OAuthSelectorComponent(
			"login",
			authStorage,
			[{ id: "op-proxy", name: "op-proxy", authType: "api_key" }],
			() => {},
			() => {},
			() => ({ configured: true, source: "models_json_command" }),
		);

		const output = stripAnsi(selector.render(120).join("\n"));

		expect(output).toContain("op-proxy");
		expect(output).toContain("✓ command in models.json");
		expect(output).not.toContain("unconfigured");
	});
});

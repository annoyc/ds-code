import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.js";
import { clearConfigValueCache } from "../src/core/resolve-config-value.js";

describe("AuthStorage", () => {
	let tempDir: string;
	let authJsonPath: string;
	let authStorage: AuthStorage;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-test-auth-storage-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		authJsonPath = join(tempDir, "auth.json");
	});

	afterEach(() => {
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true });
		}
		clearConfigValueCache();
	});

	function writeAuthJson(data: Record<string, unknown>) {
		writeFileSync(authJsonPath, JSON.stringify(data));
	}

	function toShPath(value: string): string {
		return value.replace(/\\/g, "/").replace(/"/g, '\\"');
	}

	describe("API key resolution", () => {
		test("literal API key is returned directly", async () => {
			writeAuthJson({
				deepseek: { type: "api_key", key: "sk-ant-literal-key" },
			});

			authStorage = AuthStorage.create(authJsonPath);
			const apiKey = await authStorage.getApiKey("deepseek");

			expect(apiKey).toBe("sk-ant-literal-key");
		});

		test("apiKey with ! prefix executes command and uses stdout", async () => {
			writeAuthJson({
				deepseek: { type: "api_key", key: "!echo test-api-key-from-command" },
			});

			authStorage = AuthStorage.create(authJsonPath);
			const apiKey = await authStorage.getApiKey("deepseek");

			expect(apiKey).toBe("test-api-key-from-command");
		});

		test("apiKey with ! prefix trims whitespace from command output", async () => {
			writeAuthJson({
				deepseek: { type: "api_key", key: "!echo '  spaced-key  '" },
			});

			authStorage = AuthStorage.create(authJsonPath);
			const apiKey = await authStorage.getApiKey("deepseek");

			expect(apiKey).toBe("spaced-key");
		});

		test("apiKey with ! prefix handles multiline output (uses trimmed result)", async () => {
			writeAuthJson({
				deepseek: { type: "api_key", key: "!printf 'line1\\nline2'" },
			});

			authStorage = AuthStorage.create(authJsonPath);
			const apiKey = await authStorage.getApiKey("deepseek");

			expect(apiKey).toBe("line1\nline2");
		});

		test("apiKey with ! prefix returns undefined on command failure", async () => {
			writeAuthJson({
				deepseek: { type: "api_key", key: "!exit 1" },
			});

			authStorage = AuthStorage.create(authJsonPath);
			const apiKey = await authStorage.getApiKey("deepseek");

			expect(apiKey).toBeUndefined();
		});

		test("apiKey with ! prefix returns undefined on nonexistent command", async () => {
			writeAuthJson({
				deepseek: { type: "api_key", key: "!nonexistent-command-12345" },
			});

			authStorage = AuthStorage.create(authJsonPath);
			const apiKey = await authStorage.getApiKey("deepseek");

			expect(apiKey).toBeUndefined();
		});

		test("apiKey with ! prefix returns undefined on empty output", async () => {
			writeAuthJson({
				deepseek: { type: "api_key", key: "!printf ''" },
			});

			authStorage = AuthStorage.create(authJsonPath);
			const apiKey = await authStorage.getApiKey("deepseek");

			expect(apiKey).toBeUndefined();
		});

		test("apiKey as environment variable name resolves to env value", async () => {
			const originalEnv = process.env.TEST_AUTH_API_KEY_12345;
			process.env.TEST_AUTH_API_KEY_12345 = "env-api-key-value";

			try {
				writeAuthJson({
					deepseek: { type: "api_key", key: "TEST_AUTH_API_KEY_12345" },
				});

				authStorage = AuthStorage.create(authJsonPath);
				const apiKey = await authStorage.getApiKey("deepseek");

				expect(apiKey).toBe("env-api-key-value");
			} finally {
				if (originalEnv === undefined) {
					delete process.env.TEST_AUTH_API_KEY_12345;
				} else {
					process.env.TEST_AUTH_API_KEY_12345 = originalEnv;
				}
			}
		});

		test("apiKey as literal value is used directly when not an env var", async () => {
			// Make sure this isn't an env var
			delete process.env.literal_api_key_value;

			writeAuthJson({
				deepseek: { type: "api_key", key: "literal_api_key_value" },
			});

			authStorage = AuthStorage.create(authJsonPath);
			const apiKey = await authStorage.getApiKey("deepseek");

			expect(apiKey).toBe("literal_api_key_value");
		});

		test("apiKey command can use shell features like pipes", async () => {
			writeAuthJson({
				deepseek: { type: "api_key", key: "!echo 'hello world' | tr ' ' '-'" },
			});

			authStorage = AuthStorage.create(authJsonPath);
			const apiKey = await authStorage.getApiKey("deepseek");

			expect(apiKey).toBe("hello-world");
		});

		describe("caching", () => {
			test("command is only executed once per process", async () => {
				// Use a command that writes to a file to count invocations
				const counterFile = join(tempDir, "counter");
				writeFileSync(counterFile, "0");

				const counterPath = toShPath(counterFile);
				const command = `!sh -c 'count=$(cat "${counterPath}"); echo $((count + 1)) > "${counterPath}"; echo "key-value"'`;
				writeAuthJson({
					deepseek: { type: "api_key", key: command },
				});

				authStorage = AuthStorage.create(authJsonPath);

				// Call multiple times
				await authStorage.getApiKey("deepseek");
				await authStorage.getApiKey("deepseek");
				await authStorage.getApiKey("deepseek");

				// Command should have only run once
				const count = parseInt(readFileSync(counterFile, "utf-8").trim(), 10);
				expect(count).toBe(1);
			});

			test("cache persists across AuthStorage instances", async () => {
				const counterFile = join(tempDir, "counter");
				writeFileSync(counterFile, "0");

				const counterPath = toShPath(counterFile);
				const command = `!sh -c 'count=$(cat "${counterPath}"); echo $((count + 1)) > "${counterPath}"; echo "key-value"'`;
				writeAuthJson({
					deepseek: { type: "api_key", key: command },
				});

				// Create multiple AuthStorage instances
				const storage1 = AuthStorage.create(authJsonPath);
				await storage1.getApiKey("deepseek");

				const storage2 = AuthStorage.create(authJsonPath);
				await storage2.getApiKey("deepseek");

				// Command should still have only run once
				const count = parseInt(readFileSync(counterFile, "utf-8").trim(), 10);
				expect(count).toBe(1);
			});

			test("clearConfigValueCache allows command to run again", async () => {
				const counterFile = join(tempDir, "counter");
				writeFileSync(counterFile, "0");

				const counterPath = toShPath(counterFile);
				const command = `!sh -c 'count=$(cat "${counterPath}"); echo $((count + 1)) > "${counterPath}"; echo "key-value"'`;
				writeAuthJson({
					deepseek: { type: "api_key", key: command },
				});

				authStorage = AuthStorage.create(authJsonPath);
				await authStorage.getApiKey("deepseek");

				// Clear cache and call again
				clearConfigValueCache();
				await authStorage.getApiKey("deepseek");

				// Command should have run twice
				const count = parseInt(readFileSync(counterFile, "utf-8").trim(), 10);
				expect(count).toBe(2);
			});

			test("different commands are cached separately", async () => {
				writeAuthJson({
					deepseek: { type: "api_key", key: "!echo key-deepseek" },
					"provider-b": { type: "api_key", key: "!echo key-b" },
				});

				authStorage = AuthStorage.create(authJsonPath);

				const keyA = await authStorage.getApiKey("deepseek");
				const keyB = await authStorage.getApiKey("provider-b");

				expect(keyA).toBe("key-deepseek");
				expect(keyB).toBe("key-b");
			});

			test("failed commands are cached (not retried)", async () => {
				const counterFile = join(tempDir, "counter");
				writeFileSync(counterFile, "0");

				const counterPath = toShPath(counterFile);
				const command = `!sh -c 'count=$(cat "${counterPath}"); echo $((count + 1)) > "${counterPath}"; exit 1'`;
				writeAuthJson({
					deepseek: { type: "api_key", key: command },
				});

				authStorage = AuthStorage.create(authJsonPath);

				// Call multiple times - all should return undefined
				const key1 = await authStorage.getApiKey("deepseek");
				const key2 = await authStorage.getApiKey("deepseek");

				expect(key1).toBeUndefined();
				expect(key2).toBeUndefined();

				// Command should have only run once despite failures
				const count = parseInt(readFileSync(counterFile, "utf-8").trim(), 10);
				expect(count).toBe(1);
			});

			test("environment variables are not cached (changes are picked up)", async () => {
				const envVarName = "TEST_AUTH_KEY_CACHE_TEST_98765";
				const originalEnv = process.env[envVarName];

				try {
					process.env[envVarName] = "first-value";

					writeAuthJson({
						deepseek: { type: "api_key", key: envVarName },
					});

					authStorage = AuthStorage.create(authJsonPath);

					const key1 = await authStorage.getApiKey("deepseek");
					expect(key1).toBe("first-value");

					// Change env var
					process.env[envVarName] = "second-value";

					const key2 = await authStorage.getApiKey("deepseek");
					expect(key2).toBe("second-value");
				} finally {
					if (originalEnv === undefined) {
						delete process.env[envVarName];
					} else {
						process.env[envVarName] = originalEnv;
					}
				}
			});
		});
	});

	describe("persistence semantics", () => {
		test("set preserves unrelated external edits", () => {
			writeAuthJson({
				deepseek: { type: "api_key", key: "old-deepseek" },
				"provider-b": { type: "api_key", key: "b-key" },
			});

			authStorage = AuthStorage.create(authJsonPath);

			// Simulate external edit while process is running
			writeAuthJson({
				deepseek: { type: "api_key", key: "old-deepseek" },
				"provider-b": { type: "api_key", key: "b-key" },
				"provider-c": { type: "api_key", key: "c-key" },
			});

			authStorage.set("deepseek", { type: "api_key", key: "new-deepseek" });

			const updated = JSON.parse(readFileSync(authJsonPath, "utf-8")) as Record<string, { key: string }>;
			expect(updated.deepseek.key).toBe("new-deepseek");
			expect(updated["provider-b"].key).toBe("b-key");
			expect(updated["provider-c"].key).toBe("c-key");
		});

		test("remove preserves unrelated external edits", () => {
			writeAuthJson({
				deepseek: { type: "api_key", key: "deepseek-key" },
				"provider-b": { type: "api_key", key: "b-key" },
			});

			authStorage = AuthStorage.create(authJsonPath);

			// Simulate external edit while process is running
			writeAuthJson({
				deepseek: { type: "api_key", key: "deepseek-key" },
				"provider-b": { type: "api_key", key: "b-key" },
				"provider-c": { type: "api_key", key: "c-key" },
			});

			authStorage.remove("deepseek");

			const updated = JSON.parse(readFileSync(authJsonPath, "utf-8")) as Record<string, { key: string }>;
			expect(updated.deepseek).toBeUndefined();
			expect(updated["provider-b"].key).toBe("b-key");
			expect(updated["provider-c"].key).toBe("c-key");
		});

		test("does not overwrite malformed auth file after load error", () => {
			writeAuthJson({
				deepseek: { type: "api_key", key: "deepseek-key" },
			});

			authStorage = AuthStorage.create(authJsonPath);
			writeFileSync(authJsonPath, "{invalid-json", "utf-8");

			authStorage.reload();
			authStorage.set("provider-b", { type: "api_key", key: "b-key" });

			const raw = readFileSync(authJsonPath, "utf-8");
			expect(raw).toBe("{invalid-json");
		});

		test("reload records parse errors and drainErrors clears buffer", () => {
			writeAuthJson({
				deepseek: { type: "api_key", key: "deepseek-key" },
			});

			authStorage = AuthStorage.create(authJsonPath);
			writeFileSync(authJsonPath, "{invalid-json", "utf-8");

			authStorage.reload();

			// Keeps previous in-memory data on reload failure
			expect(authStorage.get("deepseek")).toEqual({ type: "api_key", key: "deepseek-key" });

			const firstDrain = authStorage.drainErrors();
			expect(firstDrain.length).toBeGreaterThan(0);
			expect(firstDrain[0]).toBeInstanceOf(Error);

			const secondDrain = authStorage.drainErrors();
			expect(secondDrain).toHaveLength(0);
		});
	});

	describe("auth status", () => {
		test("does not expose stored API keys", () => {
			authStorage = AuthStorage.inMemory({
				deepseek: { type: "api_key", key: "secret-api-key-a" },
				"provider-b": { type: "api_key", key: "secret-api-key-b" },
			});

			expect(authStorage.getAuthStatus("deepseek")).toEqual({ configured: true, source: "stored" });
			expect(authStorage.getAuthStatus("provider-b")).toEqual({ configured: true, source: "stored" });
			expect(JSON.stringify(authStorage.getAuthStatus("deepseek"))).not.toContain("secret-api-key-a");
			expect(JSON.stringify(authStorage.getAuthStatus("provider-b"))).not.toContain("secret-api-key-b");
		});
	});

	describe("runtime overrides", () => {
		test("runtime override takes priority over auth.json", async () => {
			writeAuthJson({
				deepseek: { type: "api_key", key: "!echo stored-key" },
			});

			authStorage = AuthStorage.create(authJsonPath);
			authStorage.setRuntimeApiKey("deepseek", "runtime-key");

			const apiKey = await authStorage.getApiKey("deepseek");

			expect(apiKey).toBe("runtime-key");
		});

		test("removing runtime override falls back to auth.json", async () => {
			writeAuthJson({
				deepseek: { type: "api_key", key: "!echo stored-key" },
			});

			authStorage = AuthStorage.create(authJsonPath);
			authStorage.setRuntimeApiKey("deepseek", "runtime-key");
			authStorage.removeRuntimeApiKey("deepseek");

			const apiKey = await authStorage.getApiKey("deepseek");

			expect(apiKey).toBe("stored-key");
		});
	});
});

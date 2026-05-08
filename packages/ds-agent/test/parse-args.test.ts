import { describe, expect, it } from "vitest";

// We test parseArgs by importing main.ts internals.
// Since parseArgs and buildPiArgv are not exported, we test the public
// main() behavior indirectly, and test config loading directly.

import { DEFAULT_CONFIG, loadConfig } from "../src/config.js";

describe("loadConfig", () => {
	it("returns default config when no file exists", () => {
		const config = loadConfig();
		expect(config.model).toBe(DEFAULT_CONFIG.model);
		expect(config.mode).toBe("agent");
		expect(config.autoModel).toBe(true);
		expect(config.costCurrency).toBe("cny");
	});

	it("respects DS_MODEL env var", () => {
		const original = process.env.DS_MODEL;
		process.env.DS_MODEL = "deepseek-v4-flash";
		try {
			const config = loadConfig();
			expect(config.model).toBe("deepseek-v4-flash");
		} finally {
			if (original !== undefined) {
				process.env.DS_MODEL = original;
			} else {
				delete process.env.DS_MODEL;
			}
		}
	});

	it("respects DS_MODE env var", () => {
		const original = process.env.DS_MODE;
		process.env.DS_MODE = "yolo";
		try {
			const config = loadConfig();
			expect(config.mode).toBe("yolo");
		} finally {
			if (original !== undefined) {
				process.env.DS_MODE = original;
			} else {
				delete process.env.DS_MODE;
			}
		}
	});

	it("ignores invalid DS_MODE", () => {
		const original = process.env.DS_MODE;
		process.env.DS_MODE = "invalid";
		try {
			const config = loadConfig();
			expect(config.mode).toBe("agent");
		} finally {
			if (original !== undefined) {
				process.env.DS_MODE = original;
			} else {
				delete process.env.DS_MODE;
			}
		}
	});

	it("has correct default execPolicy", () => {
		const config = loadConfig();
		expect(config.execPolicy.trustedPrefixes).toEqual([]);
		expect(config.execPolicy.deniedPrefixes).toEqual([]);
	});
});

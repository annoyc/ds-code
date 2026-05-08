import { describe, it, expect } from "vitest";
import {
	pricingForModel,
	calculateTurnCost,
	formatCostAmount,
	formatCostEstimate,
	getCurrencySymbol,
} from "../src/pricing/index.js";

describe("pricingForModel", () => {
	it("returns v4-pro discount pricing before discount deadline", () => {
		const before = new Date("2026-05-01T00:00:00Z");
		const pricing = pricingForModel("deepseek-v4-pro", before);
		expect(pricing).not.toBeNull();
		expect(pricing!.cny.inputCacheHit).toBe(0.025);
		expect(pricing!.cny.inputCacheMiss).toBe(3.0);
		expect(pricing!.cny.output).toBe(6.0);
	});

	it("returns v4-pro base pricing after discount deadline", () => {
		const after = new Date("2026-06-01T00:00:00Z");
		const pricing = pricingForModel("deepseek-v4-pro", after);
		expect(pricing).not.toBeNull();
		expect(pricing!.cny.inputCacheMiss).toBe(12.0);
	});

	it("returns flash pricing for flash model", () => {
		const pricing = pricingForModel("deepseek-v4-flash");
		expect(pricing).not.toBeNull();
		expect(pricing!.cny.inputCacheMiss).toBe(1.0);
		expect(pricing!.cny.output).toBe(2.0);
	});

	it("returns null for non-DeepSeek models", () => {
		expect(pricingForModel("gpt-4o")).toBeNull();
		expect(pricingForModel("claude-3-opus")).toBeNull();
	});

	it("returns null for deepseek-ai/ prefixed models", () => {
		expect(pricingForModel("deepseek-ai/deepseek-coder")).toBeNull();
	});

	it("handles v4pro without hyphen", () => {
		const pricing = pricingForModel("deepseek-v4pro");
		expect(pricing).not.toBeNull();
	});
});

describe("calculateTurnCost", () => {
	it("calculates cost with cache breakdown", () => {
		const cost = calculateTurnCost("deepseek-v4-flash", {
			input: 1_000_000,
			output: 500_000,
			cacheRead: 800_000,
		});
		expect(cost).not.toBeNull();
		expect(cost!.cny).toBeGreaterThan(0);
		expect(cost!.usd).toBeGreaterThan(0);
	});

	it("returns null for unknown models", () => {
		const cost = calculateTurnCost("gpt-4o", { input: 100, output: 100 });
		expect(cost).toBeNull();
	});

	it("handles zero usage", () => {
		const cost = calculateTurnCost("deepseek-v4-flash", {
			input: 0,
			output: 0,
		});
		expect(cost).not.toBeNull();
		expect(cost!.cny).toBe(0);
	});

	it("derives cache miss from input minus cache read when cacheMiss not provided", () => {
		const cost = calculateTurnCost("deepseek-v4-flash", {
			input: 1000,
			output: 500,
			cacheRead: 600,
		});
		expect(cost).not.toBeNull();
		expect(cost!.cny).toBeGreaterThan(0);
	});
});

describe("formatCostAmount", () => {
	it("formats amounts under 0.0001", () => {
		expect(formatCostAmount(0.00001, "cny")).toBe("<¥0.0001");
	});

	it("formats small amounts with 4 decimal places", () => {
		expect(formatCostAmount(0.005, "cny")).toBe("¥0.0050");
	});

	it("formats normal amounts with 2 decimal places", () => {
		expect(formatCostAmount(1.5, "usd")).toBe("$1.50");
	});
});

describe("formatCostEstimate", () => {
	it("formats CNY", () => {
		const result = formatCostEstimate({ usd: 1, cny: 7.2 }, "cny");
		expect(result).toBe("¥7.20");
	});

	it("formats USD", () => {
		const result = formatCostEstimate({ usd: 1.5, cny: 10.8 }, "usd");
		expect(result).toBe("$1.50");
	});
});

describe("getCurrencySymbol", () => {
	it("returns $ for usd", () => {
		expect(getCurrencySymbol("usd")).toBe("$");
	});

	it("returns ¥ for cny", () => {
		expect(getCurrencySymbol("cny")).toBe("¥");
	});
});

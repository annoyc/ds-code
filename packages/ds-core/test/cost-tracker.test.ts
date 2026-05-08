import { beforeEach, describe, expect, it } from "vitest";
import { CostTracker } from "../src/pricing/cost-tracker.js";

describe("CostTracker", () => {
	let tracker: CostTracker;

	beforeEach(() => {
		tracker = new CostTracker();
	});

	it("starts with zero cost", () => {
		const cost = tracker.getCurrent();
		expect(cost.usd).toBe(0);
		expect(cost.cny).toBe(0);
	});

	it("accumulates costs from reports", () => {
		tracker.report("deepseek-v4-flash", { input: 1000, output: 500 });
		const cost = tracker.getCurrent();
		expect(cost.cny).toBeGreaterThan(0);
		expect(cost.usd).toBeGreaterThan(0);
	});

	it("ignores non-DeepSeek models", () => {
		tracker.report("gpt-4o", { input: 1000, output: 500 });
		const cost = tracker.getCurrent();
		expect(cost.usd).toBe(0);
		expect(cost.cny).toBe(0);
	});

	it("drain returns accumulated cost and resets", () => {
		tracker.report("deepseek-v4-flash", { input: 1000, output: 500 });
		const drained = tracker.drain();
		expect(drained.cny).toBeGreaterThan(0);

		const after = tracker.getCurrent();
		expect(after.usd).toBe(0);
		expect(after.cny).toBe(0);
	});

	it("reset clears accumulated cost", () => {
		tracker.report("deepseek-v4-flash", { input: 1000, output: 500 });
		tracker.reset();
		const cost = tracker.getCurrent();
		expect(cost.usd).toBe(0);
		expect(cost.cny).toBe(0);
	});

	it("accumulates multiple reports", () => {
		tracker.report("deepseek-v4-flash", { input: 1000, output: 500 });
		const first = tracker.getCurrent().cny;

		tracker.report("deepseek-v4-flash", { input: 2000, output: 1000 });
		const second = tracker.getCurrent().cny;

		expect(second).toBeGreaterThan(first);
	});

	it("handles cache read in usage", () => {
		tracker.report("deepseek-v4-flash", {
			input: 1000,
			output: 500,
			cacheRead: 800,
		});
		const cost = tracker.getCurrent();
		expect(cost.cny).toBeGreaterThan(0);
	});
});

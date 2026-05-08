import { describe, expect, it } from "vitest";
import { createOverflowRecovery, enhanceCompaction } from "../src/session/compaction-enhancer.js";

describe("enhanceCompaction", () => {
	it("returns undefined for invalid events", async () => {
		const handler = enhanceCompaction();
		expect(await handler(null)).toBeUndefined();
		expect(await handler({})).toBeUndefined();
		expect(await handler("not an object")).toBeUndefined();
	});

	it("advises against compaction when utilization is low", async () => {
		const handler = enhanceCompaction();
		const result = await handler({ tokensBefore: 50_000, contextWindow: 128_000 });
		expect(result).not.toBeUndefined();
		expect(result!.shouldCompact).toBe(false);
	});

	it("defers compaction when cache hit ratio is high", async () => {
		const handler = enhanceCompaction();
		const result = await handler({
			tokensBefore: 90_000,
			contextWindow: 128_000,
			cacheHitRatio: 0.7,
		});
		expect(result).not.toBeUndefined();
		expect(result!.shouldCompact).toBe(false);
		expect(result!.reason).toContain("cache");
	});

	it("recommends aggressive compaction at near-full utilization", async () => {
		const handler = enhanceCompaction();
		const result = await handler({
			tokensBefore: 124_000,
			contextWindow: 128_000,
		});
		expect(result).not.toBeUndefined();
		expect(result!.shouldCompact).toBe(true);
		expect(result!.aggressiveness).toBe("aggressive");
		expect(result!.targetTokenReduction).toBeGreaterThan(0);
	});

	it("recommends moderate compaction at high utilization", async () => {
		const handler = enhanceCompaction();
		const result = await handler({
			tokensBefore: 112_000,
			contextWindow: 128_000,
		});
		expect(result).not.toBeUndefined();
		expect(result!.shouldCompact).toBe(true);
		expect(result!.aggressiveness).toBe("moderate");
	});

	it("recommends conservative compaction at moderate utilization", async () => {
		const handler = enhanceCompaction();
		const result = await handler({
			tokensBefore: 82_000,
			contextWindow: 128_000,
		});
		expect(result).not.toBeUndefined();
		expect(result!.shouldCompact).toBe(true);
		expect(result!.aggressiveness).toBe("conservative");
	});

	it("respects custom cacheHitThreshold", async () => {
		const handler = enhanceCompaction({ cacheHitThreshold: 0.9 });
		const result = await handler({
			tokensBefore: 90_000,
			contextWindow: 128_000,
			cacheHitRatio: 0.7,
		});
		expect(result!.shouldCompact).toBe(true);
	});
});

describe("createOverflowRecovery", () => {
	it("returns true when context is nearly full with enough messages", async () => {
		const recovery = createOverflowRecovery();
		const result = await recovery.handleOverflow({
			tokenCount: 126_000,
			contextWindow: 128_000,
			messageCount: 5,
		});
		expect(result).toBe(true);
	});

	it("returns false when context has room", async () => {
		const recovery = createOverflowRecovery();
		const result = await recovery.handleOverflow({
			tokenCount: 50_000,
			contextWindow: 128_000,
			messageCount: 5,
		});
		expect(result).toBe(false);
	});

	it("returns false when too few messages", async () => {
		const recovery = createOverflowRecovery();
		const result = await recovery.handleOverflow({
			tokenCount: 126_000,
			contextWindow: 128_000,
			messageCount: 1,
		});
		expect(result).toBe(false);
	});

	it("returns false for invalid session", async () => {
		const recovery = createOverflowRecovery();
		expect(await recovery.handleOverflow(null)).toBe(false);
		expect(await recovery.handleOverflow({})).toBe(false);
	});
});

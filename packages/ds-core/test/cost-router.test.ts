import { describe, it, expect } from "vitest";
import { CostRouter, type RouteContext } from "../src/pricing/cost-router.js";

function makeRouter(overrides?: Partial<ConstructorParameters<typeof CostRouter>[0]>) {
	return new CostRouter({
		autoModel: true,
		autoReasoning: true,
		defaultModel: "deepseek-v4-pro",
		flashModel: "deepseek-v4-flash",
		proModel: "deepseek-v4-pro",
		...overrides,
	});
}

describe("CostRouter", () => {
	describe("resolveModelHeuristic", () => {
		it("returns default model when autoModel is false", () => {
			const router = makeRouter({ autoModel: false });
			const result = router.resolveModelHeuristic({ messageCount: 1 });
			expect(result.model).toBe("deepseek-v4-pro");
			expect(result.needsClassification).toBe(false);
		});

		it("selects pro for high token counts", () => {
			const router = makeRouter();
			const result = router.resolveModelHeuristic({
				messageCount: 1,
				estimatedInputTokens: 50_000,
			});
			expect(result.model).toBe("deepseek-v4-pro");
			expect(result.needsClassification).toBe(false);
		});

		it("selects pro for conversations with 5+ messages", () => {
			const router = makeRouter();
			const result = router.resolveModelHeuristic({ messageCount: 5 });
			expect(result.model).toBe("deepseek-v4-pro");
		});

		it("selects flash for early turns with read-only tools", () => {
			const router = makeRouter();
			const result = router.resolveModelHeuristic({
				messageCount: 1,
				lastToolCalls: ["read_file", "grep"],
			});
			expect(result.model).toBe("deepseek-v4-flash");
		});

		it("selects pro when complex tools are used", () => {
			const router = makeRouter();
			const result = router.resolveModelHeuristic({
				messageCount: 2,
				lastToolCalls: ["bash"],
			});
			expect(result.model).toBe("deepseek-v4-pro");
		});

		it("needs classification for early turns without tool context", () => {
			const router = makeRouter();
			const result = router.resolveModelHeuristic({
				messageCount: 1,
				lastToolCalls: [],
			});
			expect(result.model).toBe("deepseek-v4-flash");
			expect(result.needsClassification).toBe(true);
		});

		it("does not need classification after 2 messages", () => {
			const router = makeRouter();
			const result = router.resolveModelHeuristic({
				messageCount: 3,
				lastToolCalls: ["read_file"],
			});
			expect(result.needsClassification).toBe(false);
		});
	});

	describe("resolveModel (backward compat)", () => {
		it("returns model string", () => {
			const router = makeRouter();
			const model = router.resolveModel({ messageCount: 10 });
			expect(typeof model).toBe("string");
		});
	});

	describe("resolveModelWithClassification", () => {
		it("uses flash for simple queries when classification is needed", () => {
			const router = makeRouter();
			const ctx: RouteContext = { messageCount: 1, lastToolCalls: [] };
			const model = router.resolveModelWithClassification(ctx, "simple");
			expect(model).toBe("deepseek-v4-flash");
		});

		it("uses pro for complex queries when classification is needed", () => {
			const router = makeRouter();
			const ctx: RouteContext = { messageCount: 1, lastToolCalls: [] };
			const model = router.resolveModelWithClassification(ctx, "complex");
			expect(model).toBe("deepseek-v4-pro");
		});

		it("ignores classification when heuristic is confident", () => {
			const router = makeRouter();
			const ctx: RouteContext = { messageCount: 10 };
			const model = router.resolveModelWithClassification(ctx, "simple");
			expect(model).toBe("deepseek-v4-pro");
		});

		it("falls back to heuristic when classification is undefined", () => {
			const router = makeRouter();
			const ctx: RouteContext = { messageCount: 1, lastToolCalls: [] };
			const model = router.resolveModelWithClassification(ctx, undefined);
			expect(model).toBe("deepseek-v4-flash");
		});
	});

	describe("resolveReasoningEffort", () => {
		it("returns off for early read-only sessions", () => {
			const router = makeRouter();
			const effort = router.resolveReasoningEffort({
				messageCount: 1,
				lastToolCalls: [],
			});
			expect(effort).toBe("off");
		});

		it("returns max for yolo mode", () => {
			const router = makeRouter();
			const effort = router.resolveReasoningEffort({
				messageCount: 1,
				userMode: "yolo",
			});
			expect(effort).toBe("max");
		});

		it("returns high for plan mode", () => {
			const router = makeRouter();
			const effort = router.resolveReasoningEffort({
				messageCount: 1,
				userMode: "plan",
			});
			expect(effort).toBe("high");
		});

		it("returns medium when autoReasoning is false", () => {
			const router = makeRouter({ autoReasoning: false });
			const effort = router.resolveReasoningEffort({ messageCount: 10 });
			expect(effort).toBe("medium");
		});

		it("returns high for complex long sessions", () => {
			const router = makeRouter();
			const effort = router.resolveReasoningEffort({
				messageCount: 8,
				lastToolCalls: ["bash", "bash"],
			});
			expect(effort).toBe("high");
		});
	});
});

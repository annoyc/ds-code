import { describe, it, expect, beforeEach } from "vitest";
import { SubAgentManager, type SubAgentExecuteFn } from "../src/subagent/manager.js";
import type { SubAgentManagerConfig, SubAgentResult } from "../src/subagent/types.js";
import { randomUUID } from "node:crypto";

function makeConfig(overrides?: Partial<SubAgentManagerConfig>): SubAgentManagerConfig {
	return {
		maxConcurrent: 4,
		stepTimeout: 5000,
		defaultModel: "test-model",
		sessionBootId: randomUUID(),
		...overrides,
	};
}

const echoExecute: SubAgentExecuteFn = async (ctx) => ({
	summary: `Completed: ${ctx.info.prompt}`,
	rawOutput: ctx.info.prompt,
});

describe("SubAgentManager", () => {
	let manager: SubAgentManager;

	beforeEach(() => {
		manager = new SubAgentManager(makeConfig(), echoExecute);
	});

	it("spawns and completes an agent", async () => {
		const id = await manager.spawn({
			type: "general",
			prompt: "test task",
		});
		expect(typeof id).toBe("string");

		const result = await manager.wait(id, 5000);
		expect(result.summary).toContain("test task");
	});

	it("lists agents", async () => {
		const id = await manager.spawn({
			type: "explore",
			prompt: "explore task",
		});
		await manager.wait(id, 5000);

		const list = manager.list();
		expect(list.length).toBeGreaterThanOrEqual(1);
		expect(list.find((a) => a.id === id)).toBeDefined();
	});

	it("cancels an agent", async () => {
		const slowExecute: SubAgentExecuteFn = async (ctx) => {
			await new Promise((r) => setTimeout(r, 10_000));
			return { summary: "done", rawOutput: "" };
		};
		const slowManager = new SubAgentManager(makeConfig(), slowExecute);

		const id = await slowManager.spawn({
			type: "general",
			prompt: "slow task",
		});
		await slowManager.cancel(id);

		const agent = slowManager.getAgent(id);
		expect(agent?.status).toBe("cancelled");
	});

	it("handles agent failure", async () => {
		const failExecute: SubAgentExecuteFn = async () => {
			throw new Error("task failed");
		};
		const failManager = new SubAgentManager(makeConfig(), failExecute);

		const id = await failManager.spawn({
			type: "general",
			prompt: "fail task",
		});

		await expect(failManager.wait(id, 5000)).rejects.toThrow("task failed");
	});

	it("enforces concurrency limits", async () => {
		const config = makeConfig({ maxConcurrent: 1 });
		const blockingExecute: SubAgentExecuteFn = async () => {
			await new Promise((r) => setTimeout(r, 5_000));
			return { summary: "done", rawOutput: "" };
		};
		const limitedManager = new SubAgentManager(config, blockingExecute);

		await limitedManager.spawn({ type: "general", prompt: "task 1" });
		await expect(
			limitedManager.spawn({ type: "general", prompt: "task 2" }),
		).rejects.toThrow("concurrency cap");

		await limitedManager.shutdown();
	});

	it("resolves type aliases", async () => {
		const id = await manager.spawn({
			type: "worker" as any,
			prompt: "aliased task",
		});
		const agent = manager.getAgent(id);
		expect(agent?.type).toBe("general");
		await manager.wait(id, 5000);
	});

	it("sends messages to agents", async () => {
		const receivedMessages: string[] = [];
		const msgExecute: SubAgentExecuteFn = async (ctx) => {
			await new Promise((r) => setTimeout(r, 50));
			receivedMessages.push(...ctx.drainPendingMessages());
			return { summary: "done", rawOutput: "" };
		};
		const msgManager = new SubAgentManager(makeConfig(), msgExecute);

		const id = await msgManager.spawn({ type: "general", prompt: "msg task" });
		await msgManager.sendMessage(id, "hello from parent");
		await msgManager.wait(id, 5000);

		expect(receivedMessages).toContain("hello from parent");
	});

	it("shutdown cancels all agents", async () => {
		const id = await manager.spawn({
			type: "general",
			prompt: "shutdown task",
		});
		await manager.wait(id, 5000);
		await manager.shutdown();

		const list = manager.list();
		expect(list.length).toBe(0);
	});
});

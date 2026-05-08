import { describe, it, expect } from "vitest";
import { isPlanModeAllowed, PLAN_MODE_TOOLS } from "../src/modes/plan-mode.js";
import { isYoloMode, createYoloApprovalHandler } from "../src/modes/yolo-mode.js";

describe("plan-mode", () => {
	it("PLAN_MODE_TOOLS contains read-only tools", () => {
		expect(PLAN_MODE_TOOLS).toContain("read");
		expect(PLAN_MODE_TOOLS).toContain("grep");
		expect(PLAN_MODE_TOOLS).toContain("find");
		expect(PLAN_MODE_TOOLS).toContain("ls");
	});

	it("isPlanModeAllowed allows read-only tools", () => {
		expect(isPlanModeAllowed("read")).toBe(true);
		expect(isPlanModeAllowed("grep")).toBe(true);
		expect(isPlanModeAllowed("find")).toBe(true);
		expect(isPlanModeAllowed("ls")).toBe(true);
	});

	it("isPlanModeAllowed blocks write tools", () => {
		expect(isPlanModeAllowed("write")).toBe(false);
		expect(isPlanModeAllowed("edit")).toBe(false);
		expect(isPlanModeAllowed("bash")).toBe(false);
	});
});

describe("yolo-mode", () => {
	it("isYoloMode checks DS_MODE env", () => {
		const original = process.env.DS_MODE;
		process.env.DS_MODE = "yolo";
		expect(isYoloMode()).toBe(true);

		process.env.DS_MODE = "agent";
		expect(isYoloMode()).toBe(false);

		if (original !== undefined) {
			process.env.DS_MODE = original;
		} else {
			delete process.env.DS_MODE;
		}
	});

	it("createYoloApprovalHandler returns non-blocking result", async () => {
		const handler = createYoloApprovalHandler();
		const result = await handler({});
		expect(result).toEqual({ block: false });
	});
});

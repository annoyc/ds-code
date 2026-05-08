import { describe, expect, it } from "vitest";
import { ExecPolicyEngine } from "../src/exec-policy/engine.js";
import type { ExecPolicyContext } from "../src/exec-policy/types.js";

function check(
	engine: ExecPolicyEngine,
	command: string,
	askForApproval: ExecPolicyContext["askForApproval"] = "auto",
) {
	return engine.check({ command, cwd: "/tmp", askForApproval });
}

describe("ExecPolicyEngine", () => {
	describe("builtin defaults", () => {
		it("trusts read-only commands", () => {
			const engine = new ExecPolicyEngine([ExecPolicyEngine.builtinDefault()]);
			expect(check(engine, "ls -la").type).toBe("skip");
			expect(check(engine, "cat file.txt").type).toBe("skip");
			expect(check(engine, "git status").type).toBe("skip");
			expect(check(engine, "git log --oneline").type).toBe("skip");
			expect(check(engine, "pwd").type).toBe("skip");
		});

		it("blocks dangerous commands", () => {
			const engine = new ExecPolicyEngine([ExecPolicyEngine.builtinDefault()]);
			expect(check(engine, "rm -rf /").type).toBe("forbidden");
			expect(check(engine, "sudo rm -rf /tmp").type).toBe("forbidden");
			expect(check(engine, "mkfs.ext4 /dev/sda1").type).toBe("forbidden");
		});

		it("requires approval for unknown commands", () => {
			const engine = new ExecPolicyEngine([ExecPolicyEngine.builtinDefault()]);
			const result = check(engine, "npm install express");
			expect(result.type).toBe("needsApproval");
		});
	});

	describe("user rules", () => {
		it("trusts user-configured prefixes", () => {
			const engine = new ExecPolicyEngine([
				ExecPolicyEngine.builtinDefault(),
				{
					layer: "user",
					trustedPrefixes: ["npm test", "cargo build"],
					deniedPrefixes: [],
				},
			]);
			expect(check(engine, "npm test").type).toBe("skip");
			expect(check(engine, "cargo build --release").type).toBe("skip");
		});

		it("user denied rules take precedence", () => {
			const engine = new ExecPolicyEngine([
				ExecPolicyEngine.builtinDefault(),
				{
					layer: "user",
					trustedPrefixes: [],
					deniedPrefixes: ["npm publish"],
				},
			]);
			expect(check(engine, "npm publish").type).toBe("forbidden");
		});
	});

	describe("askForApproval modes", () => {
		it("never mode skips all approval", () => {
			const engine = new ExecPolicyEngine([ExecPolicyEngine.builtinDefault()]);
			const result = check(engine, "npm install", "never");
			expect(result.type).toBe("skip");
		});

		it("always mode requires approval even for trusted", () => {
			const engine = new ExecPolicyEngine([ExecPolicyEngine.builtinDefault()]);
			const result = check(engine, "ls", "always");
			expect(result.type).toBe("needsApproval");
		});

		it("forbidden commands are blocked even in never mode", () => {
			const engine = new ExecPolicyEngine([ExecPolicyEngine.builtinDefault()]);
			const result = check(engine, "rm -rf /", "never");
			expect(result.type).toBe("forbidden");
		});
	});

	describe("session approvals", () => {
		it("remembers approved commands", () => {
			const engine = new ExecPolicyEngine([ExecPolicyEngine.builtinDefault()]);
			expect(check(engine, "npm install express").type).toBe("needsApproval");

			engine.rememberSessionApproval("npm");
			expect(check(engine, "npm install express").type).toBe("skip");
		});

		it("session approval is prefix-based", () => {
			const engine = new ExecPolicyEngine([ExecPolicyEngine.builtinDefault()]);
			engine.rememberSessionApproval("npm");
			expect(check(engine, "npm run build").type).toBe("skip");
			expect(check(engine, "npm test").type).toBe("skip");
		});
	});

	describe("addRuleset", () => {
		it("adds rules and re-sorts by layer order", () => {
			const engine = new ExecPolicyEngine([ExecPolicyEngine.builtinDefault()]);
			engine.addRuleset({
				layer: "agent",
				trustedPrefixes: ["python3 main.py"],
				deniedPrefixes: [],
			});
			expect(check(engine, "python3 main.py").type).toBe("skip");
		});
	});
});

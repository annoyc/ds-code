import { describe, expect, it } from "vitest";
import { BashArityDict } from "../src/exec-policy/bash-arity.js";

describe("BashArityDict", () => {
	const dict = new BashArityDict();

	describe("classify", () => {
		it("classifies simple commands", () => {
			expect(dict.classify(["ls"])).toBe("ls");
			expect(dict.classify(["make"])).toBe("make");
		});

		it("classifies two-token git commands", () => {
			expect(dict.classify(["git", "status"])).toBe("git status");
			expect(dict.classify(["git", "log", "--oneline"])).toBe("git log");
		});

		it("classifies three-token commands", () => {
			expect(dict.classify(["npm", "run", "build"])).toBe("npm run build");
			expect(dict.classify(["docker", "compose", "up"])).toBe("docker compose up");
		});

		it("strips flags from classification", () => {
			expect(dict.classify(["git", "--no-pager", "log"])).toBe("git log");
			expect(dict.classify(["npm", "run", "--silent", "test"])).toBe("npm run test");
		});

		it("returns empty for empty input", () => {
			expect(dict.classify([])).toBe("");
		});

		it("falls back to first token for unknown commands", () => {
			expect(dict.classify(["mycommand", "arg1"])).toBe("mycommand");
		});
	});

	describe("allowRuleMatches", () => {
		it("matches exact commands", () => {
			expect(dict.allowRuleMatches("git status", "git status")).toBe(true);
		});

		it("matches commands with additional args", () => {
			expect(dict.allowRuleMatches("git status", "git status --short")).toBe(true);
		});

		it("matches by canonical form", () => {
			expect(dict.allowRuleMatches("git log", "git --no-pager log --oneline")).toBe(true);
		});

		it("rejects non-matching commands", () => {
			expect(dict.allowRuleMatches("git status", "git push")).toBe(false);
		});

		it("handles case insensitivity", () => {
			expect(dict.allowRuleMatches("Git Status", "git status")).toBe(true);
		});

		it("handles prefix matching for simple patterns", () => {
			expect(dict.allowRuleMatches("ls", "ls -la /tmp")).toBe(true);
		});
	});
});

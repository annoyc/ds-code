import { BashArityDict } from "./bash-arity.js";
import type {
	ExecPolicyAmendment,
	ExecPolicyContext,
	ExecPolicyDecision,
	NetworkPolicyAmendment,
	Ruleset,
	RulesetLayer,
} from "./types.js";

const LAYER_ORDER: Record<RulesetLayer, number> = {
	builtinDefault: 0,
	agent: 1,
	user: 2,
};

function normalizeCommand(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean)
		.join(" ");
}

function firstToken(command: string): string {
	const tok = command.trim().split(/\s+/).filter(Boolean)[0];
	return (tok ?? "").toLowerCase();
}

export class ExecPolicyEngine {
	private rulesets: Ruleset[] = [];
	private arityDict: BashArityDict;
	private sessionApprovals: Set<string> = new Set();

	constructor(rulesets?: Ruleset[]) {
		this.arityDict = new BashArityDict();
		if (rulesets?.length) {
			this.rulesets = [...rulesets].sort((a, b) => LAYER_ORDER[a.layer] - LAYER_ORDER[b.layer]);
		}
	}

	addRuleset(ruleset: Ruleset): void {
		this.rulesets.push(ruleset);
		this.rulesets.sort((a, b) => LAYER_ORDER[a.layer] - LAYER_ORDER[b.layer]);
	}

	private mergedPrefixes(): { trusted: string[]; denied: string[] } {
		const trusted: string[] = [];
		const denied: string[] = [];
		for (const rs of this.rulesets) {
			trusted.push(...rs.trustedPrefixes);
			denied.push(...rs.deniedPrefixes);
		}
		return { trusted, denied };
	}

	check(context: ExecPolicyContext): ExecPolicyDecision {
		const normalized = normalizeCommand(context.command);
		const { trusted, denied } = this.mergedPrefixes();

		for (const rule of denied) {
			const rn = normalizeCommand(rule);
			if (rn.length === 0) {
				continue;
			}
			if (normalized.startsWith(rn)) {
				return {
					type: "forbidden",
					matchedRule: rule,
					reason: `Command blocked by denied prefix rule '${rule}'`,
				};
			}
		}

		const trustedRule = trusted.find((rule) =>
			this.arityDict.allowRuleMatches(rule, context.command),
		);
		const isTrusted = trustedRule !== undefined;
		const sessionOk = this.isSessionApproved(normalized);

		const proposal = (): {
			amendment: ExecPolicyAmendment;
			networkAmendment: NetworkPolicyAmendment;
		} => ({
			amendment: { trustedPrefix: firstToken(context.command) },
			networkAmendment: { host: context.cwd, action: "allow" },
		});

		const sandboxNote =
			context.sandboxMode === true ? " (sandbox mode)" : "";

		if (context.askForApproval === "never") {
			return {
				type: "skip",
				matchedRule: trustedRule,
				reason: `Execution allowed without interactive approval${sandboxNote}.`,
			};
		}

		if (context.askForApproval === "always") {
			const { amendment, networkAmendment } = proposal();
			return {
				type: "needsApproval",
				matchedRule: trustedRule,
				amendment,
				networkAmendment,
				reason: `Interactive approval required for every command${sandboxNote}.`,
			};
		}

		if (isTrusted || sessionOk) {
			return {
				type: "skip",
				matchedRule: trustedRule,
				reason: sessionOk
					? "Matched session-approved prefix."
					: "Matched trusted prefix rule.",
			};
		}

		const { amendment, networkAmendment } = proposal();
		return {
			type: "needsApproval",
			amendment,
			networkAmendment,
			reason: `Unmatched command prefix requires approval${sandboxNote}.`,
		};
	}

	rememberSessionApproval(prefix: string): void {
		this.sessionApprovals.add(normalizeCommand(prefix));
	}

	isSessionApproved(command: string): boolean {
		const n = normalizeCommand(command);
		for (const p of this.sessionApprovals) {
			if (p.length === 0) {
				continue;
			}
			if (n === p || n.startsWith(`${p} `)) {
				return true;
			}
		}
		return false;
	}

	static builtinDefault(): Ruleset {
		return {
			layer: "builtinDefault",
			trustedPrefixes: [
				"ls",
				"cat",
				"head",
				"tail",
				"wc",
				"echo",
				"pwd",
				"which",
				"whoami",
				"git status",
				"git log",
				"git diff",
				"git branch",
				"node --version",
				"npm --version",
				"python --version",
				"rg",
				"fd",
				"find",
			],
			deniedPrefixes: [
				"rm -rf /",
				"sudo rm",
				"mkfs",
				"dd if=",
				":(){ :|:& };:",
			],
		};
	}
}

export type RulesetLayer = "builtinDefault" | "agent" | "user";

export interface Ruleset {
	layer: RulesetLayer;
	trustedPrefixes: string[];
	deniedPrefixes: string[];
}

export type ExecDecisionType = "skip" | "needsApproval" | "forbidden";

export interface ExecPolicyAmendment {
	trustedPrefix: string;
}

export interface NetworkPolicyAmendment {
	host: string;
	action: "allow";
}

export interface ExecPolicyDecision {
	type: ExecDecisionType;
	matchedRule?: string;
	amendment?: ExecPolicyAmendment;
	networkAmendment?: NetworkPolicyAmendment;
	reason?: string;
}

export interface ExecPolicyContext {
	command: string;
	cwd: string;
	askForApproval: "always" | "auto" | "never";
	sandboxMode?: boolean;
}

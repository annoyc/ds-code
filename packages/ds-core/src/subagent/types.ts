export type SubAgentType = "general" | "explore" | "plan" | "review" | "implementer" | "verifier" | "custom";

export type SubAgentStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface SubAgentResult {
	summary: string;
	changes?: string;
	evidence?: string;
	risks?: string;
	blockers?: string;
	rawOutput: string;
}

export interface SubAgentSpawnOptions {
	type: SubAgentType;
	prompt: string;
	model?: string;
	tools?: string[];
	cwd?: string;
	timeout?: number;
	parentId?: string;
}

export interface SubAgentInfo {
	id: string;
	type: SubAgentType;
	status: SubAgentStatus;
	prompt: string;
	model: string;
	result?: SubAgentResult;
	startedAt: number;
	completedAt?: number;
	parentId?: string;
	error?: string;
}

export interface SubAgentManagerConfig {
	maxConcurrent: number;
	stepTimeout: number;
	defaultModel: string;
	persistPath?: string;
	sessionBootId: string;
}

export const MAX_SUBAGENTS_CEILING = 20;
export const DEFAULT_STEP_TIMEOUT = 120_000;
export const DEFAULT_MAX_CONCURRENT = 4;

export const SUBAGENT_TYPE_ALIASES: Record<string, SubAgentType> = {
	worker: "general",
	explorer: "explore",
	planner: "plan",
	reviewer: "review",
	impl: "implementer",
	verify: "verifier",
};

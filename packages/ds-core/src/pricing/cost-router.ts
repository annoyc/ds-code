export interface CostRouterConfig {
	autoModel: boolean;
	autoReasoning: boolean;
	defaultModel: string;
	flashModel: string;
	proModel: string;
}

export type ReasoningEffort = "off" | "low" | "medium" | "high" | "max";

export interface RouteContext {
	messageCount: number;
	lastToolCalls?: string[];
	estimatedInputTokens?: number;
	userMode?: "plan" | "agent" | "yolo";
}

const READ_ONLY_TOOL =
	/^(read_file|grep|glob_file_search|\bglob\b|list_dir|codebase_search|file_search|semantic_search|find_references|view_|documentation_|ls\b|pwd\b)/i;

const EDIT_TOOL =
	/^(write|edit|apply_patch|patch|search_replace|str_replace|delete_file|notebook_edit|mv\b|mkdir\b|rm\b)/i;

const COMPLEX_TOOL =
	/^(bash|shell|run_terminal_cmd|execute|npm\b|pnpm\b|yarn\b|bun\b|cargo\b|pytest|jest|vitest|debug|compile|build)/i;

function isReadOnlyTool(name: string): boolean {
	return READ_ONLY_TOOL.test(name.trim());
}

function isComplexTool(name: string): boolean {
	const n = name.trim();
	return EDIT_TOOL.test(n) || COMPLEX_TOOL.test(n);
}

export class CostRouter {
	constructor(private readonly config: CostRouterConfig) {}

	resolveModel(context: RouteContext): string {
		if (!this.config.autoModel) {
			return this.config.defaultModel;
		}
		const { messageCount, lastToolCalls, estimatedInputTokens } = context;

		if (estimatedInputTokens !== undefined && estimatedInputTokens >= 48_000) {
			return this.config.proModel;
		}
		if (messageCount >= 5) {
			return this.config.proModel;
		}
		if (lastToolCalls?.some(isComplexTool)) {
			return this.config.proModel;
		}
		if (!lastToolCalls?.length || lastToolCalls.every(isReadOnlyTool)) {
			return this.config.flashModel;
		}
		return this.config.proModel;
	}

	resolveReasoningEffort(context: RouteContext): ReasoningEffort {
		if (!this.config.autoReasoning) {
			return "medium";
		}
		if (context.userMode === "yolo") {
			return "max";
		}
		if (context.userMode === "plan") {
			return "high";
		}

		const { messageCount, lastToolCalls } = context;
		const tools = lastToolCalls ?? [];

		const readOnlySession =
			tools.length === 0 || tools.every((t) => isReadOnlyTool(t) && !isComplexTool(t));
		if (messageCount <= 2 && readOnlySession) {
			return "off";
		}

		const hasEdit = tools.some((t) => EDIT_TOOL.test(t.trim()));
		const hasComplex = tools.some(isComplexTool);
		if (hasComplex && (messageCount >= 6 || tools.filter(isComplexTool).length >= 2)) {
			return "high";
		}
		if (hasEdit && messageCount < 8 && !hasComplex) {
			return "low";
		}
		if (hasComplex) {
			return "medium";
		}
		return "medium";
	}
}

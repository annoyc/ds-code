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

export type QueryComplexity = "simple" | "complex";

/**
 * Result of heuristic model resolution, including whether the decision
 * could benefit from a Pro model classification call.
 */
export interface HeuristicRouteResult {
	model: string;
	/** True when heuristics picked flash but confidence is low enough to warrant a Pro classification check */
	needsClassification: boolean;
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

	/**
	 * Pure heuristic model resolution. Returns both the chosen model and
	 * whether a Pro classification call is advisable.
	 */
	resolveModelHeuristic(context: RouteContext): HeuristicRouteResult {
		if (!this.config.autoModel) {
			return { model: this.config.defaultModel, needsClassification: false };
		}
		const { messageCount, lastToolCalls, estimatedInputTokens } = context;

		if (estimatedInputTokens !== undefined && estimatedInputTokens >= 48_000) {
			return { model: this.config.proModel, needsClassification: false };
		}
		if (messageCount >= 5) {
			return { model: this.config.proModel, needsClassification: false };
		}
		if (lastToolCalls?.some(isComplexTool)) {
			return { model: this.config.proModel, needsClassification: false };
		}
		if (!lastToolCalls?.length || lastToolCalls.every(isReadOnlyTool)) {
			// Flash is the heuristic pick. For early turns (1-2 messages) without
			// tool context, we don't have much signal — a Pro classification call
			// can provide a smarter decision.
			const needsClassification = messageCount <= 2;
			return { model: this.config.flashModel, needsClassification };
		}
		return { model: this.config.proModel, needsClassification: false };
	}

	/**
	 * Resolve model using heuristics only (backward-compatible shorthand).
	 */
	resolveModel(context: RouteContext): string {
		return this.resolveModelHeuristic(context).model;
	}

	/**
	 * Resolve model using heuristic + optional Pro classification override.
	 * Pass the classification result when available; otherwise falls back to heuristic.
	 */
	resolveModelWithClassification(context: RouteContext, classification: QueryComplexity | undefined): string {
		const heuristic = this.resolveModelHeuristic(context);
		if (!classification) return heuristic.model;

		if (heuristic.needsClassification) {
			return classification === "simple" ? this.config.flashModel : this.config.proModel;
		}
		return heuristic.model;
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

		const readOnlySession = tools.length === 0 || tools.every((t) => isReadOnlyTool(t) && !isComplexTool(t));
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

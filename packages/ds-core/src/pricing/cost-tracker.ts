import { calculateTurnCost, type CostEstimate } from "./index.js";

export interface TrackedUsage {
	input: number;
	output: number;
	cacheRead?: number;
	cacheMiss?: number;
}

export class CostTracker {
	private pending: CostEstimate = { usd: 0, cny: 0 };

	report(modelId: string, usage: TrackedUsage): void {
		const cost = calculateTurnCost(modelId, {
			input: usage.input,
			output: usage.output,
			cacheRead: usage.cacheRead,
			cacheMiss: usage.cacheMiss,
		});
		if (!cost || !(cost.usd > 0 || cost.cny > 0)) {
			return;
		}
		this.pending.usd += cost.usd;
		this.pending.cny += cost.cny;
	}

	drain(): CostEstimate {
		const out = { ...this.pending };
		this.pending = { usd: 0, cny: 0 };
		return out;
	}

	reset(): void {
		this.pending = { usd: 0, cny: 0 };
	}

	getCurrent(): CostEstimate {
		return { ...this.pending };
	}
}

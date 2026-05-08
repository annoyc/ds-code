import { type CostEstimate, calculateTurnCost } from "./index.js";

export interface TrackedUsage {
	input: number;
	output: number;
	cacheRead?: number;
	cacheMiss?: number;
}

export interface TurnCostEntry {
	modelId: string;
	usage: TrackedUsage;
	cost: CostEstimate;
	timestamp: number;
}

export class CostTracker {
	private pending: CostEstimate = { usd: 0, cny: 0 };
	private turnHistory: TurnCostEntry[] = [];

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
		this.turnHistory.push({
			modelId,
			usage: { ...usage },
			cost: { ...cost },
			timestamp: Date.now(),
		});
	}

	drain(): CostEstimate {
		const out = { ...this.pending };
		this.pending = { usd: 0, cny: 0 };
		return out;
	}

	reset(): void {
		this.pending = { usd: 0, cny: 0 };
		this.turnHistory = [];
	}

	getCurrent(): CostEstimate {
		return { ...this.pending };
	}

	getTurnHistory(): readonly TurnCostEntry[] {
		return this.turnHistory;
	}

	getTurnCount(): number {
		return this.turnHistory.length;
	}
}

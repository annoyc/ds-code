export interface CacheAwareCompactionOptions {
	cacheHitThreshold: number;
}

const DEFAULT_OPTIONS: CacheAwareCompactionOptions = {
	cacheHitThreshold: 0.5,
};

interface CompactionEvent {
	tokensBefore: number;
	contextWindow?: number;
	cacheHitRatio?: number;
	messageCount?: number;
}

interface CompactionAdvice {
	shouldCompact: boolean;
	aggressiveness: "conservative" | "moderate" | "aggressive";
	targetTokenReduction: number;
	reason: string;
}

export function enhanceCompaction(userOptions?: Partial<CacheAwareCompactionOptions>) {
	const options = { ...DEFAULT_OPTIONS, ...userOptions };

	return async (event: unknown): Promise<CompactionAdvice | undefined> => {
		const e = event as CompactionEvent;
		if (!e || typeof e.tokensBefore !== "number") {
			return undefined;
		}

		const contextWindow = e.contextWindow ?? 128_000;
		const utilization = e.tokensBefore / contextWindow;
		const cacheHitRatio = e.cacheHitRatio ?? 0;

		if (utilization < 0.6) {
			return {
				shouldCompact: false,
				aggressiveness: "conservative",
				targetTokenReduction: 0,
				reason: `Context utilization (${(utilization * 100).toFixed(0)}%) below threshold`,
			};
		}

		if (cacheHitRatio >= options.cacheHitThreshold && utilization < 0.85) {
			return {
				shouldCompact: false,
				aggressiveness: "conservative",
				targetTokenReduction: 0,
				reason: `Cache hit ratio (${(cacheHitRatio * 100).toFixed(0)}%) is high, deferring compaction to preserve cache`,
			};
		}

		let aggressiveness: CompactionAdvice["aggressiveness"];
		let targetRatio: number;

		if (utilization >= 0.95) {
			aggressiveness = "aggressive";
			targetRatio = 0.4;
		} else if (utilization >= 0.85) {
			aggressiveness = "moderate";
			targetRatio = 0.55;
		} else {
			aggressiveness = "conservative";
			targetRatio = 0.65;
		}

		const targetTokens = Math.floor(contextWindow * targetRatio);
		const targetReduction = Math.max(0, e.tokensBefore - targetTokens);

		return {
			shouldCompact: true,
			aggressiveness,
			targetTokenReduction: targetReduction,
			reason:
				`Context at ${(utilization * 100).toFixed(0)}% utilization` +
				(cacheHitRatio > 0 ? `, cache hit ratio ${(cacheHitRatio * 100).toFixed(0)}%` : "") +
				`. Target: reduce by ~${Math.round(targetReduction / 1000)}k tokens`,
		};
	};
}

interface OverflowSession {
	tokenCount?: number;
	contextWindow?: number;
	messageCount?: number;
}

export function createOverflowRecovery() {
	return {
		async handleOverflow(session: unknown): Promise<boolean> {
			const s = session as OverflowSession;
			if (!s || typeof s.tokenCount !== "number") {
				return false;
			}

			const contextWindow = s.contextWindow ?? 128_000;
			const messageCount = s.messageCount ?? 0;

			if (s.tokenCount > contextWindow * 0.95 && messageCount > 2) {
				return true;
			}

			return false;
		},
	};
}

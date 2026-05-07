export interface CacheAwareCompactionOptions {
	cacheHitThreshold: number;
	maxSummaryTokens: number;
}

export function enhanceCompaction(_options?: Partial<CacheAwareCompactionOptions>) {
	return async (_event: unknown) => {
		return undefined;
	};
}

export function createOverflowRecovery() {
	return {
		async handleOverflow(_session: unknown): Promise<boolean> {
			void _session;
			return false;
		},
	};
}

export type CostCurrency = "usd" | "cny";

export interface CostEstimate {
	usd: number;
	cny: number;
}

export interface PricingTable {
	inputCacheHit: number;
	inputCacheMiss: number;
	output: number;
}

export interface ModelPricing {
	usd: PricingTable;
	cny: PricingTable;
}

const V4_PRO_DISCOUNT_ENDS_AT_MS = Date.UTC(2026, 4, 31, 15, 59, 0);

function v4ProDiscountPricing(): ModelPricing {
	return {
		usd: {
			inputCacheHit: 0.003625,
			inputCacheMiss: 0.435,
			output: 0.87,
		},
		cny: {
			inputCacheHit: 0.025,
			inputCacheMiss: 3.0,
			output: 6.0,
		},
	};
}

function v4ProBasePricing(): ModelPricing {
	return {
		usd: {
			inputCacheHit: 0.0145,
			inputCacheMiss: 1.74,
			output: 3.48,
		},
		cny: {
			inputCacheHit: 0.1,
			inputCacheMiss: 12.0,
			output: 24.0,
		},
	};
}

function v4FlashPricing(): ModelPricing {
	return {
		usd: {
			inputCacheHit: 0.0028,
			inputCacheMiss: 0.14,
			output: 0.28,
		},
		cny: {
			inputCacheHit: 0.02,
			inputCacheMiss: 1.0,
			output: 2.0,
		},
	};
}

export function getCurrencySymbol(currency: CostCurrency): string {
	return currency === "usd" ? "$" : "¥";
}

export function pricingForModel(modelId: string, at: Date = new Date()): ModelPricing | null {
	const lower = modelId.toLowerCase();
	if (lower.startsWith("deepseek-ai/")) {
		return null;
	}
	if (!lower.includes("deepseek")) {
		return null;
	}
	if (lower.includes("v4-pro") || lower.includes("v4pro")) {
		return at.getTime() <= V4_PRO_DISCOUNT_ENDS_AT_MS ? v4ProDiscountPricing() : v4ProBasePricing();
	}
	return v4FlashPricing();
}

function calculateTurnCostWithTable(table: PricingTable, usage: TurnUsageNums): number {
	const hitTokens = usage.hitTokens;
	const missTokens = usage.missTokens;
	const inputTokens = usage.inputTokens;
	const outputTokens = usage.outputTokens;

	const accountedInput = hitTokens + missTokens;
	const uncategorizedInput = saturatingSub(inputTokens, accountedInput);

	const hitCost = (hitTokens / 1_000_000) * table.inputCacheHit;
	const missCost = ((missTokens + uncategorizedInput) / 1_000_000) * table.inputCacheMiss;
	const outputCost = (outputTokens / 1_000_000) * table.output;
	return hitCost + missCost + outputCost;
}

interface TurnUsageNums {
	inputTokens: number;
	outputTokens: number;
	hitTokens: number;
	missTokens: number;
}

function saturatingSub(a: number, b: number): number {
	return Math.max(0, a - b);
}

function normalizeTurnUsage(usage: {
	input: number;
	output: number;
	cacheRead?: number;
	cacheMiss?: number;
}): TurnUsageNums {
	const inputTokens = Math.max(0, Math.trunc(usage.input));
	const outputTokens = Math.max(0, Math.trunc(usage.output));
	const hitTokens = Math.max(0, Math.trunc(usage.cacheRead ?? 0));
	let missTokens: number;
	if (usage.cacheMiss !== undefined) {
		missTokens = Math.max(0, Math.trunc(usage.cacheMiss));
	} else {
		missTokens = saturatingSub(inputTokens, hitTokens);
	}
	return { inputTokens, outputTokens, hitTokens, missTokens };
}

export function calculateTurnCost(
	modelId: string,
	usage: { input: number; output: number; cacheRead?: number; cacheMiss?: number },
	at?: Date,
): CostEstimate | null {
	const pricing = pricingForModel(modelId, at ?? new Date());
	if (!pricing) {
		return null;
	}
	const nums = normalizeTurnUsage(usage);
	return {
		usd: calculateTurnCostWithTable(pricing.usd, nums),
		cny: calculateTurnCostWithTable(pricing.cny, nums),
	};
}

export function formatCostAmount(amount: number, currency: CostCurrency): string {
	const symbol = getCurrencySymbol(currency);
	if (amount < 0.0001) {
		return `<${symbol}0.0001`;
	}
	if (amount < 0.01) {
		return `${symbol}${amount.toFixed(4)}`;
	}
	return `${symbol}${amount.toFixed(2)}`;
}

export function formatCostEstimate(estimate: CostEstimate, currency: CostCurrency): string {
	const amount = currency === "usd" ? estimate.usd : estimate.cny;
	return formatCostAmount(amount, currency);
}

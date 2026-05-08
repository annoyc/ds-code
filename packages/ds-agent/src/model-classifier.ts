import type { QueryComplexity } from "@deepseek/ds-core";

const CLASSIFICATION_SYSTEM_PROMPT = `You are a query complexity classifier for a coding assistant. Analyze the user query and classify it.

SIMPLE: basic factual questions, concept explanations, simple lookups, greeting, short answers, reading/understanding existing code
COMPLEX: code generation, debugging, multi-step reasoning, architecture design, refactoring, writing tests, complex analysis

Reply with exactly one word: SIMPLE or COMPLEX`;

const CLASSIFICATION_TIMEOUT_MS = 8_000;
const MAX_QUERY_LENGTH = 500;

const debug = !!process.env.DS_DEBUG;

interface ClassifyOptions {
	apiKey: string;
	baseUrl?: string;
	model?: string;
}

/**
 * Extract the classification keyword from any text that may include
 * reasoning preamble (e.g. "The user is asking... SIMPLE").
 */
function extractClassification(text: string | undefined): QueryComplexity | undefined {
	if (!text) return undefined;
	const upper = text.trim().toUpperCase();
	if (upper === "SIMPLE" || upper === "COMPLEX") return upper === "SIMPLE" ? "simple" : "complex";
	// Reasoning models may embed the answer inside longer text
	if (upper.includes("SIMPLE")) return "simple";
	if (upper.includes("COMPLEX")) return "complex";
	return undefined;
}

/**
 * Lightweight classification call.
 * Sends a minimal prompt to determine whether the user query is simple or complex.
 * Returns `undefined` on any error — the caller should fall back to heuristics.
 */
export async function classifyQuery(
	userMessage: string,
	options: ClassifyOptions,
): Promise<QueryComplexity | undefined> {
	const truncated =
		userMessage.length > MAX_QUERY_LENGTH ? `${userMessage.slice(0, MAX_QUERY_LENGTH)}...` : userMessage;

	const baseUrl = options.baseUrl ?? "https://api.deepseek.com";
	const model = options.model ?? "deepseek-v4-flash";

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), CLASSIFICATION_TIMEOUT_MS);

	try {
		if (debug) {
			console.error(`[ds-classifier] calling ${baseUrl}/chat/completions model=${model}`);
		}

		const response = await fetch(`${baseUrl}/chat/completions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${options.apiKey}`,
			},
			body: JSON.stringify({
				model,
				messages: [
					{ role: "system", content: CLASSIFICATION_SYSTEM_PROMPT },
					{ role: "user", content: truncated },
				],
				max_tokens: 64,
				temperature: 0,
			}),
			signal: controller.signal,
		});

		if (!response.ok) {
			if (debug) {
				console.error(`[ds-classifier] HTTP ${response.status}: ${response.statusText}`);
			}
			return undefined;
		}

		const data = (await response.json()) as {
			choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
		};
		const msg = data.choices?.[0]?.message;
		const content = msg?.content;
		const reasoning = msg?.reasoning_content;

		const result = extractClassification(content) ?? extractClassification(reasoning);

		if (debug) {
			console.error(
				`[ds-classifier] content="${content ?? ""}" reasoning="${reasoning ? reasoning.slice(0, 80) : ""}" result=${result ?? "UNKNOWN"}`,
			);
		}

		return result;
	} catch (err) {
		if (debug) {
			console.error("[ds-classifier] error:", err);
		}
		return undefined;
	} finally {
		clearTimeout(timeout);
	}
}

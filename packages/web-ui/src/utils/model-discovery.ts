import { LMStudioClient } from "@lmstudio/sdk";
import type { Model } from "@mariozechner/pi-ai";
import { Ollama } from "ollama/browser";
import type { AutoDiscoveryProviderType } from "../storage/stores/custom-providers-store.js";

/**
 * Discover models from an Ollama server (e.g. local DeepSeek weights).
 * @param baseUrl - Base URL of the Ollama server (e.g., "http://localhost:11434")
 * @param apiKey - Optional API key (currently unused by Ollama)
 * @returns Array of discovered models
 */
export async function discoverOllamaModels(baseUrl: string, _apiKey?: string): Promise<Model<any>[]> {
	try {
		// Create Ollama client
		const ollama = new Ollama({ host: baseUrl });

		// Get list of available models
		const { models } = await ollama.list();

		// Fetch details for each model and convert to Model format
		const ollamaModelPromises: Promise<Model<any> | null>[] = models.map(async (model: any) => {
			try {
				// Get model details
				const details = await ollama.show({
					model: model.name,
				});

				// Check capabilities - filter out models that don't support tools
				const capabilities: string[] = (details as any).capabilities || [];
				if (!capabilities.includes("tools")) {
					console.debug(`Skipping model ${model.name}: does not support tools`);
					return null;
				}

				// Extract model info
				const modelInfo: any = details.model_info || {};

				// Get context window size - look for architecture-specific keys
				const architecture = modelInfo["general.architecture"] || "";
				const contextKey = `${architecture}.context_length`;
				const contextWindow = parseInt(modelInfo[contextKey] || "8192", 10);

				// Ollama caps max tokens at 10x context length
				const maxTokens = contextWindow * 10;

				// Ollama only supports completions API
				const ollamaModel: Model<any> = {
					id: model.name,
					name: model.name,
					api: "openai-completions" as any,
					provider: "", // Will be set by caller
					baseUrl: `${baseUrl}/v1`,
					reasoning: capabilities.includes("thinking"),
					input: ["text"],
					cost: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
					},
					contextWindow: contextWindow,
					maxTokens: maxTokens,
				};

				return ollamaModel;
			} catch (err) {
				console.error(`Failed to fetch details for model ${model.name}:`, err);
				return null;
			}
		});

		const results = await Promise.all(ollamaModelPromises);
		return results.filter((m): m is Model<any> => m !== null);
	} catch (err) {
		console.error("Failed to discover Ollama models:", err);
		throw new Error(`Ollama discovery failed: ${err instanceof Error ? err.message : String(err)}`);
	}
}

/**
 * Discover models from an LM Studio server using the LM Studio SDK (OpenAI-compatible /v1).
 * @param baseUrl - Base URL of the LM Studio server (e.g., "http://localhost:1234")
 * @param apiKey - Optional API key (unused for LM Studio SDK)
 * @returns Array of discovered models
 */
export async function discoverLMStudioModels(baseUrl: string, _apiKey?: string): Promise<Model<any>[]> {
	try {
		// Extract host and port from baseUrl
		const url = new URL(baseUrl);
		const port = url.port ? parseInt(url.port, 10) : 1234;

		// Create LM Studio client
		const client = new LMStudioClient({ baseUrl: `ws://${url.hostname}:${port}` });

		// List all downloaded models
		const models = await client.system.listDownloadedModels();

		// Filter to only LLM models and map to our Model format
		return models
			.filter((model) => model.type === "llm")
			.map((model) => {
				const contextWindow = model.maxContextLength;
				// Use 10x context length like Ollama does
				const maxTokens = contextWindow;

				const lmStudioModel: Model<any> = {
					id: model.path,
					name: model.displayName || model.path,
					api: "openai-completions" as any,
					provider: "", // Will be set by caller
					baseUrl: `${baseUrl}/v1`,
					reasoning: model.trainedForToolUse || false,
					input: model.vision ? ["text", "image"] : ["text"],
					cost: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
					},
					contextWindow: contextWindow,
					maxTokens: maxTokens,
				};

				return lmStudioModel;
			});
	} catch (err) {
		console.error("Failed to discover LM Studio models:", err);
		throw new Error(`LM Studio discovery failed: ${err instanceof Error ? err.message : String(err)}`);
	}
}

/**
 * Discover models for local OpenAI-compatible runners used with DeepSeek-family models.
 */
export async function discoverModels(
	type: AutoDiscoveryProviderType,
	baseUrl: string,
	apiKey?: string,
): Promise<Model<any>[]> {
	switch (type) {
		case "ollama":
			return discoverOllamaModels(baseUrl, apiKey);
		case "lmstudio":
			return discoverLMStudioModels(baseUrl, apiKey);
	}
}

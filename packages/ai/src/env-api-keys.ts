import type { KnownProvider } from "./types.js";

function getApiKeyEnvVar(provider: string): string | undefined {
	if (provider === "deepseek") return "DEEPSEEK_API_KEY";
	return undefined;
}

export function findEnvKeys(provider: KnownProvider): string[] | undefined;
export function findEnvKeys(provider: string): string[] | undefined;
export function findEnvKeys(provider: string): string[] | undefined {
	const envVar = getApiKeyEnvVar(provider);
	if (!envVar) return undefined;
	return process.env[envVar] ? [envVar] : undefined;
}

export function getEnvApiKey(provider: KnownProvider): string | undefined;
export function getEnvApiKey(provider: string): string | undefined;
export function getEnvApiKey(provider: string): string | undefined {
	const envKeys = findEnvKeys(provider);
	if (envKeys?.[0]) {
		return process.env[envKeys[0]];
	}
	return undefined;
}

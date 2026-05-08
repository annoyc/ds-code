import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export const APP_NAME = "dsc";
export const APP_TITLE = "DeepSeek Agent";
export const CONFIG_DIR_NAME = ".ds";
export const PACKAGE_NAME = "@deepseek/ds-agent";

export type AgentMode = "plan" | "agent" | "yolo";

export interface DsConfig {
	model: string;
	reasoningEffort: string;
	mode: AgentMode;
	autoModel: boolean;
	autoReasoning: boolean;
	costCurrency: "usd" | "cny";
	lspEnabled: boolean;
	apiKey?: string;
	execPolicy: {
		trustedPrefixes: string[];
		deniedPrefixes: string[];
	};
}

export const DEFAULT_CONFIG: DsConfig = {
	model: "deepseek-v4-pro",
	reasoningEffort: "medium",
	mode: "agent",
	autoModel: true,
	autoReasoning: true,
	costCurrency: "cny",
	lspEnabled: false,
	execPolicy: {
		trustedPrefixes: [],
		deniedPrefixes: [],
	},
};

function isAgentMode(value: unknown): value is AgentMode {
	return value === "plan" || value === "agent" || value === "yolo";
}

function isCostCurrency(value: unknown): value is "usd" | "cny" {
	return value === "usd" || value === "cny";
}

export function getConfigDir(): string {
	return join(homedir(), CONFIG_DIR_NAME, "agent");
}

export function getConfigPath(): string {
	return join(getConfigDir(), "config.json");
}

export function getSessionsDir(): string {
	return join(getConfigDir(), "sessions");
}

export function loadConfig(): DsConfig {
	const config: DsConfig = {
		...DEFAULT_CONFIG,
		execPolicy: { ...DEFAULT_CONFIG.execPolicy },
	};

	const path = getConfigPath();
	try {
		if (existsSync(path)) {
			const raw = readFileSync(path, "utf8");
			const parsed = JSON.parse(raw) as Partial<DsConfig>;
			if (typeof parsed.model === "string") {
				config.model = parsed.model;
			}
			if (typeof parsed.reasoningEffort === "string") {
				config.reasoningEffort = parsed.reasoningEffort;
			}
			if (isAgentMode(parsed.mode)) {
				config.mode = parsed.mode;
			}
			if (typeof parsed.autoModel === "boolean") {
				config.autoModel = parsed.autoModel;
			}
			if (typeof parsed.autoReasoning === "boolean") {
				config.autoReasoning = parsed.autoReasoning;
			}
			if (isCostCurrency(parsed.costCurrency)) {
				config.costCurrency = parsed.costCurrency;
			}
			if (typeof parsed.lspEnabled === "boolean") {
				config.lspEnabled = parsed.lspEnabled;
			}
			if (typeof parsed.apiKey === "string") {
				config.apiKey = parsed.apiKey;
			}
			if (parsed.execPolicy && typeof parsed.execPolicy === "object") {
				const ep = parsed.execPolicy as Partial<DsConfig["execPolicy"]>;
				config.execPolicy = {
					trustedPrefixes: Array.isArray(ep.trustedPrefixes)
						? [...ep.trustedPrefixes]
						: [...DEFAULT_CONFIG.execPolicy.trustedPrefixes],
					deniedPrefixes: Array.isArray(ep.deniedPrefixes)
						? [...ep.deniedPrefixes]
						: [...DEFAULT_CONFIG.execPolicy.deniedPrefixes],
				};
			}
		}
	} catch {
		/* keep defaults */
	}

	if (process.env.DS_MODEL) {
		config.model = process.env.DS_MODEL;
	}
	if (process.env.DS_REASONING_EFFORT) {
		config.reasoningEffort = process.env.DS_REASONING_EFFORT;
	}
	if (process.env.DS_MODE && isAgentMode(process.env.DS_MODE)) {
		config.mode = process.env.DS_MODE;
	}

	return config;
}

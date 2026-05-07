export interface Diagnostic {
	file: string;
	line: number;
	column: number;
	endLine?: number;
	endColumn?: number;
	severity: "error" | "warning" | "info" | "hint";
	message: string;
	source?: string;
	code?: string | number;
}

export interface LspServerConfig {
	name: string;
	command: string;
	args: string[];
	filePatterns: string[];
	initializationOptions?: Record<string, unknown>;
}

export const DEFAULT_LSP_SERVERS: LspServerConfig[] = [
	{
		name: "typescript",
		command: "typescript-language-server",
		args: ["--stdio"],
		filePatterns: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"],
	},
	{
		name: "python",
		command: "pyright-langserver",
		args: ["--stdio"],
		filePatterns: ["**/*.py"],
	},
	{
		name: "rust",
		command: "rust-analyzer",
		args: [],
		filePatterns: ["**/*.rs"],
	},
];

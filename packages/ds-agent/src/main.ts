import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import {
	APP_NAME,
	loadConfig,
	type AgentMode,
	type DsConfig,
} from "./config.js";

interface CliArgs {
	prompt?: string;
	mode?: AgentMode;
	model?: string;
	reasoning?: string;
	apiKey?: string;
	json?: boolean;
	rpc?: boolean;
	version?: boolean;
	help?: boolean;
}

function isAgentMode(value: string | undefined): value is AgentMode {
	return value === "plan" || value === "agent" || value === "yolo";
}

function parseArgs(argv: string[]): CliArgs {
	const args: CliArgs = {};
	const positional: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]!;
		switch (a) {
			case "--help":
			case "-h":
				args.help = true;
				break;
			case "--version":
			case "-v":
				args.version = true;
				break;
			case "--json":
				args.json = true;
				break;
			case "--rpc":
				args.rpc = true;
				break;
			case "--mode": {
				const v = argv[++i];
				if (isAgentMode(v)) {
					args.mode = v;
				}
				break;
			}
		case "--model":
			args.model = argv[++i];
			break;
		case "--reasoning":
			args.reasoning = argv[++i];
			break;
		case "--api-key":
			args.apiKey = argv[++i];
			break;
		default:
				positional.push(a);
				break;
		}
	}
	if (positional[0] === "run") {
		args.prompt = positional.slice(1).join(" ").trim() || undefined;
	} else if (positional.length) {
		args.prompt = positional.join(" ").trim() || undefined;
	}
	return args;
}

function readPkgVersion(): string {
	try {
		const p = fileURLToPath(new URL("../package.json", import.meta.url));
		const j = JSON.parse(readFileSync(p, "utf8")) as { version?: string };
		return j.version ?? "0.1.0";
	} catch {
		return "0.1.0";
	}
}

export async function main(argv: string[]): Promise<void> {
	const args = parseArgs(argv);

	if (args.version) {
		console.log(`${APP_NAME} v${readPkgVersion()}`);
		return;
	}

	if (args.help) {
		printHelp();
		return;
	}

	const config = loadConfig();
	if (args.mode) {
		config.mode = args.mode;
	}
	if (args.model) {
		config.model = args.model;
	}
	if (args.reasoning) {
		config.reasoningEffort = args.reasoning;
	}

	process.env.DS_MODEL = config.model;
	process.env.DS_REASONING_EFFORT = config.reasoningEffort;
	process.env.DS_MODE = config.mode;
	process.env.DS_COST_CURRENCY = config.costCurrency;

	if (args.apiKey) {
		config.apiKey = args.apiKey;
	}

	ensureDeepSeekApiKey(config);

	const piArgv = buildPiArgv(argv, args, config);

	type PiMain = { main: (a: string[]) => void | Promise<void> };
	const piMod = await (import("@mariozechner/pi-coding-agent") as Promise<PiMain>).catch(() => null);
	const piMain = piMod?.main;

	if (process.env.DS_DEBUG) {
		console.error(`[ds] piArgv: ${JSON.stringify(piArgv)}`);
	}

	if (piMain) {
		await piMain(piArgv);
	} else {
		console.log(`${APP_NAME} - DeepSeek Terminal Agent`);
		console.log("Powered by DeepSeek V4 + pi-mono");
		console.log("");
		console.log("This is the initial scaffolding. Full integration is in progress.");
		if (args.prompt) {
			console.log("");
			console.log(`Prompt: ${args.prompt}`);
		}
		console.log("");
		console.log(`Config: ${JSON.stringify(config, null, 2)}`);
	}
}

/**
 * Ensures DEEPSEEK_API_KEY is available in the environment.
 * Sources (in priority order): env var → config file → warn and exit.
 */
function ensureDeepSeekApiKey(config: DsConfig): void {
	if (process.env.DEEPSEEK_API_KEY) {
		return;
	}

	if (config.apiKey) {
		process.env.DEEPSEEK_API_KEY = config.apiKey;
		return;
	}

	const isDeepSeekModel =
		config.model.startsWith("deepseek") || !config.model.includes("/");

	if (!isDeepSeekModel) {
		return;
	}

	console.error(
		`\x1b[33m⚠ DEEPSEEK_API_KEY 未设置。请通过以下方式之一配置：\x1b[0m\n` +
			`\n` +
			`  1. 设置环境变量：export DEEPSEEK_API_KEY=sk-...\n` +
			`  2. 写入配置文件：echo '{"apiKey":"sk-..."}' > ~/.ds/agent/config.json\n` +
			`  3. 通过命令行：ds --api-key sk-... "your prompt"\n` +
			`\n` +
			`  获取 API key: https://platform.deepseek.com/api_keys\n`,
	);
	process.exit(1);
}

const MODEL_IDENTITY: Record<string, { name: string; maker: string }> = {
	deepseek: { name: "DeepSeek", maker: "DeepSeek (深度求索)" },
	gpt: { name: "GPT", maker: "OpenAI" },
	"o1": { name: "o1", maker: "OpenAI" },
	"o3": { name: "o3", maker: "OpenAI" },
	"o4": { name: "o4", maker: "OpenAI" },
	claude: { name: "Claude", maker: "Anthropic" },
	gemini: { name: "Gemini", maker: "Google" },
	qwen: { name: "Qwen", maker: "Alibaba Cloud (阿里云)" },
	llama: { name: "Llama", maker: "Meta" },
	mistral: { name: "Mistral", maker: "Mistral AI" },
	kimi: { name: "Kimi", maker: "Moonshot AI (月之暗面)" },
	glm: { name: "GLM", maker: "Zhipu AI (智谱)" },
	mimo: { name: "MiMo", maker: "Xiaomi (小米)" },
};

function resolveModelIdentity(modelId: string): { name: string; maker: string } | undefined {
	const lower = modelId.toLowerCase();
	for (const [prefix, identity] of Object.entries(MODEL_IDENTITY)) {
		if (lower.includes(prefix)) {
			return identity;
		}
	}
	return undefined;
}

function buildIdentityPrompt(modelId: string): string | undefined {
	const identity = resolveModelIdentity(modelId);
	if (!identity) return undefined;
	return (
		`You are ${identity.name}, a large language model made by ${identity.maker}. ` +
		`Your model identifier is "${modelId}". ` +
		`When asked about your identity, always answer truthfully based on this information.\n` +
		`You are currently running inside "dsc" (dsCode), a coding agent built on top of pi.`
	);
}

function buildPiArgv(originalArgv: string[], args: CliArgs, config: DsConfig): string[] {
	const piArgs: string[] = [];

	const hasModel = originalArgv.some((a) => a === "--model" || a === "--provider");
	if (!hasModel) {
		const model = config.model;
		if (model.includes("/")) {
			piArgs.push("--model", model);
		} else {
			piArgs.push("--provider", "deepseek", "--model", model);
		}
	}

	const hasThinking = originalArgv.some((a) => a === "--thinking");
	if (!hasThinking && config.reasoningEffort) {
		const effortMap: Record<string, string> = {
			off: "off",
			low: "low",
			medium: "medium",
			high: "high",
			max: "xhigh",
		};
		const mapped = effortMap[config.reasoningEffort] ?? "medium";
		piArgs.push("--thinking", mapped);
	}

	const hasSystemPrompt = originalArgv.some((a) => a === "--append-system-prompt");
	if (!hasSystemPrompt) {
		const identityPrompt = buildIdentityPrompt(config.model);
		if (identityPrompt) {
			piArgs.push("--append-system-prompt", identityPrompt);
		}
	}

	if (args.json) {
		piArgs.push("--mode", "json");
	} else if (args.rpc) {
		piArgs.push("--mode", "rpc");
	}

	const skipFlags = new Set(["--json", "--rpc"]);
	const skipWithValue = new Set(["--mode", "--reasoning", "--api-key"]);
	for (let i = 0; i < originalArgv.length; i++) {
		const a = originalArgv[i]!;
		if (skipFlags.has(a)) continue;
		if (skipWithValue.has(a)) {
			i++;
			continue;
		}
		piArgs.push(a);
	}

	return piArgs;
}

function printHelp(): void {
	console.log(`
Usage: ${APP_NAME} [options] [prompt]

DeepSeek Terminal Agent - AI coding assistant powered by DeepSeek V4

Options:
  --mode <plan|agent|yolo>    Set execution mode (default: agent)
  --model <model>             Set model (default: deepseek-v4-pro)
  --reasoning <effort>        Set reasoning effort: off|low|medium|high|max
  --api-key <key>             DeepSeek API key (overrides env/config)
  --json                      Output in JSON format
  --rpc                       Start in RPC mode
  -v, --version               Show version
  -h, --help                  Show this help

Modes:
  plan    Read-only mode - only read, grep, find, ls tools
  agent   Default mode - write operations require approval
  yolo    Full auto mode - all operations auto-approved

Environment Variables:
  DEEPSEEK_API_KEY            DeepSeek API key
  DS_MODEL                    Default model
  DS_REASONING_EFFORT         Default reasoning effort
  DS_MODE                     Default mode

Examples:
  ${APP_NAME}                          Start interactive session
  ${APP_NAME} run "fix the bug in main.ts" Run single prompt
  ${APP_NAME} "fix the bug in main.ts" Run single prompt
  ${APP_NAME} --mode yolo "add tests"  Auto-approve all operations
`.trim());
}

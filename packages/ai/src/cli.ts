#!/usr/bin/env node

import { getModels, getProviders } from "./models.js";

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const command = args[0];

	if (!command || command === "help" || command === "--help" || command === "-h") {
		console.log(`Usage: npx @mariozechner/pi-ai <command>

Commands:
  list              List DeepSeek models from the built-in catalog
  help              Show this message

Authentication:
  Set DEEPSEEK_API_KEY in your environment.

Examples:
  export DEEPSEEK_API_KEY=...
  npx @mariozechner/pi-ai list
`);
		return;
	}

	if (command === "list") {
		const providers = getProviders();
		console.log(`Configured providers: ${providers.join(", ")}\n`);
		for (const provider of providers) {
			const models = getModels(provider);
			console.log(`${provider} (${models.length} models)`);
			for (const m of models) {
				console.log(`  ${m.id.padEnd(36)} ${m.name}`);
			}
			console.log();
		}
		return;
	}

	console.error(`Unknown command: ${command}`);
	console.error(`Use 'npx @mariozechner/pi-ai --help' for usage`);
	process.exit(1);
}

main().catch((err: unknown) => {
	console.error("Error:", err instanceof Error ? err.message : String(err));
	process.exit(1);
});

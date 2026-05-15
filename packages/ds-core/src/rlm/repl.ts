import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import readline from "node:readline";
import type { RlmBridge } from "./bridge.js";
import type { RpcRequest, RpcResponse } from "./types.js";

function rpcResponseLine(resp: RpcResponse): string {
	return `${JSON.stringify(resp)}\n`;
}

export class RlmRepl {
	private process: ChildProcess | null = null;
	private bridge: RlmBridge;

	constructor(bridge: RlmBridge) {
		this.bridge = bridge;
	}

	async start(): Promise<void> {
		const scriptPath = process.env.RLM_PYTHON_SCRIPT;
		if (!scriptPath) {
			this.process = null;
			return;
		}
		this.process = spawn("python3", ["-u", scriptPath], {
			stdio: ["pipe", "pipe", "pipe"],
		});
	}

	isRunning(): boolean {
		return this.process !== null && this.process.exitCode === null && !this.process.killed;
	}

	async stop(): Promise<void> {
		const proc = this.process;
		this.process = null;
		if (!proc?.pid) return;
		proc.kill("SIGTERM");
		await new Promise<void>((resolve) => {
			proc.once("exit", () => resolve());
			const t = setTimeout(() => {
				if (proc.exitCode === null && !proc.killed) proc.kill("SIGKILL");
				resolve();
			}, 2000);
			if (typeof (t as NodeJS.Timeout).unref === "function") (t as NodeJS.Timeout).unref();
		});
	}

	private async streamContentToFile(content: string): Promise<string> {
		const path = join(tmpdir(), `rlm-${randomBytes(8).toString("hex")}.txt`);
		await writeFile(path, content, "utf8");
		return path;
	}

	async runTurn(content: string, prompt: string): Promise<string> {
		const proc = this.process;
		if (!proc?.stdin || !proc.stdout) {
			throw new Error(
				"RLM Python runtime is not configured. Set the RLM_PYTHON_SCRIPT environment variable to the entry module path.",
			);
		}
		const stderrChunks: Buffer[] = [];
		proc.stderr?.on("data", (c: Buffer | string) => stderrChunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));

		const contentPath = await this.streamContentToFile(content);
		try {
			const handshake = JSON.stringify({
				type: "rlm_begin",
				contentPath,
				prompt,
			});
			proc.stdin.write(`${handshake}\n`);

			const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });
			try {
				for await (const line of rl) {
					const trimmed = line.trim();
					if (!trimmed) continue;
					let req: RpcRequest;
					try {
						req = JSON.parse(trimmed) as RpcRequest;
					} catch {
						proc.stdin.write(
							rpcResponseLine({
								type: "error",
								message: `invalid JSON-RPC line from Python: ${trimmed.slice(0, 200)}`,
							}),
						);
						continue;
					}
					if (req.method === "FINAL") {
						return req.params.result;
					}
					const resp = await this.bridge.dispatch(req);
					if (!proc.stdin.writableEnded) {
						proc.stdin.write(rpcResponseLine(resp));
					}
				}
			} finally {
				rl.close();
			}

			const stderr = Buffer.concat(stderrChunks).toString("utf8");
			throw new Error(
				stderr.trim().length > 0
					? `RLM Python exited without FINAL(): ${stderr.slice(0, 400)}`
					: "RLM Python exited without FINAL()",
			);
		} finally {
			await unlink(contentPath).catch(() => undefined);
		}
	}
}

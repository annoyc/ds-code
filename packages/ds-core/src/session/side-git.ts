import { execFile } from "child_process";
import { createInterface } from "node:readline/promises";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const MAX_SNAPSHOTS = 50;

export class SideGitSnapshots {
	private cwd: string;
	private snapshots = new Map<string, string>();
	private enabled = false;

	constructor(cwd: string) {
		this.cwd = cwd;
	}

	async initialize(): Promise<void> {
		try {
			const { stdout } = await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], {
				cwd: this.cwd,
			});
			this.enabled = stdout.trim() === "true";
		} catch {
			this.enabled = false;
		}
	}

	async createSnapshot(turnId: string): Promise<string | null> {
		if (!this.enabled) {
			return null;
		}
		try {
			const { stdout } = await execFileAsync("git", ["stash", "create"], { cwd: this.cwd });
			const sha = stdout.trim();
			if (!sha) {
				return null;
			}
			this.snapshots.set(turnId, sha);
			await this.cleanup();
			return sha;
		} catch {
			return null;
		}
	}

	async restoreSnapshot(turnId: string): Promise<boolean> {
		if (!this.enabled) {
			return false;
		}
		const sha = this.snapshots.get(turnId);
		if (!sha) {
			return false;
		}
		try {
			const { stdout } = await execFileAsync("git", ["status", "--porcelain"], {
				cwd: this.cwd,
			});
			const dirty = stdout.trim().length > 0;
			if (dirty) {
				const stdin = process.stdin;
				if (!stdin.isTTY) {
					return false;
				}
				const rl = createInterface({ input: stdin, output: process.stdout });
				try {
					const answer = await rl.question(
						"Working tree has uncommitted changes. Restore snapshot anyway? [y/N] ",
					);
					const ok = /^y(es)?$/i.test(answer.trim());
					if (!ok) {
						return false;
					}
				} finally {
					rl.close();
				}
			}
			try {
				await execFileAsync("git", ["stash", "apply", sha], { cwd: this.cwd });
				return true;
			} catch {
				try {
					await execFileAsync("git", ["checkout", sha, "--", "."], { cwd: this.cwd });
					return true;
				} catch {
					return false;
				}
			}
		} catch {
			return false;
		}
	}

	async listSnapshots(): Promise<string[]> {
		return [...this.snapshots.keys()];
	}

	async cleanup(): Promise<void> {
		while (this.snapshots.size > MAX_SNAPSHOTS) {
			const first = this.snapshots.keys().next().value;
			if (first === undefined) {
				break;
			}
			this.snapshots.delete(first);
		}
	}

	isEnabled(): boolean {
		return this.enabled;
	}
}

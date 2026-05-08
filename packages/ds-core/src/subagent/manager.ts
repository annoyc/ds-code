import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { getSubAgentSystemPrompt } from "./prompts.js";
import type {
	SubAgentInfo,
	SubAgentManagerConfig,
	SubAgentResult,
	SubAgentSpawnOptions,
	SubAgentStatus,
	SubAgentType,
} from "./types.js";
import { DEFAULT_MAX_CONCURRENT, DEFAULT_STEP_TIMEOUT, MAX_SUBAGENTS_CEILING, SUBAGENT_TYPE_ALIASES } from "./types.js";

const SUBAGENTS_FILE_SCHEMA_VERSION = 1;

export interface SubAgentExecuteContext {
	info: SubAgentInfo;
	systemPrompt: string;
	signal: AbortSignal;
	drainPendingMessages(): string[];
	stepTimeoutMs: number;
	cwd?: string;
	tools?: string[];
}

export type SubAgentExecuteFn = (ctx: SubAgentExecuteContext) => Promise<SubAgentResult>;

interface PersistedSubagentsV1 {
	schemaVersion: 1;
	sessionBootId: string;
	agents: SubAgentInfo[];
}

function resolveSubAgentType(raw: string): SubAgentType {
	const key = raw.trim().toLowerCase();
	const alias = SUBAGENT_TYPE_ALIASES[key];
	if (alias) {
		return alias;
	}
	const allowed: SubAgentType[] = ["general", "explore", "plan", "review", "implementer", "verifier", "custom"];
	if (!allowed.includes(key as SubAgentType)) {
		throw new Error(`Unknown sub-agent type: ${raw}`);
	}
	return key as SubAgentType;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export class SubAgentManager {
	private agents: Map<string, SubAgentInfo> = new Map();
	private runningCount = 0;
	private config: SubAgentManagerConfig;
	private residentLeases: Map<string, string> = new Map();
	private abortControllers: Map<string, AbortController> = new Map();
	private messageQueues: Map<string, string[]> = new Map();
	private pendingRuns: Map<string, Promise<void>> = new Map();

	constructor(
		config: SubAgentManagerConfig,
		private readonly executeAgent: SubAgentExecuteFn,
	) {
		const maxConcurrent = Math.min(
			Math.max(1, config.maxConcurrent || DEFAULT_MAX_CONCURRENT),
			MAX_SUBAGENTS_CEILING,
		);
		this.config = {
			...config,
			maxConcurrent,
			stepTimeout: config.stepTimeout > 0 ? config.stepTimeout : DEFAULT_STEP_TIMEOUT,
			defaultModel: config.defaultModel || "deepseek-v4-flash",
		};
	}

	async spawn(options: SubAgentSpawnOptions): Promise<string> {
		const effectiveMax = Math.min(this.config.maxConcurrent, MAX_SUBAGENTS_CEILING);
		if (this.runningCount >= effectiveMax) {
			throw new Error(`Sub-agent concurrency cap reached (${effectiveMax})`);
		}

		const id = randomUUID();
		const type = resolveSubAgentType(String(options.type));

		const model = options.model ?? this.config.defaultModel;
		const startedAt = Date.now();

		const row: SubAgentInfo = {
			id,
			type,
			status: "pending",
			prompt: options.prompt,
			model,
			startedAt,
			parentId: options.parentId,
		};

		this.runningCount += 1;
		try {
			this.agents.set(id, row);
			this.messageQueues.set(id, []);

			const controller = new AbortController();
			this.abortControllers.set(id, controller);

			const runPromise = this.runAgent(row, options, controller.signal).finally(() => {
				this.pendingRuns.delete(id);
				this.abortControllers.delete(id);
			});
			this.pendingRuns.set(id, runPromise);
			return id;
		} catch (e) {
			this.runningCount -= 1;
			throw e;
		}
	}

	private async runAgent(info: SubAgentInfo, options: SubAgentSpawnOptions, signal: AbortSignal): Promise<void> {
		const id = info.id;
		const row = this.agents.get(id);
		if (!row) {
			this.runningCount -= 1;
			return;
		}

		row.status = "running";
		this.agents.set(id, row);

		try {
			if (signal.aborted) {
				row.status = "cancelled";
				row.completedAt = Date.now();
				row.error = "Cancelled";
				this.agents.set(id, row);
				return;
			}

			const systemPrompt = getSubAgentSystemPrompt(row.type);
			const ctx: SubAgentExecuteContext = {
				info: { ...row },
				systemPrompt,
				signal,
				drainPendingMessages: () => {
					const q = this.messageQueues.get(id);
					if (!q || q.length === 0) {
						return [];
					}
					const out = q.splice(0, q.length);
					return out;
				},
				stepTimeoutMs: options.timeout ?? this.config.stepTimeout,
				cwd: options.cwd,
				tools: options.tools,
			};

			const result = await this.executeAgent(ctx);

			const done = this.agents.get(id);
			if (!done) {
				return;
			}
			if (signal.aborted) {
				done.status = "cancelled";
				done.completedAt = Date.now();
				done.error = "Cancelled";
				this.agents.set(id, done);
				return;
			}
			done.status = "completed";
			done.completedAt = Date.now();
			done.result = result;
			this.agents.set(id, done);
		} catch (e) {
			const failed = this.agents.get(id);
			if (!failed) {
				return;
			}
			if (signal.aborted) {
				failed.status = "cancelled";
				failed.completedAt = Date.now();
				failed.error = "Cancelled";
			} else {
				failed.status = "failed";
				failed.completedAt = Date.now();
				failed.error = e instanceof Error ? e.message : String(e);
			}
			this.agents.set(id, failed);
		} finally {
			this.runningCount -= 1;
			this.messageQueues.delete(id);
			this.releaseResidentLeasesFor(id);
			await this.save().catch(() => {});
		}
	}

	async wait(agentId: string, timeout?: number): Promise<SubAgentResult> {
		const deadline = timeout !== undefined ? Date.now() + timeout : undefined;
		while (true) {
			const agent = this.agents.get(agentId);
			if (!agent) {
				throw new Error(`Unknown sub-agent: ${agentId}`);
			}
			if (agent.status === "completed" && agent.result) {
				return agent.result;
			}
			if (agent.status === "failed") {
				throw new Error(agent.error ?? "Sub-agent failed");
			}
			if (agent.status === "cancelled") {
				throw new Error(agent.error ?? "Sub-agent cancelled");
			}
			if (deadline !== undefined && Date.now() > deadline) {
				throw new Error("wait timed out");
			}
			await delay(50);
		}
	}

	async waitAll(agentIds: string[], timeout?: number): Promise<Map<string, SubAgentResult>> {
		const out = new Map<string, SubAgentResult>();
		await Promise.all(
			agentIds.map(async (id) => {
				const r = await this.wait(id, timeout);
				out.set(id, r);
			}),
		);
		return out;
	}

	async cancel(agentId: string): Promise<void> {
		const agent = this.agents.get(agentId);
		if (!agent) {
			return;
		}
		const c = this.abortControllers.get(agentId);
		c?.abort();
		if (agent.status === "pending" || agent.status === "running") {
			agent.status = "cancelled";
			agent.completedAt = Date.now();
			agent.error = "Cancelled";
			this.agents.set(agentId, agent);
		}
		this.releaseResidentLeasesFor(agentId);
		await this.save().catch(() => {});
	}

	async sendMessage(agentId: string, message: string): Promise<void> {
		const agent = this.agents.get(agentId);
		if (!agent) {
			throw new Error(`Unknown sub-agent: ${agentId}`);
		}
		const q = this.messageQueues.get(agentId);
		if (!q) {
			throw new Error(`Sub-agent ${agentId} has no active mailbox`);
		}
		q.push(message);
	}

	list(): SubAgentInfo[] {
		return [...this.agents.values()].sort((a, b) => a.startedAt - b.startedAt);
	}

	getAgent(id: string): SubAgentInfo | undefined {
		const v = this.agents.get(id);
		return v ? { ...v } : undefined;
	}

	acquireResidentLease(filePath: string, agentId: string): boolean {
		const cur = this.residentLeases.get(filePath);
		if (cur !== undefined && cur !== agentId) {
			return false;
		}
		this.residentLeases.set(filePath, agentId);
		return true;
	}

	releaseResidentLease(filePath: string): void {
		this.residentLeases.delete(filePath);
	}

	getResidentAgent(filePath: string): string | undefined {
		return this.residentLeases.get(filePath);
	}

	private releaseResidentLeasesFor(agentId: string): void {
		for (const [path, owner] of this.residentLeases) {
			if (owner === agentId) {
				this.residentLeases.delete(path);
			}
		}
	}

	async save(): Promise<void> {
		const persistPath = this.config.persistPath;
		if (!persistPath) {
			return;
		}
		const payload: PersistedSubagentsV1 = {
			schemaVersion: SUBAGENTS_FILE_SCHEMA_VERSION,
			sessionBootId: this.config.sessionBootId,
			agents: this.list(),
		};
		await mkdir(dirname(persistPath), { recursive: true });
		await writeFile(persistPath, `${JSON.stringify(payload, null, "\t")}\n`, "utf8");
	}

	async load(): Promise<void> {
		const persistPath = this.config.persistPath;
		if (!persistPath) {
			return;
		}
		let raw: string;
		try {
			raw = await readFile(persistPath, "utf8");
		} catch (e) {
			const err = e as NodeJS.ErrnoException;
			if (err.code === "ENOENT") {
				return;
			}
			throw e;
		}
		const parsed = JSON.parse(raw) as PersistedSubagentsV1;
		if (parsed.schemaVersion !== 1 || typeof parsed.sessionBootId !== "string") {
			return;
		}
		if (parsed.sessionBootId !== this.config.sessionBootId) {
			return;
		}
		if (!Array.isArray(parsed.agents)) {
			return;
		}
		for (const a of parsed.agents as SubAgentInfo[]) {
			if (!a?.id || typeof a.id !== "string") {
				continue;
			}
			const normalized: SubAgentInfo = {
				...a,
				status: normalizeLoadedStatus(a.status),
			};
			this.agents.set(normalized.id, normalized);
			if (normalized.status === "running" || normalized.status === "pending") {
				normalized.status = "failed";
				normalized.completedAt = Date.now();
				normalized.error = normalized.error ?? "Detached after reload";
				this.agents.set(normalized.id, normalized);
			}
		}
		this.runningCount = [...this.agents.values()].filter(
			(a) => a.status === "pending" || a.status === "running",
		).length;
	}

	async shutdown(): Promise<void> {
		const ids = [...this.agents.keys()];
		await Promise.all(ids.map((id) => this.cancel(id)));
		this.agents.clear();
		this.residentLeases.clear();
		this.pendingRuns.clear();
		await this.save().catch(() => {});
	}
}

function normalizeLoadedStatus(s: SubAgentStatus | string | undefined): SubAgentStatus {
	if (s === "pending" || s === "running" || s === "completed" || s === "failed" || s === "cancelled") {
		return s;
	}
	return "failed";
}

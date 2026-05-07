import { spawn, type ChildProcess } from "child_process";
import { readFile } from "fs/promises";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import type { Diagnostic, LspServerConfig } from "./types.js";
import { DEFAULT_LSP_SERVERS } from "./types.js";

const DIAGNOSTIC_SEVERITY: Record<number, Diagnostic["severity"]> = {
	1: "error",
	2: "warning",
	3: "info",
	4: "hint",
};

function globToRegex(pattern: string): RegExp {
	const g = pattern.replace(/\\/g, "/");
	let s = "";
	let i = 0;
	while (i < g.length) {
		if (g[i] === "*" && g[i + 1] === "*") {
			if (g[i + 2] === "/") {
				s += "(?:.*/)?";
				i += 3;
			} else if (i + 2 >= g.length) {
				s += ".*";
				i += 2;
			} else {
				s += ".*";
				i += 2;
			}
			continue;
		}
		const c = g[i]!;
		if ("\\.^$+()[]{}|".includes(c)) {
			s += "\\" + c;
		} else if (c === "*") {
			s += "[^/]*";
		} else if (c === "?") {
			s += "[^/]";
		} else {
			s += c;
		}
		i++;
	}
	return new RegExp("^" + s + "$");
}

function fileMatchesPattern(absPath: string, cwd: string, pattern: string): boolean {
	const rel = path.relative(cwd, absPath).replace(/\\/g, "/");
	if (rel.startsWith("..")) {
		return false;
	}
	return globToRegex(pattern.replace(/\\/g, "/")).test(rel);
}

function uriToFsPath(uri: string): string {
	try {
		if (uri.startsWith("file:")) {
			return path.normalize(fileURLToPath(uri));
		}
	} catch {
		/* ignore */
	}
	return path.normalize(uri);
}

function toFileUri(absPath: string): string {
	return pathToFileURL(path.resolve(absPath)).href;
}

function languageIdForPath(absPath: string): string {
	const ext = path.extname(absPath).toLowerCase();
	switch (ext) {
		case ".ts":
			return "typescript";
		case ".tsx":
			return "typescriptreact";
		case ".js":
			return "javascript";
		case ".jsx":
			return "javascriptreact";
		case ".py":
			return "python";
		case ".rs":
			return "rust";
		default:
			return "plaintext";
	}
}

function lspDiagnosticToDiagnostic(
	fileAbs: string,
	raw: Record<string, unknown>,
): Diagnostic | null {
	const range = raw.range as Record<string, Record<string, number>> | undefined;
	const message = raw.message;
	if (!range?.start || typeof message !== "string") {
		return null;
	}
	const start = range.start;
	const end = range.end ?? start;
	const severityNum = typeof raw.severity === "number" ? raw.severity : undefined;
	const severity =
		severityNum !== undefined ? (DIAGNOSTIC_SEVERITY[severityNum] ?? "info") : "info";
	const diag: Diagnostic = {
		file: fileAbs,
		line: (start.line ?? 0) + 1,
		column: (start.character ?? 0) + 1,
		endLine: end.line !== undefined ? end.line + 1 : undefined,
		endColumn: end.character !== undefined ? end.character + 1 : undefined,
		severity,
		message,
		source: typeof raw.source === "string" ? raw.source : undefined,
		code: raw.code as string | number | undefined,
	};
	return diag;
}

function encodeMessage(payload: object): Buffer {
	const body = Buffer.from(JSON.stringify(payload), "utf8");
	const header = `Content-Length: ${body.length}\r\n\r\n`;
	return Buffer.concat([Buffer.from(header, "utf8"), body]);
}

class LspServerProcess {
	private process: ChildProcess | null = null;
	private requestId = 0;
	private pendingRequests = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
	private config: LspServerConfig;
	private cwd: string;
	private diagnosticCallback: (uri: string, diagnostics: Diagnostic[]) => void;
	private buffer = Buffer.alloc(0);
	private started = false;
	private readonly openedUris = new Set<string>();
	private readonly documentVersions = new Map<string, number>();

	constructor(
		config: LspServerConfig,
		cwd: string,
		onDiagnostics: (uri: string, diags: Diagnostic[]) => void,
	) {
		this.config = config;
		this.cwd = cwd;
		this.diagnosticCallback = onDiagnostics;
	}

	async start(): Promise<boolean> {
		return new Promise((resolve) => {
			let settled = false;
			try {
				const proc = spawn(this.config.command, this.config.args, {
					cwd: this.cwd,
					stdio: ["pipe", "pipe", "pipe"],
					env: process.env,
				});
				this.process = proc;
				proc.on("error", (err: NodeJS.ErrnoException) => {
					if (!settled && err.code === "ENOENT") {
						settled = true;
						this.process = null;
						resolve(false);
					}
				});
				proc.stderr?.on("data", () => {});
				proc.stdout?.on("data", (chunk: Buffer) => {
					this.appendChunk(chunk);
				});
				proc.on("exit", () => {
					this.process = null;
					for (const [, pending] of this.pendingRequests) {
						pending.reject(new Error("LSP process exited"));
					}
					this.pendingRequests.clear();
				});
				if (!proc.stdin || !proc.stdout) {
					settled = true;
					resolve(false);
					return;
				}
				void this.initialize()
					.then(() => {
						if (!settled) {
							settled = true;
							this.started = true;
							resolve(true);
						}
					})
					.catch(() => {
						if (!settled) {
							settled = true;
							try {
								proc.kill();
							} catch {
								/* ignore */
							}
							this.process = null;
							resolve(false);
						}
					});
			} catch {
				if (!settled) {
					settled = true;
					resolve(false);
				}
			}
		});
	}

	async stop(): Promise<void> {
		const proc = this.process;
		this.process = null;
		this.started = false;
		this.openedUris.clear();
		this.documentVersions.clear();
		if (proc && !proc.killed) {
			try {
				proc.stdin?.end();
			} catch {
				/* ignore */
			}
			try {
				proc.kill();
			} catch {
				/* ignore */
			}
		}
		await new Promise((r) => setTimeout(r, 50));
	}

	async initialize(): Promise<void> {
		const rootUri = pathToFileURL(path.resolve(this.cwd)).href;
		await this.sendRequest("initialize", {
			processId: process.pid,
			rootUri,
			capabilities: {
				textDocument: {
					publishDiagnostics: {},
					synchronization: {
						dynamicRegistration: false,
						willSave: false,
						willSaveWaitUntil: false,
						didSave: false,
					},
				},
				workspace: {
					workspaceFolders: false,
				},
			},
			clientInfo: { name: "ds-lsp-client", version: "0.1.0" },
			initializationOptions: this.config.initializationOptions ?? {},
		});
		this.sendNotification("initialized", {});
	}

	async didOpen(uri: string, text: string, languageId: string): Promise<void> {
		if (!this.started || !this.process?.stdin) {
			return;
		}
		this.documentVersions.set(uri, 1);
		this.openedUris.add(uri);
		this.sendNotification("textDocument/didOpen", {
			textDocument: {
				uri,
				languageId,
				version: 1,
				text,
			},
		});
	}

	async didChange(uri: string, text: string): Promise<void> {
		if (!this.started || !this.process?.stdin) {
			return;
		}
		const next = (this.documentVersions.get(uri) ?? 1) + 1;
		this.documentVersions.set(uri, next);
		this.sendNotification("textDocument/didChange", {
			textDocument: { uri, version: next },
			contentChanges: [{ text }],
		});
	}

	matchesFile(absPath: string): boolean {
		return this.config.filePatterns.some((p) => fileMatchesPattern(absPath, this.cwd, p));
	}

	isStarted(): boolean {
		return this.started;
	}

	async ensureOpen(absPath: string, text: string): Promise<void> {
		const uri = toFileUri(absPath);
		const lang = languageIdForPath(absPath);
		if (!this.openedUris.has(uri)) {
			await this.didOpen(uri, text, lang);
		} else {
			await this.didChange(uri, text);
		}
	}

	private appendChunk(chunk: Buffer): void {
		this.buffer = Buffer.concat([this.buffer, chunk]);
		for (;;) {
			const headerEnd = this.buffer.indexOf("\r\n\r\n");
			if (headerEnd === -1) {
				break;
			}
			const headerRaw = this.buffer.subarray(0, headerEnd).toString("utf8");
			const match = /^Content-Length:\s*(\d+)/im.exec(headerRaw);
			if (!match) {
				this.buffer = this.buffer.subarray(headerEnd + 4);
				continue;
			}
			const length = parseInt(match[1]!, 10);
			const bodyStart = headerEnd + 4;
			if (this.buffer.length < bodyStart + length) {
				break;
			}
			const bodyStr = this.buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
			this.buffer = this.buffer.subarray(bodyStart + length);
			try {
				const msg = JSON.parse(bodyStr) as Record<string, unknown>;
				this.handleMessage(msg);
			} catch {
				/* ignore malformed */
			}
		}
	}

	private handleMessage(message: Record<string, unknown>): void {
		if (typeof message.method === "string") {
			if (message.method === "textDocument/publishDiagnostics") {
				const params = message.params as Record<string, unknown> | undefined;
				const uri = typeof params?.uri === "string" ? params.uri : "";
				const rawDiags = Array.isArray(params?.diagnostics) ? params!.diagnostics : [];
				const fileAbs = path.resolve(uriToFsPath(uri));
				const canonicalUri = toFileUri(fileAbs);
				const out: Diagnostic[] = [];
				for (const d of rawDiags) {
					const conv = lspDiagnosticToDiagnostic(fileAbs, d as Record<string, unknown>);
					if (conv) {
						out.push({ ...conv, source: conv.source ?? this.config.name });
					}
				}
				this.diagnosticCallback(canonicalUri, out);
			}
			return;
		}
		const id = message.id;
		if (id !== undefined && id !== null) {
			const pending = this.pendingRequests.get(Number(id));
			if (pending) {
				this.pendingRequests.delete(Number(id));
				if (message.error) {
					const err = message.error as { message?: string };
					pending.reject(new Error(err.message ?? "LSP error"));
				} else {
					pending.resolve(message.result);
				}
			}
		}
	}

	private sendRequest(method: string, params: unknown): Promise<unknown> {
		const proc = this.process;
		if (!proc?.stdin) {
			return Promise.reject(new Error("LSP not running"));
		}
		const id = ++this.requestId;
		const payload = { jsonrpc: "2.0", id, method, params };
		return new Promise((resolve, reject) => {
			this.pendingRequests.set(id, { resolve, reject });
			try {
				proc.stdin!.write(encodeMessage(payload));
			} catch (e) {
				this.pendingRequests.delete(id);
				reject(e instanceof Error ? e : new Error(String(e)));
			}
		});
	}

	private sendNotification(method: string, params: unknown): void {
		const proc = this.process;
		if (!proc?.stdin) {
			return;
		}
		const payload = { jsonrpc: "2.0", method, params };
		try {
			proc.stdin.write(encodeMessage(payload));
		} catch {
			/* ignore */
		}
	}
}

export class LspClient {
	private servers: LspServerProcess[] = [];
	private diagnosticsByUri = new Map<string, Map<string, Diagnostic[]>>();
	private cwd: string;
	private configs: LspServerConfig[];
	private waiters = new Map<
		string,
		Array<{ resolve: (d: Diagnostic[]) => void; timer: NodeJS.Timeout }>
	>();

	constructor(cwd: string, configs?: LspServerConfig[]) {
		this.cwd = path.resolve(cwd);
		this.configs = configs ?? DEFAULT_LSP_SERVERS;
	}

	async start(): Promise<void> {
		const instances: LspServerProcess[] = [];
		for (const cfg of this.configs) {
			const proc = new LspServerProcess(cfg, this.cwd, (uri, diags) => {
				this.applyDiagnostics(uri, cfg.name, diags);
			});
			const ok = await proc.start();
			if (ok) {
				instances.push(proc);
			}
		}
		this.servers = instances;
	}

	async stop(): Promise<void> {
		await Promise.all(this.servers.map((s) => s.stop()));
		this.servers = [];
		this.diagnosticsByUri.clear();
	}

	getDiagnostics(filePath: string): Diagnostic[] {
		const uri = toFileUri(path.resolve(this.cwd, filePath));
		const byServer = this.diagnosticsByUri.get(uri);
		if (!byServer) {
			return [];
		}
		return [...byServer.values()].flat();
	}

	getAllDiagnostics(): Map<string, Diagnostic[]> {
		const out = new Map<string, Diagnostic[]>();
		for (const [uri, byServer] of this.diagnosticsByUri) {
			const merged = [...byServer.values()].flat();
			if (merged.length) {
				out.set(uri, merged);
			}
		}
		return out;
	}

	async waitForDiagnostics(
		filePath: string,
		options?: { timeout?: number },
	): Promise<Diagnostic[]> {
		const timeoutMs = options?.timeout ?? 5000;
		const abs = path.resolve(this.cwd, filePath);
		const uri = toFileUri(abs);
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				this.removeWaiter(uri, entry);
				resolve(this.getDiagnostics(filePath));
			}, timeoutMs);
			const entry = { resolve: (d: Diagnostic[]) => {
				clearTimeout(timer);
				this.removeWaiter(uri, entry);
				resolve(d);
			}, timer };
			let list = this.waiters.get(uri);
			if (!list) {
				list = [];
				this.waiters.set(uri, list);
			}
			list.push(entry);
		});
	}

	private removeWaiter(
		uri: string,
		entry: { resolve: (d: Diagnostic[]) => void; timer: NodeJS.Timeout },
	): void {
		const list = this.waiters.get(uri);
		if (!list) {
			return;
		}
		const idx = list.indexOf(entry);
		if (idx !== -1) {
			list.splice(idx, 1);
		}
		if (list.length === 0) {
			this.waiters.delete(uri);
		}
	}

	async notifyFileChanged(filePath: string, content?: string): Promise<void> {
		const abs = path.resolve(this.cwd, filePath);
		let text = content;
		if (text === undefined) {
			try {
				text = await readFile(abs, "utf8");
			} catch {
				return;
			}
		}
		for (const server of this.servers) {
			if (!server.matchesFile(abs)) {
				continue;
			}
			await server.ensureOpen(abs, text);
		}
	}

	formatDiagnostics(diagnostics: Diagnostic[]): string {
		if (diagnostics.length === 0) {
			return "";
		}
		const rel = path.relative(this.cwd, diagnostics[0]!.file).replace(/\\/g, "/") || ".";
		const lines = [`[LSP Diagnostics for ${rel}]`];
		for (const d of diagnostics) {
			const sev = d.severity.toUpperCase();
			const code =
				d.code !== undefined ? ` (${String(d.code).replace(/\s+/g, "")})` : "";
			lines.push(`${sev} line ${d.line}: ${d.message}${code}`);
		}
		return lines.join("\n");
	}

	private applyDiagnostics(uri: string, serverName: string, diags: Diagnostic[]): void {
		let byServer = this.diagnosticsByUri.get(uri);
		if (!byServer) {
			byServer = new Map();
			this.diagnosticsByUri.set(uri, byServer);
		}
		byServer.set(serverName, diags);
		this.flushWaiters(uri);
	}

	private flushWaiters(uri: string): void {
		const waitList = this.waiters.get(uri);
		if (!waitList?.length) {
			return;
		}
		const fsPath = uriToFsPath(uri);
		const diags = this.getDiagnostics(fsPath);
		const copy = [...waitList];
		this.waiters.delete(uri);
		for (const w of copy) {
			clearTimeout(w.timer);
			w.resolve(diags);
		}
	}
}

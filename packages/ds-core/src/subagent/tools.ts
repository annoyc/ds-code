import { Type } from "typebox";
import type { SubAgentManager } from "./manager.js";
import type { SubAgentResult, SubAgentType } from "./types.js";
import { SUBAGENT_TYPE_ALIASES } from "./types.js";

const CANONICAL_TYPES = new Set<string>([
	"general",
	"explore",
	"plan",
	"review",
	"implementer",
	"verifier",
	"custom",
]);

function coerceAgentType(raw: string): string {
	const key = raw.trim().toLowerCase();
	if (SUBAGENT_TYPE_ALIASES[key]) {
		return SUBAGENT_TYPE_ALIASES[key];
	}
	if (!CANONICAL_TYPES.has(key)) {
		throw new Error(`Unknown sub-agent type: ${raw}`);
	}
	return key;
}

export function createSubAgentTools(manager: SubAgentManager) {
	return [
		{
			name: "agent_spawn",
			description: "Spawn a new sub-agent to work on a task independently",
			parameters: Type.Object({
				type: Type.String({
					description: "Agent type: general|explore|plan|review|implementer|verifier|custom",
				}),
				prompt: Type.String({ description: "Task description for the sub-agent" }),
				model: Type.Optional(Type.String({ description: "Override model for this agent" })),
			}),
			execute: async (
				_id: string,
				params: { type: string; prompt: string; model?: string },
				signal: AbortSignal,
			) => {
				if (signal.aborted) {
					throw new Error("Aborted");
				}
				const type = coerceAgentType(params.type);
				const agentId = await manager.spawn({
					type: type as SubAgentType,
					prompt: params.prompt,
					model: params.model,
				});
				return JSON.stringify({ agent_id: agentId });
			},
		},
		{
			name: "agent_wait",
			description: "Wait for a sub-agent to complete and get its result",
			parameters: Type.Object({
				agent_id: Type.String({ description: "ID of the agent to wait for" }),
				timeout: Type.Optional(Type.Number({ description: "Timeout in seconds" })),
			}),
			execute: async (
				_id: string,
				params: { agent_id: string; timeout?: number },
				signal: AbortSignal,
			) => {
				if (signal.aborted) {
					throw new Error("Aborted");
				}
				const ms = params.timeout !== undefined ? params.timeout * 1000 : undefined;
				let result: SubAgentResult;
				try {
					result = await manager.wait(params.agent_id, ms);
				} catch (e) {
					const msg = e instanceof Error ? e.message : String(e);
					return JSON.stringify({ ok: false, error: msg });
				}
				return JSON.stringify({ ok: true, result });
			},
		},
		{
			name: "agent_message",
			description: "Send a message to a running sub-agent",
			parameters: Type.Object({
				agent_id: Type.String({ description: "ID of the agent" }),
				message: Type.String({ description: "Message to send" }),
			}),
			execute: async (
				_id: string,
				params: { agent_id: string; message: string },
				signal: AbortSignal,
			) => {
				if (signal.aborted) {
					throw new Error("Aborted");
				}
				await manager.sendMessage(params.agent_id, params.message);
				return JSON.stringify({ ok: true });
			},
		},
		{
			name: "agent_cancel",
			description: "Cancel a running sub-agent",
			parameters: Type.Object({
				agent_id: Type.String({ description: "ID of the agent to cancel" }),
			}),
			execute: async (_id: string, params: { agent_id: string }, signal: AbortSignal) => {
				if (signal.aborted) {
					throw new Error("Aborted");
				}
				await manager.cancel(params.agent_id);
				return JSON.stringify({ ok: true });
			},
		},
		{
			name: "agent_list",
			description: "List all sub-agents and their current status",
			parameters: Type.Object({}),
			execute: async (_id: string, _params: Record<string, never>, signal: AbortSignal) => {
				if (signal.aborted) {
					throw new Error("Aborted");
				}
				return JSON.stringify({ agents: manager.list() });
			},
		},
	];
}

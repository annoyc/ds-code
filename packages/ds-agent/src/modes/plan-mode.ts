export const PLAN_MODE_TOOLS = ["read", "grep", "find", "ls"] as const;

export function isPlanModeAllowed(toolName: string): boolean {
	return (PLAN_MODE_TOOLS as readonly string[]).includes(toolName);
}

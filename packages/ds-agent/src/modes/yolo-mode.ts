export function isYoloMode(): boolean {
	return process.env.DS_MODE === "yolo";
}

export function createYoloApprovalHandler() {
	return async (_event: unknown) => {
		return undefined;
	};
}

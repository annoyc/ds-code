export interface RlmConfig {
	childModel: string;
	maxDepth: number;
	maxBatch: number;
	timeoutMs: number;
	temperature: number;
	topP: number;
	maxTokens: number;
}

export interface CreateMessageFn {
	(request: CreateMessageRequest): Promise<CreateMessageResponse>;
}

export interface CreateMessageRequest {
	model: string;
	system?: string;
	messages: Array<{ role: "user" | "assistant"; content: string }>;
	maxTokens: number;
	temperature: number;
	topP: number;
	stream: false;
}

export interface CreateMessageResponse {
	content: string;
	usage: { input: number; output: number };
}

export interface RlmUsage {
	inputTokens: number;
	outputTokens: number;
}

export type RpcRequest =
	| { method: "llm_query"; params: { prompt: string; system?: string } }
	| { method: "llm_query_batched"; params: { prompts: string[]; system?: string } }
	| { method: "rlm_query"; params: { prompt: string; system?: string } }
	| { method: "FINAL"; params: { result: string } };

export type RpcResponse =
	| { type: "single"; result: string }
	| { type: "batch"; results: string[] }
	| { type: "final"; result: string }
	| { type: "error"; message: string };

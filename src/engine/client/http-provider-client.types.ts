import type {ChatServiceRequest, ToolCall} from '@/chat/chat.types';
import type {Result} from "neverthrow";

export interface TenantContext {
    tenantId: string;
    tenantName: string;
}

export interface ProviderBaseResponse {
    model: string;
    aiProviderId: string;
    aiProvider: string;
    aiProviderUrl: string;
}

export interface ProviderChatResponse extends ProviderBaseResponse {
    content: string;
    toolCalls?: ToolCall[];
    rawBody?: Record<string, unknown>;
}

export interface ProviderStreamResponse extends ProviderBaseResponse {
    body: ReadableStream<Uint8Array>;
}

export type ModelConfig = {
    url: string;
    model: string;
    apiKey?: string;
    priority?: number;
    aiProviderId?: string;
    aiProviderName?: string;
    aiProviderBaseUrl?: string;
    aiProviderModelId?: string;
};

export type ProviderChatOptions = Omit<ChatServiceRequest, 'model' | 'models' | 'system' | 'stream' | 'messages'>;

export type OpenAIChatCompletion = {
    choices?: Array<{ message?: { content?: string; tool_calls?: ToolCall[] } }>;
};

export type CallProviderError = { kind: 'soft' | 'hard'; error: unknown };
export type CallProviderSuccess = {
    content: string;
    toolCalls?: ToolCall[];
    ttftMs: number;
    latencyMs: number;
    rawBody?: Record<string, unknown>;
};
export type CallProviderResult = Result<CallProviderSuccess, CallProviderError>;
export type CallProviderStreamSuccess = { body: ReadableStream<Uint8Array>; ttftMs: number };
export type CallProviderStreamResult = Result<CallProviderStreamSuccess, CallProviderError>;

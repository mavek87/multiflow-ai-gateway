import type {ToolCall} from '@/chat/chat.types';
import type {Result} from 'neverthrow';

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

export type OpenAIChatCompletion = {
    choices?: Array<{ message?: { content?: string; tool_calls?: ToolCall[] } }>;
};

export type CallProviderError =
    | { kind: 'timeout' }
    | { kind: 'http'; status: number }
    | { kind: 'parse'; error: unknown }
    | { kind: 'network'; error: unknown };
export type CallProviderSuccess = {
    content: string;
    toolCalls?: ToolCall[];
    ttftMs: number;
    latencyMs: number;
    body?: Record<string, unknown>;
};
export type CallProviderResult = Result<CallProviderSuccess, CallProviderError>;
export type CallProviderStreamSuccess = { body: ReadableStream<Uint8Array>; ttftMs: number; latencyMs?: number };
export type CallProviderStreamResult = Result<CallProviderStreamSuccess, CallProviderError>;

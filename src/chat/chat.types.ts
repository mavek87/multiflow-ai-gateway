import type {Static} from 'elysia';
import type {MessageSchema, ToolCallSchema} from '@/chat/chat.schema';

export type ToolCall = Static<typeof ToolCallSchema>;
export type AIChatMessage = Static<typeof MessageSchema>;

export type ChatServiceError = | { code: 'ai_unavailable' } | { code: 'stream_not_supported' };

export interface ChatServiceRequest {
    model?: string;
    models?: string[];
    messages: AIChatMessage[];
    system?: string;
    stream?: boolean;
    tools?: unknown[];
    tool_choice?: unknown;
    parallel_tool_calls?: boolean;
    temperature?: number;
    top_p?: number;
    max_tokens?: number;
    max_completion_tokens?: number;
    presence_penalty?: number;
    frequency_penalty?: number;
    seed?: number;
    stop?: string | string[];
    response_format?: unknown;
    stream_options?: unknown;
    user?: string;
    n?: number;
}

export type ChatHandlerResult =
    | { isStream: true; payload: ReadableStream<Uint8Array>; model: string; aiProvider: string; aiProviderUrl: string }
    | { isStream: false; payload: Record<string, unknown>; model: string; aiProvider: string; aiProviderUrl: string };

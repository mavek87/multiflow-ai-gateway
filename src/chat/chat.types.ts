import type {Static} from 'elysia';
import type {ToolCallSchema, MessageSchema} from '@/chat/chat.schema';

export type ToolCall = Static<typeof ToolCallSchema>;
export type AIChatMessage = Static<typeof MessageSchema>;

export type ChatServiceError =
    | {code: 'ai_unavailable'}
    | {code: 'stream_not_supported'};

export interface ChatServiceRequest {
    model?: string;
    messages: AIChatMessage[];
    system?: string;
    stream?: boolean;
}

export type ChatHandlerResult =
    | {isStream: true; payload: ReadableStream<Uint8Array>; model: string; aiProvider: string; aiProviderUrl: string}
    | {isStream: false; payload: ChatCompletion; model: string; aiProvider: string; aiProviderUrl: string};

export interface ChatCompletion {
    id: string;
    object: 'chat.completion';
    created: number;
    model: string;
    choices: Array<{
        index: number;
        message: {role: 'assistant'; content: string};
        finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
    }>;
}

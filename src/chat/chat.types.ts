import type {Static} from 'elysia';
import type {ChatRequestSchema, MessageSchema, ToolCallSchema} from '@/chat/chat.schema';

export type ToolCall = Static<typeof ToolCallSchema>;
export type ChatMessage = Static<typeof MessageSchema>;
export type ChatRequest = Static<typeof ChatRequestSchema>;
export type ChatError = | { code: 'ai_unavailable' } | { code: 'stream_not_supported' };
export type ChatHandlerResult =
    | { isStream: true; payload: ReadableStream<Uint8Array>; model: string; aiProvider: string; aiProviderUrl: string }
    | { isStream: false; payload: Record<string, unknown>; model: string; aiProvider: string; aiProviderUrl: string };

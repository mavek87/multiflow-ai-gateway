import {type Static, t} from 'elysia';

export const ToolCallSchema = t.Object({
    id: t.String(),
    type: t.Literal('function'),
    function: t.Object({
        name: t.String(),
        arguments: t.Record(t.String(), t.Unknown()),
    }),
});

export const MessageSchema = t.Object({
    role: t.Union([t.Literal('system'), t.Literal('user'), t.Literal('assistant'), t.Literal('tool')]),
    content: t.String(),
    tool_calls: t.Optional(t.Array(ToolCallSchema)),
    tool_call_id: t.Optional(t.String()),
});

export const ChatRequestSchema = t.Object({
    model: t.Optional(t.String()),
    messages: t.Array(MessageSchema, {minItems: 1, error: 'messages array is required and must not be empty'}),
    system: t.Optional(t.String()),
    stream: t.Optional(t.Boolean()),
});

export type ToolCall = Static<typeof ToolCallSchema>;
export type AIChatMessage = Static<typeof MessageSchema>;

export type ChatHandlerResult =
    | {isStream: true; payload: ReadableStream<Uint8Array>; model: string; aiProvider: string}
    | {isStream: false; payload: ChatCompletion; model: string; aiProvider: string};

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
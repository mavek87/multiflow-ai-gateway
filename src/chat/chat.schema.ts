import {t} from 'elysia';

export const ToolCallSchema = t.Object({
    id: t.String(),
    type: t.Literal('function'),
    function: t.Object({
        name: t.String(),
        arguments: t.Record(t.String(), t.Unknown()),
    }),
});

export const MessageSchema = t.Object({
    role: t.Union([t.Literal('system'), t.Literal('user'), t.Literal('assistant'), t.Literal('tool')], {
        error: "Expected role to be one of: 'system', 'user', 'assistant', 'tool'",
    }),
    content: t.String(),
    tool_calls: t.Optional(t.Array(ToolCallSchema)),
    tool_call_id: t.Optional(t.String()),
});

export const ChatRequestSchema = t.Object({
    model: t.Optional(t.String()),
    models: t.Optional(t.Array(t.String(), {minItems: 1})),
    messages: t.Array(MessageSchema, {minItems: 1, error: 'messages array is required and must not be empty'}),
    system: t.Optional(t.String()),
    stream: t.Optional(t.Boolean()),
});

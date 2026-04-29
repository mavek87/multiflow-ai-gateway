import {t} from 'elysia';

export const ToolCallSchema = t.Object({
    id: t.String(),
    type: t.Literal('function'),
    function: t.Object({
        name: t.String(),
        arguments: t.String(), // JSON-encoded string per OpenAI spec
    }),
});

const ContentPartSchema = t.Union([
    t.Object({type: t.Literal('text'), text: t.String()}),
    t.Object({type: t.Literal('image_url'), image_url: t.Object({url: t.String(), detail: t.Optional(t.String())})}),
    t.Object({type: t.Literal('tool_result'), tool_use_id: t.Optional(t.String()), content: t.Optional(t.Unknown())}),
    t.Object({type: t.String()}), // fallback for other part types
]);

export const MessageSchema = t.Object({
    role: t.Union([t.Literal('system'), t.Literal('user'), t.Literal('assistant'), t.Literal('tool')], {
        error: "Expected role to be one of: 'system', 'user', 'assistant', 'tool'",
    }),
    content: t.Optional(t.Union([t.String(), t.Null(), t.Array(t.Any())])),
    name: t.Optional(t.String()),
    tool_calls: t.Optional(t.Array(ToolCallSchema)),
    tool_call_id: t.Optional(t.String()),
});

const ToolSchema = t.Object({
    type: t.Literal('function'),
    function: t.Object({
        name: t.String(),
        description: t.Optional(t.String()),
        parameters: t.Optional(t.Unknown()),
        strict: t.Optional(t.Boolean()),
    }),
});

const ToolChoiceSchema = t.Union([
    t.Literal('auto'),
    t.Literal('none'),
    t.Literal('required'),
    t.Object({type: t.Literal('function'), function: t.Object({name: t.String()})}),
]);

export const ChatRequestSchema = t.Object({
    model: t.Optional(t.String()),
    models: t.Optional(t.Array(t.String(), {minItems: 1})),
    messages: t.Array(MessageSchema, {minItems: 1, error: 'messages array is required and must not be empty'}),
    system: t.Optional(t.String()),
    stream: t.Optional(t.Boolean()),
    tools: t.Optional(t.Array(ToolSchema)),
    tool_choice: t.Optional(ToolChoiceSchema),
    parallel_tool_calls: t.Optional(t.Boolean()),
    temperature: t.Optional(t.Number()),
    top_p: t.Optional(t.Number()),
    max_tokens: t.Optional(t.Integer()),
    max_completion_tokens: t.Optional(t.Integer()),
    presence_penalty: t.Optional(t.Number()),
    frequency_penalty: t.Optional(t.Number()),
    seed: t.Optional(t.Integer()),
    stop: t.Optional(t.Union([t.String(), t.Array(t.String())])),
    response_format: t.Optional(t.Unknown()),
    stream_options: t.Optional(t.Unknown()),
    user: t.Optional(t.String()),
    n: t.Optional(t.Integer()),
});

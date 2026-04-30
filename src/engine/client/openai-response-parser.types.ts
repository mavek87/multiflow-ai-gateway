import type { ToolCall } from '@/engine/client/http-provider-client.types';

export type OpenAIChatCompletion = {
  choices?: Array<{ message?: { content?: string; tool_calls?: ToolCall[] } }>;
};

export type OpenAIResponse = {
  content: string;
  ttftMs: number;
  toolCalls?: ToolCall[];
  rawBody: Record<string, unknown>;
};

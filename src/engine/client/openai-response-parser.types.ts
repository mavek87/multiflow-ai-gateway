import type { ToolCall } from '@/engine/client/http-provider-client.types';

export type OpenAIChatCompletion = {
  choices?: Array<{ message?: { content?: string; tool_calls?: ToolCall[] } }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

export type JsonResponseResult = {
  content: string;
  toolCalls: ToolCall[] | undefined;
  usage?: UsageMetrics;
  rawBody: Record<string, unknown>;
};

export type UsageMetrics = { promptTokens: number; completionTokens: number; totalTokens: number };

export type OpenAIResponse = {
  content: string;
  ttftMs: number;
  toolCalls?: ToolCall[];
  usage?: UsageMetrics;
  rawBody?: Record<string, unknown>;
};

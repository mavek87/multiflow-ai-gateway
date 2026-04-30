import type { ToolCall } from '@/engine/client/http-provider-client.types';

export type OpenAIResponse = {
  content: string;
  ttftMs: number;
  toolCalls?: ToolCall[];
  rawBody: Record<string, unknown>;
};

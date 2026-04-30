import { createLogger } from '@/utils/logger';
import type { ToolCall } from '@/engine/client/http-provider-client.types';

const log = createLogger('MODEL-CLIENT');

type OpenAIChatCompletion = {
  choices?: Array<{ message?: { content?: string; tool_calls?: ToolCall[] } }>;
};

export type OpenAIResponse = {
  content: string;
  ttftMs: number;
  toolCalls?: ToolCall[];
  rawBody: Record<string, unknown>;
};

export async function parseJsonResponse(res: Response, start: number): Promise<OpenAIResponse> {
  const json = await res.json() as OpenAIChatCompletion;
  log.debug({ preview: JSON.stringify(json).slice(0, 200) }, 'non-stream response');
  const message = json.choices?.[0]?.message;
  const toolCalls = message?.tool_calls;
  if (toolCalls) log.debug({ toolCalls }, 'tool_calls received');
  return {
    content: message?.content ?? '',
    toolCalls,
    ttftMs: Date.now() - start,
    rawBody: json as Record<string, unknown>,
  };
}

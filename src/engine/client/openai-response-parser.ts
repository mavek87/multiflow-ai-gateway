import { createLogger } from '@/utils/logger';
import type { OpenAIChatCompletion, OpenAIResponse, JsonResponseResult, UsageMetrics } from './openai-response-parser.types';

export type { UsageMetrics, OpenAIResponse } from './openai-response-parser.types';

const log = createLogger('MODEL-CLIENT');

export async function parseJsonResponse(res: Response, start: number): Promise<OpenAIResponse> {
  const json = await res.json() as OpenAIChatCompletion;
  const { content, toolCalls, usage, rawBody } = parseJsonBody(json);
  log.debug({ preview: JSON.stringify(json).slice(0, 200) }, 'non-stream response');
  if (toolCalls) log.debug({ toolCalls }, 'tool_calls received');
  if (usage) log.debug({ usage }, 'usage metrics received');
  return { content, ttftMs: Date.now() - start, toolCalls, usage, rawBody };
}

export function parseJsonBody(json: OpenAIChatCompletion): JsonResponseResult {
  const message = json.choices?.[0]?.message;
  const usage = json.usage ? {
    promptTokens: json.usage.prompt_tokens,
    completionTokens: json.usage.completion_tokens,
    totalTokens: json.usage.total_tokens,
  } : undefined;
  return {
    content: message?.content ?? '',
    toolCalls: message?.tool_calls,
    usage,
    rawBody: json as Record<string, unknown>,
  };
}

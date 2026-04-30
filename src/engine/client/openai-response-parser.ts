import { createLogger } from '@/utils/logger';
import type { OpenAIChatCompletion, OpenAIResponse } from './openai-response-parser.types';

export type { OpenAIResponse } from './openai-response-parser.types';

const log = createLogger('MODEL-CLIENT');

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

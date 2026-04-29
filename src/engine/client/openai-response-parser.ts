import type { ToolCall } from '@/engine/client/client.types';
import { createLogger } from '@/utils/logger';

const log = createLogger('MODEL-CLIENT');

// Internal types
type StreamReader = { read(): Promise<{ done: boolean; value?: Uint8Array }> };
type OpenAIChatCompletion = {
  choices?: Array<{ message?: { content?: string; tool_calls?: ToolCall[] } }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};
type OpenAISseChunk = {
  choices?: Array<{ delta?: { content?: string } }>;
};
type SseStreamResult = { content: string; ttftMs: number };
type JsonResponseResult = { content: string; toolCalls: ToolCall[] | undefined; usage?: UsageMetrics };

// External types
export type UsageMetrics = { promptTokens: number; completionTokens: number; totalTokens: number };
export type OpenAIResponse = { content: string; ttftMs: number; toolCalls?: ToolCall[]; usage?: UsageMetrics };

export interface OpenAIResponseParser {
  readonly firstTokenTimeoutMs: number | null;
  readonly requiresContent: boolean;
  parse(res: Response, start: number, onFirstChunk: () => void): Promise<OpenAIResponse>;
}

export class SseResponseParser implements OpenAIResponseParser {
  readonly firstTokenTimeoutMs: number;
  readonly requiresContent = true;

  constructor(firstTokenTimeoutMs: number, private readonly streamWatchdogMs: number) {
    this.firstTokenTimeoutMs = firstTokenTimeoutMs;
  }

  async parse(res: Response, start: number, onFirstChunk: () => void): Promise<OpenAIResponse> {
    const { content, ttftMs } = await this.readSseStream(
      res.body!.getReader() as StreamReader,
      start,
      onFirstChunk,
    );
    return { content, ttftMs };
  }

  async readSseStream(
    reader: StreamReader,
    start: number,
    onFirstChunk?: () => void,
  ): Promise<SseStreamResult> {
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let ttftMs = 0;
    let firstChunk = true;

    try {
      while (true) {
        const { done, value } = await this.readWithWatchdog(reader);
        if (done) break;

        if (firstChunk) {
          firstChunk = false;
          onFirstChunk?.();
        }

        if (ttftMs === 0) ttftMs = Date.now() - start;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) content += this.parseSseLine(line);
      }

      if (buffer.trim()) content += this.parseSseLine(buffer);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw err;
    }

    return { content, ttftMs };
  }

  private parseSseLine(line: string): string {
    if (!line.startsWith('data: ')) return '';
    const payload = line.slice(6).trim();
    if (payload === '[DONE]') return '';
    try {
      const json = JSON.parse(payload) as OpenAISseChunk;
      return json.choices?.[0]?.delta?.content ?? '';
    } catch {
      return '';
    }
  }

  private readWithWatchdog(
    reader: StreamReader,
  ): Promise<{ done: boolean; value?: Uint8Array }> {
    return Promise.race([
      reader.read(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new DOMException('Stream watchdog timeout', 'AbortError')),
          this.streamWatchdogMs,
        ),
      ),
    ]);
  }
}

export class JsonResponseParser implements OpenAIResponseParser {
  readonly firstTokenTimeoutMs = null;
  readonly requiresContent = false;

  async parse(res: Response, start: number): Promise<OpenAIResponse> {
    const json = await res.json() as OpenAIChatCompletion;
    const { content, toolCalls, usage } = this.parseJsonResponse(json);
    log.debug({ preview: JSON.stringify(json).slice(0, 200) }, 'non-stream response');
    if (toolCalls) log.debug({ toolCalls }, 'tool_calls received');
    if (usage) log.debug({ usage }, 'usage metrics received');
    return { content, ttftMs: Date.now() - start, toolCalls, usage };
  }

  parseJsonResponse(json: OpenAIChatCompletion): JsonResponseResult {
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
    };
  }
}

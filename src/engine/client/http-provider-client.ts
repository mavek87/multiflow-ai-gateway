/**
 * HttpProviderClient — HTTP client for a single OpenAI-compatible model endpoint.
 *
 * Works with any provider that implements the OpenAI Chat Completions API:
 * Ollama (/v1/chat/completions), OpenRouter, Groq, and others.
 *
 * Tool calling: when tools are provided, uses non-streaming and executes tool calls in a loop.
 */

import type { AIChatMessage, ModelConfig, ToolDefinition, ToolCall } from '@/engine/types';
import { createLogger } from '@/utils/logger';

const log = createLogger('MODEL-CLIENT');

function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

/**
 * Discriminated union returned by every call.
 * - ok=true: content is the model's text reply, latencyMs is total wall-clock time,
 *   ttftMs is time-to-first-token (relevant for streaming quality assessment).
 * - ok=false: kind='soft' means timeout (model was slow, try next);
 *   kind='hard' means HTTP error or empty response (model is broken, open circuit).
 */
export type CallResult =
  | { ok: true; content: string; toolCalls?: ToolCall[]; ttftMs: number; latencyMs: number }
  | { ok: false; kind: 'soft' | 'hard'; error: unknown };

export class HttpProviderClient {
  constructor(
    private config: ModelConfig,
    private systemPrompt: string,
    private firstTokenTimeoutMs = 10000,
    private streamWatchdogMs = 120000,
    private enableThinking = false,
  ) {}

  async call(messages: AIChatMessage[]): Promise<CallResult> {
    return this.callWithTools(messages, undefined, async () => '');
  }

  /**
   * Opens a streaming connection to the provider and returns the raw Response body.
   * Returns a CallResult error if the HTTP request fails before streaming starts.
   * Once the ReadableStream is returned, the caller owns it and must handle mid-stream errors.
   */
  async openStream(messages: AIChatMessage[]): Promise<{ ok: true; body: ReadableStream<Uint8Array>; ttftMs: number } | { ok: false; kind: 'soft' | 'hard'; error: unknown }> {
    const controller = new AbortController();
    const firstTokenTimeout = setTimeout(() => controller.abort(), this.firstTokenTimeoutMs);
    const start = Date.now();

    try {
      const res = await fetch(this.config.url, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({ model: this.config.model, messages: [{ role: 'system', content: this.systemPrompt }, ...messages], stream: true }),
        signal: controller.signal,
      });

      clearTimeout(firstTokenTimeout);

      if (!res.ok) {
        return { ok: false, kind: 'hard', error: new Error(`HTTP ${res.status}`) };
      }

      if (!res.headers.get('content-type')?.includes('text/event-stream')) {
        return { ok: false, kind: 'hard', error: new Error('upstream did not return text/event-stream') };
      }

      return { ok: true, body: res.body!, ttftMs: Date.now() - start };
    } catch (err) {
      clearTimeout(firstTokenTimeout);
      if (err instanceof Error && err.name === 'AbortError') {
        return { ok: false, kind: 'soft', error: err };
      }
      return { ok: false, kind: 'hard', error: err };
    }
  }

  /**
   * Core method — handles both plain chat and tool-calling loops.
   *
   * When tools are provided, the model can respond with tool_calls instead of text.
   * We execute those tools, append the results to the message history, and call the
   * model again. This loop repeats until the model produces a plain text response
   * (no more tool calls) or we hit maxRounds (safety cap against infinite loops).
   *
   * When tools are absent, a single round is performed with streaming enabled.
   */
  async callWithTools(
    messages: AIChatMessage[],
    tools: ToolDefinition[] | undefined,
    executeTool: (name: string, args: Record<string, unknown>) => Promise<string>,
    onFirstToolCall?: () => Promise<void>,
  ): Promise<CallResult> {
    const allMessages: AIChatMessage[] = [
      { role: 'system', content: this.systemPrompt },
      ...messages,
    ];

    const toolEnabled = tools && tools.length > 0;
    const maxRounds = toolEnabled ? 10 : 1; // 10 tool-call rounds max before giving up
    let ackSent = false;

    for (let round = 0; round < maxRounds; round++) {
      const callResult = await this.doSingleRound(allMessages, toolEnabled ? tools : undefined);

      if (!callResult.ok) return callResult;

      const toolCalls = callResult.toolCalls;
      const content = callResult.content;
      allMessages.push({
        role: 'assistant',
        content,
        ...(toolCalls && toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });

      if (!toolCalls || toolCalls.length === 0) {
        const text = stripThinkTags(content);
        if (text) {
          return { ok: true, content: text, ttftMs: callResult.ttftMs, latencyMs: callResult.latencyMs };
        }
        if (ackSent) {
          const lastText = allMessages
            .filter(m => m.role === 'assistant' && !m.tool_calls && m.content.trim())
            .at(-1)?.content ?? '';
          const fallback = stripThinkTags(lastText) || '✅';
          return { ok: true, content: fallback, ttftMs: callResult.ttftMs, latencyMs: callResult.latencyMs };
        }
        return { ok: false, kind: 'hard', error: new Error('empty response') };
      }

      if (!ackSent && onFirstToolCall) {
        ackSent = true;
        await onFirstToolCall();
      }
      log.debug({ count: toolCalls.length }, 'executing tool calls');
      for (const tc of toolCalls) {
        log.debug({ tool: tc.function.name }, 'executing tool');
        const toolResult = await executeTool(tc.function.name, tc.function.arguments);
        log.debug({ tool: tc.function.name, result: toolResult }, 'tool result');
        allMessages.push({
          role: 'tool',
          content: toolResult,
          tool_call_id: tc.id,
        });
      }
    }

    const finalContent = allMessages.findLast(m => m.role === 'assistant')?.content ?? '';
    return { ok: true, content: stripThinkTags(finalContent), ttftMs: 0, latencyMs: 0 };
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }
    return headers;
  }

  private async doSingleRound(
    messages: AIChatMessage[],
    tools: ToolDefinition[] | undefined,
  ): Promise<CallResult> {
    const start = Date.now();
    const toolEnabled = tools && tools.length > 0;
    const controller = new AbortController();

    // Two-layer timeout for streaming:
    // 1. firstTokenTimeout: abort if no HTTP response within firstTokenTimeoutMs
    // 2. totalTimeout: hard wall-clock cap on the entire request (streamWatchdogMs)
    // On first chunk, firstTokenTimeout is cleared but totalTimeout keeps running.
    const totalTimeout = setTimeout(() => controller.abort(), this.streamWatchdogMs);
    const firstTokenTimeout = !toolEnabled
      ? setTimeout(() => controller.abort(), this.firstTokenTimeoutMs)
      : null;

    log.debug({ tools: tools?.length ?? 0, stream: !toolEnabled }, 'round start');

    try {
      const body: Record<string, unknown> = {
        model: this.config.model,
        messages,
        stream: !toolEnabled,
      };
      if (this.enableThinking) body.think = true;
      if (toolEnabled) body.tools = tools;

      const res = await fetch(this.config.url, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        log.error({ status: res.status }, 'HTTP error');
        return { ok: false, kind: 'hard', error: new Error(`HTTP ${res.status}`) };
      }

      let content: string;
      let ttftMs: number;
      let toolCalls: ToolCall[] | undefined;

      if (toolEnabled) {
        // Non-streaming: OpenAI-compat response
        // { choices: [{ message: { content, tool_calls } }] }
        const json = await res.json() as {
          choices?: Array<{ message?: { content?: string; tool_calls?: ToolCall[] } }>;
        };
        const message = json.choices?.[0]?.message;
        content = message?.content ?? '';
        toolCalls = message?.tool_calls;
        ttftMs = Date.now() - start;
        log.debug({ preview: JSON.stringify(json).slice(0, 200) }, 'non-stream response');
        if (toolCalls) log.debug({ toolCalls }, 'tool_calls received');
      } else {
        // Streaming: OpenAI SSE format
        // data: { choices: [{ delta: { content } }] }\n\n
        // On first chunk clear firstTokenTimeout; totalTimeout stays active as a hard cap.
        const result = await this.readStream(
          res.body!.getReader() as { read(): Promise<{ done: boolean; value?: Uint8Array }> },
          start,
          () => { if (firstTokenTimeout) clearTimeout(firstTokenTimeout); },
        );
        content = result.content;
        ttftMs = result.ttftMs;
      }

      if (!content && !toolEnabled) {
        return { ok: false, kind: 'hard', error: new Error('empty response') };
      }

      return { ok: true, content, toolCalls, ttftMs, latencyMs: Date.now() - start };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return { ok: false, kind: 'soft', error: err };
      }
      log.error({ err }, 'fetch failed');
      return { ok: false, kind: 'hard', error: err };
    } finally {
      if (firstTokenTimeout) clearTimeout(firstTokenTimeout);
      clearTimeout(totalTimeout);
    }
  }

  private async readStream(
    reader: { read(): Promise<{ done: boolean; value?: Uint8Array }> },
    start: number,
    onFirstChunk?: () => void,
  ): Promise<{ content: string; ttftMs: number }> {
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let ttftMs = 0;
    let firstChunk = true;

    const readWithWatchdog = (): Promise<{ done: boolean; value?: Uint8Array }> => {
      return Promise.race([
        reader.read(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new DOMException('Stream watchdog timeout', 'AbortError')),
            this.streamWatchdogMs,
          ),
        ),
      ]);
    };

    try {
      while (true) {
        const { done, value } = await readWithWatchdog();
        if (done) break;

        if (firstChunk) {
          firstChunk = false;
          onFirstChunk?.();
        }

        if (ttftMs === 0) ttftMs = Date.now() - start;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) content += this.parseSSELine(line);
      }

      if (buffer.trim()) content += this.parseSSELine(buffer);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw err;
    }

    return { content, ttftMs };
  }

  private parseSSELine(line: string): string {
    // OpenAI SSE format: "data: {...}" or "data: [DONE]"
    if (!line.startsWith('data: ')) return '';
    const payload = line.slice(6).trim();
    if (payload === '[DONE]') return '';
    try {
      const json = JSON.parse(payload) as {
        choices?: Array<{ delta?: { content?: string }; finish_reason?: string }>;
      };
      return json.choices?.[0]?.delta?.content ?? '';
    } catch {
      return '';
    }
  }
}

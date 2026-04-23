/**
 * HttpProviderClient -- HTTP client for a single OpenAI-compatible model endpoint.
 *
 * Works with any provider that implements the OpenAI Chat Completions API:
 * Ollama (/v1/chat/completions), OpenRouter, Groq, and others.
 *
 * Tool calling: when tools are provided, uses non-streaming and executes tool calls in a loop.
 */

import type { AIChatMessage, ModelConfig, ToolDefinition, ToolCall } from '@/engine/types';
import { createLogger } from '@/utils/logger';
import { ToolCallOrchestrator } from './tool-call-orchestrator';
import { SseResponseParser, JsonResponseParser, type OpenAIResponseParser } from './openai-response-parser';
import { stripThinkTags } from '@/utils/text';

const log = createLogger('MODEL-CLIENT');

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
    const history: AIChatMessage[] = [{ role: 'system', content: this.systemPrompt }, ...messages];
    const result = await this.callModel(history, new SseResponseParser(this.firstTokenTimeoutMs, this.streamWatchdogMs));
    if (result.ok) return { ...result, content: stripThinkTags(result.content) };
    return result;
  }

  /**
   * Opens a streaming connection to the provider and returns the raw Response body.
   * Returns a CallResult error if the HTTP request fails before streaming starts.
   * Once the ReadableStream is returned, the caller owns it and must handle mid-stream errors.
   */
  async callStream(messages: AIChatMessage[]): Promise<{ ok: true; body: ReadableStream<Uint8Array>; ttftMs: number } | { ok: false; kind: 'soft' | 'hard'; error: unknown }> {
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

  async callWithTools(
    messages: AIChatMessage[],
    tools: ToolDefinition[],
    executeTool: (name: string, args: Record<string, unknown>) => Promise<string>,
    onFirstToolCall?: () => Promise<void>,
  ): Promise<CallResult> {
    const history: AIChatMessage[] = [{ role: 'system', content: this.systemPrompt }, ...messages];
    const responseParser = new JsonResponseParser();
    const orchestrator = new ToolCallOrchestrator((msgs) => this.callModel(msgs, responseParser, tools));
    return orchestrator.applyTools(history, tools, executeTool, onFirstToolCall);
  }

  private buildBody(messages: AIChatMessage[], stream: boolean, tools?: ToolDefinition[]): Record<string, unknown> {
    const body: Record<string, unknown> = { model: this.config.model, messages, stream };
    if (this.enableThinking) body.think = true;
    if (tools?.length) body.tools = tools;
    return body;
  }

  private async callModel(
    messages: AIChatMessage[],
    responseParser: OpenAIResponseParser,
    tools?: ToolDefinition[],
  ): Promise<CallResult> {
    const start = Date.now();
    const controller = new AbortController();
    const stream = responseParser.firstTokenTimeoutMs !== null;

    const totalTimeout = setTimeout(() => controller.abort(), this.streamWatchdogMs);
    const firstTokenTimeout = responseParser.firstTokenTimeoutMs
      ? setTimeout(() => controller.abort(), responseParser.firstTokenTimeoutMs)
      : null;

    log.debug({ stream }, 'round start');

    try {
      const res = await fetch(this.config.url, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(this.buildBody(messages, stream, tools)),
        signal: controller.signal,
      });

      if (!res.ok) {
        log.error({ status: res.status }, 'HTTP error');
        return { ok: false, kind: 'hard', error: new Error(`HTTP ${res.status}`) };
      }

      const { content, ttftMs, toolCalls } = await responseParser.parse(
        res,
        start,
        () => { if (firstTokenTimeout) clearTimeout(firstTokenTimeout); },
      );

      if (!content && responseParser.requiresContent) {
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

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }
    return headers;
  }
}

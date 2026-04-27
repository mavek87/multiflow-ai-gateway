/**
 * HttpProviderClient -- HTTP client for a single OpenAI-compatible model endpoint.
 *
 * Works with any provider that implements the OpenAI Chat Completions API:
 * Ollama (/v1/chat/completions), OpenRouter, Groq, and others.
 *
 * Tool calling: when tools are provided, uses non-streaming and executes tool calls in a loop.
 */

import { ok, err, type Result } from 'neverthrow';
import type { AIChatMessage, ModelConfig, ToolCall } from '@/engine/client/client.types';
import type { ToolDefinition, ToolDispatcher } from '@/engine/tools/tools.types';
import { createLogger } from '@/utils/logger';
import { ToolCallOrchestrator } from '@/engine/tools/tools-call-orchestrator';
import { SseResponseParser, JsonResponseParser, type OpenAIResponseParser } from './openai-response-parser';
import { stripThinkTags } from '@/utils/text';

const log = createLogger('MODEL-CLIENT');

export type CallProviderError = { kind: 'soft' | 'hard'; error: unknown };
export type CallProviderSuccess = { content: string; toolCalls?: ToolCall[]; ttftMs: number; latencyMs: number };
export type CallProviderResult = Result<CallProviderSuccess, CallProviderError>;
export type CallProviderStreamSuccess = { body: ReadableStream<Uint8Array>; ttftMs: number };
export type CallProviderStreamResult = Result<CallProviderStreamSuccess, CallProviderError>;

export class HttpProviderClient {
  constructor(
    private config: ModelConfig,
    private firstTokenTimeoutMs = 30000,
    private streamWatchdogMs = 120000,
    private enableThinking = false,
  ) {}

  /**
   * Executes a non-streaming chat completion request.
   * Automatically strips <think> tags from the final response.
   */
  async chat(systemPrompt: string, messages: AIChatMessage[]): Promise<CallProviderResult> {
    const history: AIChatMessage[] = [{ role: 'system', content: systemPrompt }, ...messages];
    const result = await this.callProvider(history, new SseResponseParser(this.firstTokenTimeoutMs, this.streamWatchdogMs));
    return result.map((r) => ({ ...r, content: stripThinkTags(r.content) }));
  }

  /**
   * Executes a chat completion request with tool-calling capabilities.
   * Orchestrates the loop of model responses and local tool executions until a final answer is reached.
   */
  async chatWithTools(
      systemPrompt: string,
      messages: AIChatMessage[],
      tools: ToolDefinition[],
      executeToolFn: (name: string, args: Record<string, unknown>) => Promise<string>,
      // TODO: onFirstToolCall is unused by any caller - evaluate removal
      onFirstToolCall?: () => Promise<void>,
  ): Promise<CallProviderResult> {
    const history: AIChatMessage[] = [{ role: 'system', content: systemPrompt }, ...messages];
    const orchestrator = new ToolCallOrchestrator((msgs) => this.callProvider(msgs, new JsonResponseParser(), tools));
    return orchestrator.applyTools(history, tools, executeToolFn, onFirstToolCall);
  }

  /**
   * Opens a streaming connection to the provider and returns the raw Response body.
   * Returns a StreamResult error if the HTTP request fails before streaming starts.
   * Once the ReadableStream is returned, the caller owns it and must handle mid-stream errors.
   */
  async chatStream(systemPrompt: string, messages: AIChatMessage[]): Promise<CallProviderStreamResult> {
    const controller = new AbortController();
    const firstTokenTimeout = setTimeout(() => controller.abort(), this.firstTokenTimeoutMs);
    const start = Date.now();

    try {
      const res = await fetch(this.config.url, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({ model: this.config.model, messages: [{ role: 'system', content: systemPrompt }, ...messages], stream: true }),
        signal: controller.signal,
      });

      clearTimeout(firstTokenTimeout);

      if (!res.ok) {
        return err({ kind: 'hard', error: new Error(`HTTP ${res.status}`) });
      }

      if (!res.headers.get('content-type')?.includes('text/event-stream')) {
        return err({ kind: 'hard', error: new Error('upstream did not return text/event-stream') });
      }

      return ok({ body: res.body!, ttftMs: Date.now() - start });
    } catch (e) {
      clearTimeout(firstTokenTimeout);
      if (e instanceof Error && e.name === 'AbortError') {
        return err({ kind: 'soft', error: e });
      }
      return err({ kind: 'hard', error: e });
    }
  }

  private async callProvider(
    messages: AIChatMessage[],
    responseParser: OpenAIResponseParser,
    tools?: ToolDefinition[],
  ): Promise<CallProviderResult> {
    const startTime = Date.now();
    const abortController = new AbortController();
    const stream = responseParser.firstTokenTimeoutMs !== null;

    const totalTimeout = setTimeout(() => abortController.abort(), this.streamWatchdogMs);
    const firstTokenTimeout = responseParser.firstTokenTimeoutMs
      ? setTimeout(() => abortController.abort(), responseParser.firstTokenTimeoutMs)
      : null;

    log.debug({ stream }, 'round start');

    try {
      const response = await fetch(this.config.url, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(this.buildBody(messages, stream, tools)),
        signal: abortController.signal,
      });

      if (!response.ok) {
        log.error({ status: response.status }, 'HTTP error');
        return err({ kind: 'hard', error: new Error(`HTTP ${response.status}`) });
      }

      const { content, ttftMs, toolCalls } = await responseParser.parse(
        response,
        startTime,
        () => { if (firstTokenTimeout) clearTimeout(firstTokenTimeout); },
      );

      if (!content && responseParser.requiresContent) {
        return err({ kind: 'hard', error: new Error('empty response') });
      }

      return ok({ content, toolCalls, ttftMs, latencyMs: Date.now() - startTime });
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        return err({ kind: 'soft', error: e });
      }
      log.error({ err: e }, 'fetch failed');
      return err({ kind: 'hard', error: e });
    } finally {
      if (firstTokenTimeout) clearTimeout(firstTokenTimeout);
      clearTimeout(totalTimeout);
    }
  }

  private buildBody(messages: AIChatMessage[], stream: boolean, tools?: ToolDefinition[]): Record<string, unknown> {
    const body: Record<string, unknown> = { model: this.config.model, messages, stream };
    if (this.enableThinking) body.think = true;
    if (tools?.length) body.tools = tools;
    return body;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }
    return headers;
  }
}

/**
 * HttpProviderClient -- HTTP client for a single OpenAI-compatible model endpoint.
 *
 * Works with any provider that implements the OpenAI Chat Completions API:
 * Ollama (/v1/chat/completions), OpenRouter, Groq, and others.
 *
 * Tool calling: when tools are provided, uses non-streaming and executes tool calls in a loop.
 */

import { ok, err, type Result } from 'neverthrow';
import type { AIChatMessage, ModelConfig, ToolCall, ChatOptions } from '@/engine/client/client.types';
import type { ToolDefinition, ToolDispatcher } from '@/engine/tools/tools.types';
import { createLogger } from '@/utils/logger';
import { ToolCallOrchestrator } from '@/engine/tools/tools-call-orchestrator';
import { JsonResponseParser, type OpenAIResponseParser, type UsageMetrics } from './openai-response-parser';
import { stripThinkTags } from '@/utils/text';

const log = createLogger('HTTP-PROVIDER-CLIENT');

export type CallProviderError = { kind: 'soft' | 'hard'; error: unknown };
export type CallProviderSuccess = { content: string; toolCalls?: ToolCall[]; ttftMs: number; latencyMs: number; usage?: UsageMetrics; rawBody?: Record<string, unknown> };
export type CallProviderResult = Result<CallProviderSuccess, CallProviderError>;
export type CallProviderStreamSuccess = { body: ReadableStream<Uint8Array>; ttftMs: number };
export type CallProviderStreamResult = Result<CallProviderStreamSuccess, CallProviderError>;

export class HttpProviderClient {
  constructor(
    private config: ModelConfig,
    private firstTokenTimeoutMs = 30000,
    private streamWatchdogMs = 120000,
    private providerRequestTimeoutMs = 30000,
    private enableThinking = false,
  ) {}

  /**
   * Executes a non-streaming chat completion request.
   * Always uses JSON (stream: false) for maximum provider compatibility and to capture usage metrics.
   */
  async chat(systemPrompt: string, messages: AIChatMessage[], opts?: ChatOptions): Promise<CallProviderResult> {
    const history: AIChatMessage[] = [{ role: 'system', content: systemPrompt }, ...messages];
    const hasTools = (opts?.tools?.length ?? 0) > 0;
    const result = await this.callProvider(history, new JsonResponseParser(), undefined, opts);
    if (hasTools) return result;
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
   * All opts (tools, sampling params) are forwarded upstream transparently.
   */
  async chatStream(systemPrompt: string, messages: AIChatMessage[], opts?: ChatOptions): Promise<CallProviderStreamResult> {
    const controller = new AbortController();
    const firstTokenTimeout = setTimeout(() => controller.abort(), this.firstTokenTimeoutMs);
    const start = Date.now();

    try {
      const res = await fetch(this.config.url, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(this.buildBody([{ role: 'system', content: systemPrompt }, ...messages], true, undefined, opts)),
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
    opts?: ChatOptions,
  ): Promise<CallProviderResult> {
    const startTime = Date.now();
    const abortController = new AbortController();
    const stream = responseParser.firstTokenTimeoutMs !== null;

    const totalTimeout = setTimeout(
      () => abortController.abort(),
      stream ? this.streamWatchdogMs : this.providerRequestTimeoutMs,
    );
    const firstTokenTimeout = responseParser.firstTokenTimeoutMs
      ? setTimeout(() => abortController.abort(), responseParser.firstTokenTimeoutMs)
      : null;

    log.debug({ stream }, 'round start');

    try {
      const response = await fetch(this.config.url, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(this.buildBody(messages, stream, tools, opts)),
        signal: abortController.signal,
      });

      if (!response.ok) {
        log.error({ status: response.status }, 'HTTP error');
        return err({ kind: 'hard', error: new Error(`HTTP ${response.status}`) });
      }

      const { content, ttftMs, toolCalls, usage, rawBody } = await responseParser.parse(
        response,
        startTime,
        () => { if (firstTokenTimeout) clearTimeout(firstTokenTimeout); },
      );

      if (!content && !toolCalls?.length && responseParser.requiresContent) {
        return err({ kind: 'hard', error: new Error('empty response') });
      }

      return ok({ content, toolCalls, ttftMs, latencyMs: Date.now() - startTime, usage, rawBody });
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

  private buildBody(messages: AIChatMessage[], stream: boolean, tools?: ToolDefinition[], opts?: ChatOptions): Record<string, unknown> {
    const body: Record<string, unknown> = { model: this.config.model, messages, stream };
    if (this.enableThinking) body.think = true;
    if (tools?.length) body.tools = tools;

    if (opts) {
      if (opts.tools?.length) body.tools = opts.tools;
      if (opts.tool_choice !== undefined) body.tool_choice = opts.tool_choice;
      if (opts.parallel_tool_calls !== undefined) body.parallel_tool_calls = opts.parallel_tool_calls;
      if (opts.temperature !== undefined) body.temperature = opts.temperature;
      if (opts.top_p !== undefined) body.top_p = opts.top_p;
      if (opts.max_tokens !== undefined) body.max_tokens = opts.max_tokens;
      if (opts.max_completion_tokens !== undefined) body.max_completion_tokens = opts.max_completion_tokens;
      if (opts.presence_penalty !== undefined) body.presence_penalty = opts.presence_penalty;
      if (opts.frequency_penalty !== undefined) body.frequency_penalty = opts.frequency_penalty;
      if (opts.seed !== undefined) body.seed = opts.seed;
      if (opts.stop !== undefined) body.stop = opts.stop;
      if (opts.response_format !== undefined) body.response_format = opts.response_format;
      if (opts.stream_options !== undefined) body.stream_options = opts.stream_options;
      if (opts.user !== undefined) body.user = opts.user;
    }

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

/**
 * HttpProviderClient -- HTTP client for a single OpenAI-compatible model endpoint.
 *
 * Works with any provider that implements the OpenAI Chat Completions API:
 * Ollama (/v1/chat/completions), OpenRouter, Groq, and others.
 *
 * Tool calling: when tools are provided, uses non-streaming and executes tool calls in a loop.
 */

import {err, ok} from 'neverthrow';
import type {
    AIChatMessage,
    CallProviderResult,
    CallProviderStreamResult,
    ChatOptions,
    ModelConfig
} from '@/engine/client/http-provider-client.types';
import {createLogger} from '@/utils/logger';
import {parseJsonResponse} from './openai-response-parser';
import {stripThinkTags} from '@/utils/text';

const log = createLogger('HTTP-PROVIDER-CLIENT');

export class HttpProviderClient {
    constructor(
        private config: ModelConfig,
        private firstTokenTimeoutMs = 30000,
        private providerRequestTimeoutMs = 30000,
        private enableThinking = false,
    ) {
    }

    /**
     * Executes a non-streaming chat completion request.
     * Always uses JSON (stream: false) for maximum provider compatibility and to capture usage metrics.
     */
    async chat(systemPrompt: string, messages: AIChatMessage[], opts?: ChatOptions): Promise<CallProviderResult> {
        const history: AIChatMessage[] = [{role: 'system', content: systemPrompt}, ...messages];
        const hasTools = (opts?.tools?.length ?? 0) > 0;
        const startTime = Date.now();
        const abortController = new AbortController();
        const totalTimeout = setTimeout(() => abortController.abort(), this.providerRequestTimeoutMs);

        log.debug('round start');

        try {
            const response = await fetch(this.config.url, {
                method: 'POST',
                headers: this.buildHeaders(),
                body: JSON.stringify(this.buildBody(history, false, opts)),
                signal: abortController.signal,
            });

            if (!response.ok) {
                log.error({status: response.status}, 'HTTP error');
                return err({kind: 'hard', error: new Error(`HTTP ${response.status}`)});
            }

            const {content, ttftMs, toolCalls, rawBody} = await parseJsonResponse(response, startTime);
            const result = ok({content, toolCalls, ttftMs, latencyMs: Date.now() - startTime, rawBody});

            if (hasTools) return result;
            return result.map((r) => ({...r, content: stripThinkTags(r.content)}));
        } catch (e) {
            if (e instanceof Error && e.name === 'AbortError') {
                return err({kind: 'soft', error: e});
            }
            log.error({err: e}, 'fetch failed');
            return err({kind: 'hard', error: e});
        } finally {
            clearTimeout(totalTimeout);
        }
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
                body: JSON.stringify(this.buildBody([{role: 'system', content: systemPrompt}, ...messages], true, opts)),
                signal: controller.signal,
            });

            clearTimeout(firstTokenTimeout);

            if (!res.ok) {
                return err({kind: 'hard', error: new Error(`HTTP ${res.status}`)});
            }

            if (!res.headers.get('content-type')?.includes('text/event-stream')) {
                return err({kind: 'hard', error: new Error('upstream did not return text/event-stream')});
            }

            return ok({body: res.body!, ttftMs: Date.now() - start});
        } catch (e) {
            clearTimeout(firstTokenTimeout);
            if (e instanceof Error && e.name === 'AbortError') {
                return err({kind: 'soft', error: e});
            }
            return err({kind: 'hard', error: e});
        }
    }

    private buildHeaders(): Record<string, string> {
        const headers: Record<string, string> = {'Content-Type': 'application/json'};
        if (this.config.apiKey) {
            headers['Authorization'] = `Bearer ${this.config.apiKey}`;
        }
        return headers;
    }

    private buildBody(messages: AIChatMessage[], stream: boolean, opts?: ChatOptions): Record<string, unknown> {
        const body: Record<string, unknown> = {model: this.config.model, messages, stream};
        if (this.enableThinking) body.think = true;

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
}

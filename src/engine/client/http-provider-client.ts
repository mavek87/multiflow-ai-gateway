/**
 * HttpProviderClient -- HTTP client for a single OpenAI-compatible model endpoint.
 *
 * Works with any provider that implements the OpenAI Chat Completions API:
 * Ollama (/v1/chat/completions), OpenRouter, Groq, and others.
 *
 * Tool calling: when tools are provided, uses non-streaming and executes tool calls in a loop.
 */

import {err, ok, type Result} from 'neverthrow';
import type {ChatMessage, ToolCall} from '@/chat/chat.types';
import type {
    CallProviderResult,
    CallProviderStreamResult,
    CallProviderError,
    ModelConfig,
    OpenAIChatCompletion,
} from '@/engine/client/http-provider-client.types';
import type {ChatOptions} from '@/chat/chat.types';
import {createLogger} from '@/utils/logger';
import {stripThinkTags} from '@/utils/text';

const log = createLogger('HTTP-PROVIDER-CLIENT');

export class HttpProviderClient {
    constructor(
        private config: ModelConfig,
        private providerFirstTokenTimeoutMs: number,
        private providerRequestTimeoutMs: number,
        private enableThinking = false,
    ) {
    }

    async call(systemPrompt: string, messages: ChatMessage[], opts?: ChatOptions): Promise<CallProviderResult> {
        const history: ChatMessage[] = systemPrompt ? [{role: 'system', content: systemPrompt}, ...messages] : messages;
        const hasTools = (opts?.tools?.length ?? 0) > 0;
        const startTime = Date.now();

        const response = await this.doRequest(history, false, opts, this.providerRequestTimeoutMs);
        if (response.isErr()) return err(response.error);

        const parsed = await this.parseJsonResponse(response.value, startTime);
        if (parsed.isErr()) return err(parsed.error);

        const {content, ttftMs, toolCalls, body} = parsed.value;
        const result = ok({content, toolCalls, ttftMs, latencyMs: Date.now() - startTime, body});

        if (hasTools) return result;
        return result.map((r) => ({...r, content: stripThinkTags(r.content)}));
    }

    async callStream(systemPrompt: string, messages: ChatMessage[], opts?: ChatOptions): Promise<CallProviderStreamResult> {
        const history: ChatMessage[] = systemPrompt ? [{role: 'system', content: systemPrompt}, ...messages] : messages;
        const start = Date.now();

        const response = await this.doRequest(history, true, opts, this.providerFirstTokenTimeoutMs);
        if (response.isErr()) return err(response.error);

        if (!response.value.headers.get('content-type')?.includes('text/event-stream')) {
            return err({kind: 'network', error: new Error('upstream did not return text/event-stream')});
        }
        if (!response.value.body) {
            return err({kind: 'network', error: new Error('upstream returned no body')});
        }

        return this.readFirstChunk(response.value.body, start);
    }

    private async doRequest(history: ChatMessage[], stream: boolean, opts: ChatOptions | undefined, timeoutMs: number): Promise<Result<Response, CallProviderError>> {
        const abortController = new AbortController();
        const timeout = setTimeout(() => abortController.abort(), timeoutMs);
        try {
            const response = await fetch(this.config.url, {
                method: 'POST',
                headers: this.buildHeaders(),
                body: JSON.stringify(this.buildBody(history, stream, opts)),
                signal: abortController.signal,
            });
            if (!response.ok) return err({kind: 'http', status: response.status});
            return ok(response);
        } catch (e) {
            if (e instanceof Error && e.name === 'AbortError') return err({kind: 'timeout'});
            return err({kind: 'network', error: e});
        } finally {
            clearTimeout(timeout);
        }
    }

    private async readFirstChunk(body: ReadableStream<Uint8Array>, start: number): Promise<CallProviderStreamResult> {
        const reader = body.getReader();

        let firstChunk: Uint8Array | undefined;
        let ttftMs: number;

        try {
            const {value, done} = await reader.read();
            ttftMs = Date.now() - start;
            if (!done) firstChunk = value;
        } catch (e) {
            reader.releaseLock();
            if (e instanceof Error && e.name === 'AbortError') {
                return err({kind: 'timeout'});
            }
            return err({kind: 'network', error: e});
        }

        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                if (firstChunk !== undefined) controller.enqueue(firstChunk);
            },
            async pull(controller) {
                try {
                    const {value, done} = await reader.read();
                    if (done) controller.close();
                    else controller.enqueue(value);
                } catch (e) {
                    controller.error(e);
                }
            },
            cancel() {
                reader.cancel().catch(() => {});
            },
        });

        return ok({body: stream, ttftMs});
    }

    private buildHeaders(): Record<string, string> {
        const headers: Record<string, string> = {'Content-Type': 'application/json'};
        if (this.config.apiKey) {
            headers['Authorization'] = `Bearer ${this.config.apiKey}`;
        }
        return headers;
    }

    private buildBody(messages: ChatMessage[], stream: boolean, opts?: ChatOptions): Record<string, unknown> {
        const body: Record<string, unknown> = {model: this.config.model, messages, stream};
        if (this.enableThinking) body.think = true;
        if (opts) Object.assign(body, opts);
        return body;
    }

    private async parseJsonResponse(res: Response, start: number): Promise<Result<{ content: string; ttftMs: number; toolCalls?: ToolCall[]; body: Record<string, unknown> }, CallProviderError>> {
        try {
            const json = await res.json() as OpenAIChatCompletion;
            log.debug({preview: JSON.stringify(json).slice(0, 200)}, 'non-stream response');
            const message = json.choices?.[0]?.message;
            const toolCalls = message?.tool_calls;
            if (toolCalls) log.debug({toolCalls}, 'tool_calls received');
            return ok({
                content: message?.content ?? '',
                toolCalls,
                ttftMs: Date.now() - start,
                body: json as Record<string, unknown>,
            });
        } catch (e) {
            return err({kind: 'parse', error: e});
        }
    }
}

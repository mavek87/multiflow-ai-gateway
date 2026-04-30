/**
 * HttpProviderClient -- HTTP client for a single OpenAI-compatible model endpoint.
 *
 * Works with any provider that implements the OpenAI Chat Completions API:
 * Ollama (/v1/chat/completions), OpenRouter, Groq, and others.
 *
 * Tool calling: when tools are provided, uses non-streaming and executes tool calls in a loop.
 */

import {err, ok, type Result} from 'neverthrow';
import type {AIChatMessage, ToolCall} from '@/chat/chat.types';
import type {
    CallProviderResult,
    CallProviderStreamResult,
    CallProviderError,
    ProviderChatOptions,
    ModelConfig,
    OpenAIChatCompletion,
} from '@/engine/client/http-provider-client.types';
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

    async call(systemPrompt: string, messages: AIChatMessage[], opts?: ProviderChatOptions): Promise<CallProviderResult> {
        const history: AIChatMessage[] = [{role: 'system', content: systemPrompt}, ...messages];
        const hasTools = (opts?.tools?.length ?? 0) > 0;
        const startTime = Date.now();

        const abortController = new AbortController();
        const timeout = setTimeout(() => abortController.abort(), this.providerRequestTimeoutMs);

        try {
            const response = await fetch(this.config.url, {
                method: 'POST',
                headers: this.buildHeaders(),
                body: JSON.stringify(this.buildBody(history, false, opts)),
                signal: abortController.signal,
            });

            if (!response.ok) {
                return err({kind: 'hard', error: new Error(`HTTP ${response.status}`)});
            }

            const parsed = await this.parseJsonResponse(response, startTime);
            if (parsed.isErr()) return err(parsed.error);

            const {content, ttftMs, toolCalls, rawBody} = parsed.value;
            const result = ok({content, toolCalls, ttftMs, latencyMs: Date.now() - startTime, rawBody});

            if (hasTools) return result;
            return result.map((r) => ({...r, content: stripThinkTags(r.content)}));
        } catch (e) {
            if (e instanceof Error && e.name === 'AbortError') {
                return err({kind: 'soft', error: e});
            }
            return err({kind: 'hard', error: e});
        } finally {
            clearTimeout(timeout);
        }
    }

    async callStream(systemPrompt: string, messages: AIChatMessage[], opts?: ProviderChatOptions): Promise<CallProviderStreamResult> {
        const history: AIChatMessage[] = [{role: 'system', content: systemPrompt}, ...messages];
        const start = Date.now();

        const abortController = new AbortController();
        const timeout = setTimeout(() => abortController.abort(), this.providerFirstTokenTimeoutMs);

        try {
            const response = await fetch(this.config.url, {
                method: 'POST',
                headers: this.buildHeaders(),
                body: JSON.stringify(this.buildBody(history, true, opts)),
                signal: abortController.signal,
            });

            if (!response.ok) {
                return err({kind: 'hard', error: new Error(`HTTP ${response.status}`)});
            }
            if (!response.headers.get('content-type')?.includes('text/event-stream')) {
                return err({kind: 'hard', error: new Error('upstream did not return text/event-stream')});
            }
            if (!response.body) {
                return err({kind: 'hard', error: new Error('upstream returned no body')});
            }

            return await this.readFirstChunk(response.body, start);
        } catch (e) {
            if (e instanceof Error && e.name === 'AbortError') {
                return err({kind: 'soft', error: e});
            }
            return err({kind: 'hard', error: e});
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
                return err({kind: 'soft', error: e});
            }
            return err({kind: 'hard', error: e});
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

    private buildBody(messages: AIChatMessage[], stream: boolean, opts?: ProviderChatOptions): Record<string, unknown> {
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

    private async parseJsonResponse(res: Response, start: number): Promise<Result<{ content: string; ttftMs: number; toolCalls?: ToolCall[]; rawBody: Record<string, unknown> }, CallProviderError>> {
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
                rawBody: json as Record<string, unknown>,
            });
        } catch (e) {
            return err({kind: 'hard', error: e});
        }
    }
}

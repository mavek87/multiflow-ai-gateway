/**
 * AIRouter - adaptive multi-model router.
 */

import type {Result} from 'neverthrow';
import type {ChatMessage} from '@/chat/chat.types';
import type {ChatOptions} from '@/chat/chat.types';
import type {
    CallProviderError,
    CallProviderSuccess,
    CallProviderStreamSuccess,
} from '@/engine/client/http-provider-client.types';
import type {
    TenantContext,
    ProviderBaseResponse,
    ProviderChatResponse,
    ProviderStreamResponse,
} from '@/engine/routing/ai-router.types';
import {HttpProviderClient} from '@/engine/client/http-provider-client';

import type {ModelSelector} from '@/engine/selection/model-selector.types';
import {MetricsStore} from '@/engine/observability/metrics';
import {CircuitBreaker} from '@/engine/resilience/circuit-breaker';
import {createLogger} from '@/utils/logger';
import type {AuditStore} from '@/db/audit/audit.store';
import type {RoutedSuccess} from '@/engine/routing/ai-router.types';

const log = createLogger('AI-ROUTER');
const MAX_ATTEMPTS_CAP = 10;
const UNKNOWN = 'unknown';

function toLogContext(e: CallProviderError): Record<string, unknown> {
    if (e.kind === 'timeout') return {kind: 'timeout'};
    if (e.kind === 'http') return {kind: 'http', status: e.status};
    return {kind: e.kind, reason: e.error instanceof Error ? e.error.message : String(e.error)};
}

export class AIRouter {
    constructor(
        private readonly clients: Map<string, HttpProviderClient>,
        private readonly metrics: MetricsStore,
        private readonly circuitBreaker: CircuitBreaker,
        private readonly modelSelector: ModelSelector,
        private readonly aiProviderIds: Map<string, { name: string; baseUrl: string; modelName: string }>,
        private readonly auditStore: AuditStore,
    ) {
    }

    async chat(systemPrompt: string, messages: ChatMessage[], ctx?: TenantContext, opts?: ChatOptions): Promise<ProviderChatResponse | null> {
        log.info({messages: messages.length, tenantId: ctx?.tenantId ?? UNKNOWN}, 'new request');

        return this.executeWithAudit(ctx?.tenantId ?? UNKNOWN, async () => {
            const result = await this.executeWithRetry<CallProviderSuccess>((client) => client.call(systemPrompt, messages, opts));
            if (!result) return null;

            const {displayName, providerName} = this.resolveDisplay(result.model);
            log.info({model: displayName, provider: providerName, latencyMs: result.latencyMs, ttftMs: result.ttftMs}, 'model succeeded');
            return {content: result.content, toolCalls: result.toolCalls, body: result.body, model: displayName, aiProviderId: result.aiProviderId, aiProvider: result.aiProvider, aiProviderUrl: result.aiProviderUrl};
        });
    }

    async chatStream(systemPrompt: string, messages: ChatMessage[], ctx?: TenantContext, opts?: ChatOptions): Promise<ProviderStreamResponse | null> {
        log.info({messages: messages.length, tenantId: ctx?.tenantId ?? UNKNOWN}, 'new stream request');

        return this.executeWithAudit(ctx?.tenantId ?? UNKNOWN, async () => {
            const result = await this.executeWithRetry<CallProviderStreamSuccess>((client) => client.callStream(systemPrompt, messages, opts));
            if (!result) return null;

            const {displayName, providerName} = this.resolveDisplay(result.model);
            log.info({model: displayName, provider: providerName, ttftMs: result.ttftMs}, 'stream model succeeded');
            return {body: result.body, model: displayName, aiProviderId: result.aiProviderId, aiProvider: result.aiProvider, aiProviderUrl: result.aiProviderUrl};
        });
    }

    private resolveDisplay(modelId: string): { displayName: string; providerName: string | undefined } {
        const meta = this.aiProviderIds.get(modelId);
        return {displayName: meta?.modelName ?? modelId, providerName: meta?.name};
    }

    private async executeWithRetry<TSuccess extends { ttftMs: number; latencyMs?: number }>(
        operation: (client: HttpProviderClient) => Promise<Result<TSuccess, CallProviderError>>,
    ): Promise<RoutedSuccess<TSuccess> | null> {
        const attemptedModels = new Set<string>();
        const modelIds = Array.from(this.clients.keys());
        const maxAttempts = Math.min(modelIds.length, MAX_ATTEMPTS_CAP);

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const remaining = modelIds.filter((id) => !attemptedModels.has(id));
            const selected = this.modelSelector.select(remaining, this.metrics, this.circuitBreaker);

            if (!selected) {
                log.warn('All models unavailable or exhausted');
                break;
            }

            attemptedModels.add(selected);
            const modelMeta = this.aiProviderIds.get(selected);
            log.info({
                attempt: attempt + 1,
                model: modelMeta?.modelName ?? selected,
                provider: modelMeta?.name
            }, 'routing attempt');

            const client = this.clients.get(selected)!;
            const result = await operation(client);

            if (result.isOk()) {
                const latencyMs = result.value.latencyMs ?? result.value.ttftMs;
                this.onSuccess(selected, latencyMs, result.value.ttftMs);
                return {
                    ...result.value,
                    model: selected,
                    aiProviderId: selected,
                    aiProvider: modelMeta?.name ?? UNKNOWN,
                    aiProviderUrl: modelMeta?.baseUrl ?? '',
                };
            }

            log.warn({model: modelMeta?.modelName ?? selected, provider: modelMeta?.name, ...toLogContext(result.error)}, 'attempt failed');
            this.onFailure(selected, result.error);
        }

        return null;
    }

    private async executeWithAudit<T extends ProviderBaseResponse>(tenantId: string, operation: () => Promise<T | null>): Promise<T | null> {
        const startedAt = Date.now();
        try {
            const result = await operation();
            const latencyMs = Date.now() - startedAt;
            const model = result?.model ?? UNKNOWN;
            const aiProvider = {id: result?.aiProviderId ?? UNKNOWN, name: result?.aiProvider ?? UNKNOWN};
            const isFailure = result === null;
            this.auditStore.log({tenantId, latencyMs, success: !isFailure, statusCode: isFailure ? 503 : 200, model, aiProvider});
            return result;
        } catch (error) {
            this.auditStore.log({tenantId, latencyMs: Date.now() - startedAt, success: false, statusCode: 500, model: UNKNOWN, aiProvider: {id: UNKNOWN, name: UNKNOWN}});
            throw error;
        }
    }

    private onSuccess(model: string, latencyMs: number, ttftMs: number): void {
        this.circuitBreaker.recordSuccess(model);
        this.metrics.record(model, {latencyMs, ttftMs, success: true});
        if (this.modelSelector.record) {
            this.modelSelector.record(model, { success: true, latencyMs });
        }
    }

    private onFailure(model: string, error: CallProviderError): void {
        this.metrics.record(model, {latencyMs: 0, ttftMs: 0, success: false});
        if (this.modelSelector.record) {
            this.modelSelector.record(model, { success: false, latencyMs: 0 });
        }
        if (error.kind === 'timeout') {
            this.circuitBreaker.recordSoftFailure(model);
        } else {
            this.circuitBreaker.recordHardFailure(model);
        }
    }
}

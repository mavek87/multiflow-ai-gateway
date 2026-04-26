/**
 * RoutingAIClient - adaptive multi-model router.
 */

import type { Result } from 'neverthrow';
import type {
  AIChatMessage,
  AIChatResponse,
  AIChatStreamResponse,
  AIClient,
  AIBaseResponse,
} from '@/engine/client/client.types';
import type {
  ToolContext,
  ToolDefinition,
  ToolDispatcher,
} from '@/engine/tools/tools.types';
import type { CallProviderError, CallProviderSuccess, CallProviderStreamSuccess } from '@/engine/client/http-provider-client';
import { HttpProviderClient } from '@/engine/client/http-provider-client';

import type { ModelSelector } from '@/engine/selection/selector.types';
import { MetricsStore } from '@/engine/observability/metrics';
import { CircuitBreaker } from '@/engine/resilience/circuit-breaker';
import { createLogger } from '@/utils/logger';

const log = createLogger('ROUTING');
const MAX_ATTEMPTS_CAP = 10;

type RoutedSuccess<T> = T & AIBaseResponse & { model: string };

export class RoutingAIClient implements AIClient {
  constructor(
    private readonly clients: Map<string, HttpProviderClient>,
    private readonly metrics: MetricsStore,
    private readonly circuitBreaker: CircuitBreaker,
    private readonly selector: ModelSelector,
    private readonly aiProviderIds: Map<string, { name: string; baseUrl: string; modelName: string }>
  ) {}

  async chat(systemPrompt: string, messages: AIChatMessage[], ctx?: ToolContext, tools?: ToolDefinition[], toolDispatcher?: ToolDispatcher): Promise<AIChatResponse | null> {
    log.info({ messages: messages.length, tenantId: ctx?.tenantId ?? 'unknown' }, 'new request');

    const result = await this.executeWithRetry<CallProviderSuccess>((client) => {
      const executeToolFn = toolDispatcher && ctx
        ? (name: string, args: Record<string, unknown>) => toolDispatcher(name, args, ctx)
        : undefined;
      if (tools && tools.length > 0 && executeToolFn) {
        return client.chatWithTools(systemPrompt, messages, tools, executeToolFn);
      }
      return client.chat(systemPrompt, messages);
    });

    if (result) {
      const modelMeta = this.aiProviderIds.get(result.model);
      const displayName = modelMeta?.modelName ?? result.model;

      log.info({ model: displayName, latencyMs: result.latencyMs, ttftMs: result.ttftMs }, 'model succeeded');
      return { 
        content: result.content, 
        model: displayName, 
        aiProvider: result.aiProvider, 
        aiProviderUrl: result.aiProviderUrl 
      };
    }

    return null;
  }

  async chatStream(systemPrompt: string, messages: AIChatMessage[], ctx?: ToolContext): Promise<AIChatStreamResponse | null> {
    log.info({ messages: messages.length, tenantId: ctx?.tenantId ?? 'unknown' }, 'new stream request');

    const result = await this.executeWithRetry<CallProviderStreamSuccess>((client) => client.chatStream(systemPrompt, messages));

    if (result) {
      const modelMeta = this.aiProviderIds.get(result.model);
      const displayName = modelMeta?.modelName ?? result.model;

      return { 
        body: result.body, 
        model: displayName, 
        aiProvider: result.aiProvider, 
        aiProviderUrl: result.aiProviderUrl 
      };
    }

    return null;
  }

  private async executeWithRetry<TSuccess extends { ttftMs: number }>(
    operation: (client: HttpProviderClient) => Promise<Result<TSuccess, CallProviderError>>,
  ): Promise<RoutedSuccess<TSuccess> | null> {
    const attemptedModels = new Set<string>();
    const modelIds = Array.from(this.clients.keys());
    const maxAttempts = Math.min(modelIds.length, MAX_ATTEMPTS_CAP);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const remaining = modelIds.filter((id) => !attemptedModels.has(id));
      const selected = this.selector.select(remaining, this.metrics, this.circuitBreaker);

      if (!selected) {
        log.warn('All models unavailable or exhausted');
        break;
      }

      attemptedModels.add(selected);
      const modelMeta = this.aiProviderIds.get(selected);
      log.info({ attempt: attempt + 1, model: modelMeta?.modelName ?? selected, provider: modelMeta?.name }, 'routing attempt');

      const client = this.clients.get(selected)!;
      const result = await operation(client);

      if (result.isOk()) {
        const latencyMs = (result.value as { latencyMs?: number }).latencyMs ?? result.value.ttftMs;
        this.onSuccess(selected, latencyMs, result.value.ttftMs);
        return {
          ...result.value,
          model: selected,
          aiProvider: modelMeta?.name ?? '',
          aiProviderUrl: modelMeta?.baseUrl ?? '',
        };
      }

      log.warn({ model: modelMeta?.modelName ?? selected, kind: result.error.kind }, 'attempt failed');
      this.onFailure(selected, result.error.kind);
    }

    return null;
  }

  private onSuccess(model: string, latencyMs: number, ttftMs: number): void {
    this.circuitBreaker.recordSuccess(model);
    this.metrics.record(model, { latencyMs, ttftMs, success: true });
  }

  private onFailure(model: string, kind: 'soft' | 'hard'): void {
    this.metrics.record(model, { latencyMs: 0, ttftMs: 0, success: false });
    if (kind === 'soft') {
      this.circuitBreaker.recordSoftFailure(model);
    } else {
      this.circuitBreaker.recordHardFailure(model);
    }
  }
}

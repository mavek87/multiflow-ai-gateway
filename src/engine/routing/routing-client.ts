/**
 * RoutingAIClient — adaptive multi-model router.
 */

import type { AIClient, AIChatMessage, AIChatResponse, AIChatStreamResponse, ToolContext, ToolDefinition, ToolDispatcher } from '@/engine/types';
import type { CallResult } from '@/engine/client/model-client';
import type { ModelSelector } from '@/engine/selection/types';
import { ModelEndpointClient } from '@/engine/client/model-client';
import { MetricsStore } from '@/engine/observability/metrics';
import { CircuitBreaker } from '@/engine/resilience/circuit-breaker';
import { createLogger } from '@/utils/logger';

const log = createLogger('ROUTING');
const MAX_ATTEMPTS_CAP = 10;
const UNAVAILABLE_RESPONSE = 'AI service unavailable. Try again later.';

export class RoutingAIClient implements AIClient {
  constructor(
    private readonly clients: Map<string, ModelEndpointClient>,
    private readonly metrics: MetricsStore,
    private readonly circuitBreaker: CircuitBreaker,
    private readonly selector: ModelSelector,
    private readonly aiProviderIds: Map<string, string>
  ) {}

  async chat(messages: AIChatMessage[], ctx?: ToolContext, tools?: ToolDefinition[], dispatcher?: ToolDispatcher): Promise<AIChatResponse> {
    log.info({ messages: messages.length, tenantId: ctx?.tenantId ?? 'unknown' }, 'new request');

    const result = await this.executeWithRetry(async (selectedModel, client) => {
      const boundDispatcher = dispatcher && ctx ? (name: string, args: Record<string, unknown>) => dispatcher(name, args, ctx) : undefined;
      
      if (tools && tools.length > 0 && boundDispatcher) {
        return await client.callWithTools(messages, tools, boundDispatcher);
      }
      return await client.call(messages);
    });

    if (result) {
      log.info({ model: result.model, latencyMs: result.latencyMs, ttftMs: result.ttftMs }, 'model succeeded');
      return { content: result.content, model: result.model, aiProvider: result.aiProvider };
    }

    return { content: UNAVAILABLE_RESPONSE, model: 'unknown', aiProvider: '' };
  }

  async openStream(messages: AIChatMessage[], ctx?: ToolContext, tools?: ToolDefinition[], dispatcher?: ToolDispatcher): Promise<AIChatStreamResponse | null> {
    log.info({ messages: messages.length, tenantId: ctx?.tenantId ?? 'unknown' }, 'new stream request');
    
    const result = await this.executeWithRetry(async (selectedModel, client) => {
       return await client.openStream(messages);
    }, true);

    if (result) {
        return { body: result.body, model: result.model, aiProvider: result.aiProvider };
    }

    return null;
  }

  async *chatStream(messages: AIChatMessage[], ctx?: ToolContext, tools?: ToolDefinition[], dispatcher?: ToolDispatcher): AsyncGenerator<string> {
    const { content } = await this.chat(messages, ctx, tools, dispatcher);
    yield content;
  }

  private async executeWithRetry(
    operation: (modelId: string, client: ModelEndpointClient) => Promise<any>,
    isStream = false
  ): Promise<any> {
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
      log.info({ attempt: attempt + 1, model: selected }, isStream ? 'stream routing attempt' : 'routing attempt');

      const client = this.clients.get(selected)!;
      const result = await operation(selected, client);

      if (result.ok) {
        this.onSuccess(selected, result.latencyMs || result.ttftMs, result.ttftMs);
        return { 
            ok: true, 
            ...result, 
            model: selected, 
            aiProvider: this.aiProviderIds.get(selected) ?? '' 
        };
      }

      log.warn({ model: selected, kind: result.kind }, isStream ? 'stream attempt failed' : 'model failed');
      this.onFailure(selected, result.kind);
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

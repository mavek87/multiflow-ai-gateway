import { RoutingAIClient } from './routing-client';
import { AuditedAIClient } from '@/audit/audit.ai-client.decorator';
import type { ModelConfig, AIClient } from '@/engine/client/client.types';
import { MetricsStore } from '@/engine/observability/metrics';
import { CircuitBreaker } from '@/engine/resilience/circuit-breaker';
import type { ModelSelector } from '@/engine/selection/selector.types';
import { HttpProviderClient } from '@/engine/client/http-provider-client';

export class RoutingAIClientFactory {
    constructor(
        private readonly metrics: MetricsStore,
        private readonly circuitBreaker: CircuitBreaker,
        private readonly modelSelector: ModelSelector,
    ) {}

    public create(modelConfigs: ModelConfig[]): AIClient {
        const sortedModelConfigs = [...modelConfigs].sort((confA, confB) => (confA.priority ?? 0) - (confB.priority ?? 0));

        const clients = new Map<string, HttpProviderClient>();
        const aiProviderIds = new Map<string, { name: string; baseUrl: string; modelName: string }>();

        for (const modelConfig of sortedModelConfigs) {
            const clientKey = modelConfig.aiProviderModelId!;
            
            clients.set(clientKey, new HttpProviderClient(modelConfig, 30000, 120000, false));
            aiProviderIds.set(clientKey, {
                name: modelConfig.aiProviderName ?? modelConfig.aiProviderId ?? '',
                baseUrl: modelConfig.aiProviderBaseUrl ?? '',
                modelName: modelConfig.model,
            });
        }

        return new AuditedAIClient(new RoutingAIClient(
            clients,
            this.metrics,
            this.circuitBreaker,
            this.modelSelector,
            aiProviderIds,
        ));
    }
}

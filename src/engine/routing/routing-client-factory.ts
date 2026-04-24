import { RoutingAIClient } from './routing-client';
import { AuditedAIClient } from '@/audit/audit.ai-client.decorator';
import type { ModelConfig, AIClient } from '@/engine/engine.types';
import { MetricsStore } from '@/engine/observability/metrics';
import { CircuitBreaker } from '@/engine/resilience/circuit-breaker';
import { UCB1Selector } from '@/engine/selection/selector';
import { HttpProviderClient } from '@/engine/client/http-provider-client';

export class RoutingAIClientFactory {
    private readonly metrics = new MetricsStore();
    private readonly circuitBreaker = new CircuitBreaker();
    private readonly selector = new UCB1Selector();

    public create(modelConfigs: ModelConfig[]): AIClient {
        const sortedModelConfigs = [...modelConfigs].sort((confA, confB) => (confA.priority ?? 0) - (confB.priority ?? 0));

        const clients = new Map<string, HttpProviderClient>();
        const aiProviderIds = new Map<string, { name: string; baseUrl: string }>();

        for (const modelConfig of sortedModelConfigs) {
            clients.set(modelConfig.model, new HttpProviderClient(modelConfig, 10000, 60000, false));
            aiProviderIds.set(modelConfig.model, {
                name: modelConfig.aiProviderName ?? modelConfig.aiProviderId ?? '',
                baseUrl: modelConfig.aiProviderBaseUrl ?? '',
            });
        }

        return new AuditedAIClient(new RoutingAIClient(
            clients,
            this.metrics,
            this.circuitBreaker,
            this.selector,
            aiProviderIds,
        ));
    }
}

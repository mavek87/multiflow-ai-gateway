import { RoutingAIClient } from './routing-client';
import { AuditedAIClient } from '@/audit/audit.decorator';
import type { ModelConfig, AIClient } from '../types';
import { MetricsStore } from '../observability/metrics';
import { CircuitBreaker } from '../resilience/circuit-breaker';
import { UCB1Selector } from '../selection/selector';
import { HttpProviderClient } from '../client/http-provider-client';

export class RoutingAIClientFactory {
    private readonly metrics = new MetricsStore();
    private readonly circuitBreaker = new CircuitBreaker();
    private readonly selector = new UCB1Selector();

    public create(modelConfigs: ModelConfig[], systemPrompt: string): AIClient {
        const sortedModelConfigs = [...modelConfigs].sort((confA, confB) => (confA.priority ?? 0) - (confB.priority ?? 0));
        
        const clients = new Map<string, HttpProviderClient>();
        const aiProviderIds = new Map<string, { name: string; baseUrl: string }>();

        for (const modelConfig of sortedModelConfigs) {
            clients.set(modelConfig.model, new HttpProviderClient(modelConfig, systemPrompt, 10000, 60000, false));
            aiProviderIds.set(modelConfig.model, {
                name: modelConfig.aiProviderName ?? modelConfig.aiProviderId ?? '',
                baseUrl: modelConfig.aiProviderBaseUrl ?? '',
            });
        }

        const client = new RoutingAIClient(
            clients,
            this.metrics,
            this.circuitBreaker,
            this.selector,
            aiProviderIds
        );

        return new AuditedAIClient(client);
    }
}

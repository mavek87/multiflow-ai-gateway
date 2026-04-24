import { RoutingAIClient } from './routing-client';
import { AuditedAIClient } from '@/audit/audit.ai-client.decorator';
import type { ModelConfig, AIClient } from '@/engine/client/client.types';
import { MetricsStore } from '@/engine/observability/metrics';
import { CircuitBreaker } from '@/engine/resilience/circuit-breaker';
import { UCB1TunedSelector } from '@/engine/selection/algorithms/ucb1-tuned';
import { SWUcb1TunedSelector } from '@/engine/selection/algorithms/sw-ucb1-tuned';
import { ThompsonSelector } from '@/engine/selection/algorithms/thompson';
import type { ModelSelector, SelectorType } from '@/engine/selection/selector.types';
import { HttpProviderClient } from '@/engine/client/http-provider-client';

function createSelector(type: SelectorType): ModelSelector {
    switch (type) {
        case 'thompson': return new ThompsonSelector();
        case 'ucb1-tuned': return new UCB1TunedSelector();
        case 'sw-ucb1-tuned': return new SWUcb1TunedSelector();
    }
}

export class RoutingAIClientFactory {
    private readonly metrics = new MetricsStore();
    private readonly circuitBreaker = new CircuitBreaker();
    private readonly selector: ModelSelector;

    constructor(selectorType: SelectorType = 'ucb1-tuned') {
        this.selector = createSelector(selectorType);
    }

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

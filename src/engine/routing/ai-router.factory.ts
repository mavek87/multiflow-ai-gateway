import {AIRouter} from './ai-router';
import type {ModelConfig} from '@/engine/client/client.types';
import {MetricsStore} from '@/engine/observability/metrics';
import {CircuitBreaker} from '@/engine/resilience/circuit-breaker';
import type {ModelSelector} from '@/engine/selection/selector.types';
import {HttpProviderClient} from '@/engine/client/http-provider-client';

export class AIRouterFactory {
    constructor(
        private readonly metrics: MetricsStore,
        private readonly circuitBreaker: CircuitBreaker,
        private readonly modelSelector: ModelSelector,
    ) {
    }

    public create(modelConfigs: ModelConfig[]): AIRouter {
        const sortedModelConfigs = [...modelConfigs].sort((confA, confB) => (confA.priority ?? 0) - (confB.priority ?? 0));

        const aiProviderClients = new Map<string, HttpProviderClient>();
        const aiProviderIds = new Map<string, { name: string; baseUrl: string; modelName: string }>();

        for (const modelConfig of sortedModelConfigs) {
            const clientKey = modelConfig.aiProviderModelId!;

            aiProviderClients.set(clientKey, new HttpProviderClient(modelConfig, 30000, 120000, false));
            aiProviderIds.set(clientKey, {
                name: modelConfig.aiProviderName ?? modelConfig.aiProviderId ?? '',
                baseUrl: modelConfig.aiProviderBaseUrl ?? '',
                modelName: modelConfig.model,
            });
        }

        return new AIRouter(
            aiProviderClients,
            this.metrics,
            this.circuitBreaker,
            this.modelSelector,
            aiProviderIds,
        );
    }
}

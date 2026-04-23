import type {TenantStore} from '@/tenant/tenant-store';
import type {ModelResolutionOptions, ModelResolutionResult} from './types';

export class ModelConfigResolver {
    constructor(private readonly tenantStore: TenantStore) {}

    public resolve({tenantId, requestedModel, forceAiProviderId}: ModelResolutionOptions): ModelResolutionResult {
        const modelConfigs = this.tenantStore.getDecryptedModelConfigs(tenantId, forceAiProviderId);
        if (modelConfigs.length === 0) return {ok: false, error: 'no_providers'};

        const matchingConfigs = requestedModel
            ? modelConfigs.filter((modelConfig) => modelConfig.modelName === requestedModel)
            : modelConfigs;

        if (requestedModel && matchingConfigs.length === 0) {
            return {ok: false, error: 'model_not_found', model: requestedModel};
        }

        return {
            ok: true,
            configs: matchingConfigs.map((modelConfig) => ({
                url: `${modelConfig.baseUrl}/chat/completions`,
                model: modelConfig.modelName,
                apiKey: modelConfig.apiKeyPlain ?? undefined,
                priority: modelConfig.priority,
                aiProviderId: modelConfig.aiProviderId,
                aiProviderModelId: modelConfig.aiProviderModelId,
            })),
        };
    }
}

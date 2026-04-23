import { ok, err, type Result } from 'neverthrow';
import type {TenantStore} from '@/tenant/tenant.store';
import type {TenantModelConfig, TenantModelConfigError} from './tenant.types';
import type { ModelConfig } from '@/engine/engine.types';

export class TenantModelConfigResolver {
    constructor(private readonly tenantStore: TenantStore) {}

    public resolve({tenantId, requestedModel, forceAiProviderId}: TenantModelConfig): Result<ModelConfig[], TenantModelConfigError> {
        const modelConfigs = this.tenantStore.getDecryptedModelConfigs(tenantId, forceAiProviderId);
        if (modelConfigs.length === 0) return err({ code: 'no_providers' });

        const matchingConfigs = requestedModel
            ? modelConfigs.filter((modelConfig) => modelConfig.modelName === requestedModel)
            : modelConfigs;

        if (requestedModel && matchingConfigs.length === 0) {
            return err({ code: 'model_not_found', model: requestedModel });
        }

        return ok(matchingConfigs.map((modelConfig) => ({
            url: `${modelConfig.baseUrl}/chat/completions`,
            model: modelConfig.modelName,
            apiKey: modelConfig.apiKeyPlain ?? undefined,
            priority: modelConfig.priority,
            aiProviderId: modelConfig.aiProviderId,
            aiProviderName: modelConfig.aiProviderName,
            aiProviderBaseUrl: modelConfig.baseUrl,
            aiProviderModelId: modelConfig.aiProviderModelId,
        })));
    }
}

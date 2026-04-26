import {err, ok, type Result} from 'neverthrow';
import type {TenantStore} from '@/tenant/tenant.store';
import type {TenantModelConfigKey, TenantModelConfigError} from './tenant.types';
import type {ModelConfig} from '@/engine/client/client.types';
import {buildProviderUrl} from '@/provider/provider.utils';
import type {CryptoService} from '@/crypto/crypto';

export class TenantModelConfigResolver {
    constructor(
        private readonly tenantStore: TenantStore,
        private readonly cryptoService: CryptoService
    ) {
    }

    public resolve({tenantId, requestedModel, requestedProviderName, forceAiProviderId}: TenantModelConfigKey): Result<ModelConfig[], TenantModelConfigError> {
        const modelConfigs = this.tenantStore.getTenantModelConfigs(tenantId, forceAiProviderId);
        if (modelConfigs.length === 0) return err({code: 'no_providers'});

        let matchingConfigs = requestedModel
            ? modelConfigs.filter((modelConfig) => modelConfig.modelName === requestedModel)
            : modelConfigs;

        if (requestedProviderName) {
            matchingConfigs = matchingConfigs.filter(
                (modelConfig) => modelConfig.aiProviderName.toLowerCase() === requestedProviderName.toLowerCase()
            );
        }

        if ((requestedModel || requestedProviderName) && matchingConfigs.length === 0) {
            return err({code: 'model_not_found', model: requestedModel ?? requestedProviderName ?? ''});
        }

        const arrayOfModelConfig: ModelConfig[] = matchingConfigs.map((modelConfig) => ({
            url: buildProviderUrl(modelConfig.baseUrl, modelConfig.aiProviderType),
            model: modelConfig.modelName,
            apiKey: modelConfig.aiProviderApiKeyEncrypted
                ? this.cryptoService.decrypt(modelConfig.aiProviderApiKeyEncrypted)
                : undefined,
            priority: modelConfig.priority,
            aiProviderId: modelConfig.aiProviderId,
            aiProviderName: modelConfig.aiProviderName,
            aiProviderBaseUrl: modelConfig.baseUrl,
            aiProviderModelId: modelConfig.aiProviderModelId,
        }));

        return ok(arrayOfModelConfig);
    }
}

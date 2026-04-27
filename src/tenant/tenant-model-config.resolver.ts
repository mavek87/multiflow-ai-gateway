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

    public resolve({tenantId, requestedModel, requestedProviderName, requestedModels, forceAiProviderId}: TenantModelConfigKey): Result<ModelConfig[], TenantModelConfigError> {
        const modelConfigs = this.tenantStore.getTenantModelConfigs(tenantId, forceAiProviderId);
        if (modelConfigs.length === 0) return err({code: 'no_providers'});

        let matchingConfigs;

        if (requestedModels && requestedModels.length > 0) {
            const seen = new Set<string>();
            matchingConfigs = requestedModels.flatMap(({model, providerName}) => {
                const results = modelConfigs.filter((mc) => {
                    const modelMatch = model ? mc.modelName === model : true;
                    const providerMatch = providerName ? mc.aiProviderName.toLowerCase() === providerName.toLowerCase() : true;
                    return modelMatch && providerMatch;
                });
                return results.filter((mc) => {
                    if (seen.has(mc.id)) return false;
                    seen.add(mc.id);
                    return true;
                });
            });

            if (matchingConfigs.length === 0) {
                return err({code: 'model_not_found', model: requestedModels.map(({providerName, model}) => [providerName, model].filter(Boolean).join('/')).join(', ')});
            }
        } else {
            matchingConfigs = requestedModel
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

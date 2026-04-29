import {err, ok, type Result} from 'neverthrow';
import type {TenantStore} from '@/tenant/tenant.store';
import type {TenantModelConfigKey, TenantModelConfigError} from './tenant.types';
import type {ModelConfig} from '@/engine/client/client.types';
import {buildProviderUrl} from '@/provider/provider.utils';
import type {CryptoService} from '@/crypto/crypto';

export class TenantModelPoolResolver {
    constructor(
        private readonly tenantStore: TenantStore,
        private readonly cryptoService: CryptoService
    ) {
    }

    public resolve({
                       tenantId,
                       model,
                       models,
                       forceAiProviderId
                   }: TenantModelConfigKey): Result<ModelConfig[], TenantModelConfigError> {
        if (model && models) {
            return err({code: 'model_ambiguous_selection'});
        }

        const modelConfigs = this.tenantStore.getTenantModelConfigs(tenantId, forceAiProviderId);
        if (modelConfigs.length === 0) return err({code: 'no_usable_model'});

        let matchingConfigs;

        const effectiveModel = model === 'multiflow-ai-gateway-auto-model' ? undefined : model;
        const requestedModelsAndProviders = models
            ? models.map(this.parseModelString)
            : effectiveModel
                ? [this.parseModelString(effectiveModel)]
                : undefined;

        if (requestedModelsAndProviders && requestedModelsAndProviders.length > 0) {
            const seen = new Set<string>();
            matchingConfigs = requestedModelsAndProviders.flatMap(({model: m, providerName}) => {
                const results = modelConfigs.filter((mc) => {
                    const modelMatch = m ? mc.modelName === m : true;
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
                return err({
                    code: 'model_not_found',
                    model: requestedModelsAndProviders.map(({providerName, model: m}) => [providerName, m].filter(Boolean).join('/')).join(', ')
                });
            }
        } else {
            matchingConfigs = modelConfigs;
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

    private parseModelString(entry: string): { providerName?: string; model: string } {
        const slashIdx = entry.indexOf('/');
        if (slashIdx === -1) {
            return {model: entry};
        }
        return {
            providerName: entry.slice(0, slashIdx),
            model: entry.slice(slashIdx + 1)
        };
    }
}

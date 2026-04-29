import {err, ok, type Result} from 'neverthrow';
import type {TenantStore} from '@/tenant/tenant.store';
import {
    type TenantModelConfigKey,
    type TenantModelConfigError,
    type TenantModelConfig,
    MULTIFLOW_AUTO_MODEL
} from './tenant.types';
import type {ModelConfig} from '@/engine/client/client.types';
import {buildProviderUrl} from '@/provider/provider.utils';
import type {CryptoService} from '@/crypto/crypto';

type RequestedModel = { providerName?: string; model: string };

export class TenantModelPoolResolver {
    constructor(
        private readonly tenantStore: TenantStore,
        private readonly cryptoService: CryptoService
    ) {
    }

    public resolve(key: TenantModelConfigKey): Result<ModelConfig[], TenantModelConfigError> {
        const {tenantId, model, models, forceAiProviderId} = key;

        if (model && models) {
            return err({code: 'model_ambiguous_selection'});
        }

        const allModels = this.tenantStore.getTenantModelConfigs(tenantId, forceAiProviderId);
        if (allModels.length === 0) {
            return err({code: 'no_usable_model'});
        }

        const requestedModels = this.getRequestedModels(model, models);
        const matchingModels = this.filterMatchingModels(allModels, requestedModels);

        if (requestedModels && matchingModels.length === 0) {
            return err({
                code: 'model_not_found',
                model: this.formatMissingModels(requestedModels)
            });
        }

        return ok(this.mapToModelConfigs(matchingModels));
    }

    private getRequestedModels(model?: string, models?: string[]): RequestedModel[] | undefined {
        if (models && models.length > 0) {
            return models.map(m => this.parseModelString(m));
        }

        if (model && model !== MULTIFLOW_AUTO_MODEL) {
            return [this.parseModelString(model)];
        }

        return undefined;
    }

    private filterMatchingModels(allModels: TenantModelConfig[], requestedModels?: RequestedModel[]): TenantModelConfig[] {
        if (!requestedModels || requestedModels.length === 0) {
            return allModels;
        }

        const seen = new Set<string>();
        return requestedModels.flatMap(({model: m, providerName}) => {
            return allModels
                .filter((mc) => {
                    const modelMatch = m ? mc.modelName === m : true;
                    const providerMatch = providerName
                        ? mc.aiProviderName.toLowerCase() === providerName.toLowerCase()
                        : true;
                    return modelMatch && providerMatch;
                })
                .filter((mc) => {
                    if (seen.has(mc.id)) return false;
                    seen.add(mc.id);
                    return true;
                });
        });
    }

    private mapToModelConfigs(configs: TenantModelConfig[]): ModelConfig[] {
        return configs.map((modelConfig) => ({
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
    }

    private formatMissingModels(requested: RequestedModel[]): string {
        return requested
            .map(({providerName, model: m}) => [providerName, m].filter(Boolean).join('/'))
            .join(', ');
    }

    private parseModelString(entry: string): RequestedModel {
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

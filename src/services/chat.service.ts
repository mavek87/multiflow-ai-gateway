import type {TenantStore} from '@/tenant/tenant-store';
import type {Tenant} from '@/tenant/types';
import type {ModelConfig, AIChatMessage} from '@/engine/types';
import type {ModelResolutionOptions, ModelResolutionResult} from '@/engine/selection/types';
import {RoutingAIClientFactory} from '@/engine/routing/routing-client-factory';
import {createLogger} from '@/utils/logger';
import {randomUUID} from 'node:crypto';

const log = createLogger('CHAT_SVC');
const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant.';

export interface ChatServiceRequest {
    model?: string;
    messages: AIChatMessage[];
    system?: string;
    stream?: boolean;
}

export class ChatService {
    constructor(
        private readonly tenantStore: TenantStore,
        private readonly aiClientFactory: RoutingAIClientFactory
    ) {}

    public resolveModelConfigs({tenantId, requestedModel, forceAiProviderId}: ModelResolutionOptions): ModelResolutionResult {
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

    public async handleChatRequest(tenant: Tenant, chatRequest: ChatServiceRequest, modelConfigs: ModelConfig[]) {
        const client = this.aiClientFactory.create(modelConfigs, chatRequest.system ?? DEFAULT_SYSTEM_PROMPT);
        const isStream = chatRequest.stream === true;

        log.info({tenantId: tenant.id, stream: isStream}, 'chat request starting');

        if (isStream) {
            if (!client.openStream) {
                throw new Error('Streaming not supported by this client');
            }
            const result = await client.openStream(chatRequest.messages, {tenantId: tenant.id, tenantName: tenant.name});
            
            if (!result) {
                throw new Error('AI service unavailable');
            }

            return {
                isStream: true as const,
                streamBody: result.body,
                model: result.model,
                aiProvider: result.aiProvider || result.model
            };
        } else {
            const result = await client.chat(chatRequest.messages, {tenantId: tenant.id, tenantName: tenant.name});
            
            return {
                isStream: false as const,
                data: this.buildChatResponsePayload(result.model, result.content),
                model: result.model,
                aiProvider: result.aiProvider || result.model
            };
        }
    }

    private buildChatResponsePayload(model: string, content: string) {
        return {
            id: `chatcmpl-${randomUUID()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [{index: 0, message: {role: 'assistant', content}, finish_reason: 'stop'}],
        };
    }
}

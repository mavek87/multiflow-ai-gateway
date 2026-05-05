import {ok, err, type Result} from 'neverthrow';
import type {Tenant} from '@/tenant/tenant.types';
import type {ModelConfig, ProviderChatOptions} from '@/engine/client/http-provider-client.types';
import type {ChatHandlerResult} from '@/chat/chat.types';
import type {ChatServiceError, ChatServiceRequest} from '@/chat/chat.types';
import {AIRouterFactory} from '@/engine/routing/ai-router.factory';
import {createLogger} from '@/utils/logger';

const log = createLogger('CHAT_SVC');

export class ChatService {
    constructor(private readonly aiRouterFactory: AIRouterFactory) {}

    public async handleChatRequest(tenant: Tenant, chatRequest: ChatServiceRequest, arrayOfModelConfigs: ModelConfig[]): Promise<Result<ChatHandlerResult, ChatServiceError>> {
        const aiRouter = this.aiRouterFactory.create(arrayOfModelConfigs);
        const isStream = chatRequest.stream === true;
        const systemPrompt = this.resolveSystemPrompt(chatRequest);
        const chatOptions = this.extractProviderChatOptions(chatRequest);

        log.info({tenantId: tenant.id, stream: isStream}, 'chat request starting');

        const tenantCtx = {tenantId: tenant.id, tenantName: tenant.name};
        const filteredMessages = chatRequest.messages.filter(m => m.role !== 'system');

        if (isStream) {
            const result = await aiRouter.chatStream(systemPrompt, filteredMessages, tenantCtx, chatOptions);
            if (!result) {
                return err({code: 'ai_unavailable'});
            }

            return ok({
                isStream: true as const,
                payload: result.body,
                model: result.model,
                aiProvider: result.aiProvider || result.model,
                aiProviderUrl: result.aiProviderUrl,
            });
        } else {
            const result = await aiRouter.chat(systemPrompt, filteredMessages, tenantCtx, chatOptions);
            if (!result) {
                return err({code: 'ai_unavailable'});
            }

            return ok({
                isStream: false as const,
                payload: { ...result.rawBody, model: result.model },
                model: result.model,
                aiProvider: result.aiProvider || result.model,
                aiProviderUrl: result.aiProviderUrl,
            });
        }
    }

    private resolveSystemPrompt(chatRequest: ChatServiceRequest): string {
        if (chatRequest.system) return chatRequest.system;
        const systemMessage = chatRequest.messages.find(m => m.role === 'system');
        const content = systemMessage?.content;
        return typeof content === 'string' ? content : '';
    }

    private extractProviderChatOptions(chatRequest: ChatServiceRequest): ProviderChatOptions | undefined {
        const {model: _model, models: _models, system: _system, stream: _stream, messages: _messages, ...providerOpts} = chatRequest;
        const opts = Object.fromEntries(Object.entries(providerOpts).filter(([_, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0)));
        return Object.keys(opts).length > 0 ? opts as ProviderChatOptions : undefined;
    }

}

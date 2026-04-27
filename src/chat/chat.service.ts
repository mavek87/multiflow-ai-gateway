import {ok, err, type Result} from 'neverthrow';
import type {Tenant} from '@/tenant/tenant.types';
import type {ModelConfig} from '@/engine/client/client.types';
import type {ChatCompletion, ChatHandlerResult} from '@/chat/chat.types';
import type {ChatServiceError, ChatServiceRequest} from '@/chat/chat.types';
import {AIRouterFactory} from '@/engine/routing/ai-router.factory';
import {createLogger} from '@/utils/logger';
import {randomUUID} from 'node:crypto';

const log = createLogger('CHAT_SVC');
const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant.';

export class ChatService {
    constructor(private readonly aiRouterFactory: AIRouterFactory) {}

    public async handleChatRequest(tenant: Tenant, chatRequest: ChatServiceRequest, arrayOfModelConfigs: ModelConfig[]): Promise<Result<ChatHandlerResult, ChatServiceError>> {
        const aiRouter = this.aiRouterFactory.create(arrayOfModelConfigs);
        const systemPrompt = chatRequest.system ?? DEFAULT_SYSTEM_PROMPT;
        const isStream = chatRequest.stream === true;

        log.info({tenantId: tenant.id, stream: isStream}, 'chat request starting');

        const tenantCtx = {tenantId: tenant.id, tenantName: tenant.name};

        if (isStream) {
            const result = await aiRouter.chatStream(systemPrompt, chatRequest.messages, tenantCtx);
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
            const result = await aiRouter.chat(systemPrompt, chatRequest.messages, tenantCtx);
            if (!result) {
                return err({code: 'ai_unavailable'});
            }

            return ok({
                isStream: false as const,
                payload: this.buildChatResponsePayload(result.model, result.content),
                model: result.model,
                aiProvider: result.aiProvider || result.model,
                aiProviderUrl: result.aiProviderUrl,
            });
        }
    }

    private buildChatResponsePayload(model: string, content: string): ChatCompletion {
        return {
            id: `chatcmpl-${randomUUID()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [{index: 0, message: {role: 'assistant', content}, finish_reason: 'stop'}],
        };
    }
}

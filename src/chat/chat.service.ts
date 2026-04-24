import {ok, err, type Result} from 'neverthrow';
import type {Tenant} from '@/tenant/tenant.types';
import type {ModelConfig, AIChatMessage} from '@/engine/client/client.types';
import type {ChatCompletion, ChatHandlerResult} from './chat.schema';
import {RoutingAIClientFactory} from '@/engine/routing/routing-client-factory';
import {createLogger} from '@/utils/logger';
import {randomUUID} from 'node:crypto';

const log = createLogger('CHAT_SVC');
const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant.';

export type ChatServiceError =
    | {code: 'ai_unavailable'}
    | {code: 'stream_not_supported'};

export interface ChatServiceRequest {
    model?: string;
    messages: AIChatMessage[];
    system?: string;
    stream?: boolean;
}

export class ChatService {
    constructor(private readonly aiClientFactory: RoutingAIClientFactory) {}

    public async handleChatRequest(tenant: Tenant, chatRequest: ChatServiceRequest, modelConfigs: ModelConfig[]): Promise<Result<ChatHandlerResult, ChatServiceError>> {
        const client = this.aiClientFactory.create(modelConfigs);
        const systemPrompt = chatRequest.system ?? DEFAULT_SYSTEM_PROMPT;
        const isStream = chatRequest.stream === true;

        log.info({tenantId: tenant.id, stream: isStream}, 'chat request starting');

        if (isStream) {
            const result = await client.chatStream(systemPrompt, chatRequest.messages, {tenantId: tenant.id, tenantName: tenant.name});

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
            const result = await client.chat(systemPrompt, chatRequest.messages, {tenantId: tenant.id, tenantName: tenant.name});

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

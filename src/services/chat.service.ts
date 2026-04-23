import type {Tenant} from '@/tenant/types';
import type {ModelConfig, AIChatMessage} from '@/engine/types';
import type {ChatCompletion, ChatHandlerResult} from '@/schemas/openai.schema';
import {RoutingAIClientFactory} from '@/engine/routing/routing-client-factory';
import {createLogger} from '@/utils/logger';
import {randomUUID} from 'node:crypto';

const log = createLogger('CHAT_SVC');
const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant.';

export class AiUnavailableError extends Error {
    constructor() {
        super('AI service unavailable');
        this.name = 'AiUnavailableError';
    }
}

export interface ChatServiceRequest {
    model?: string;
    messages: AIChatMessage[];
    system?: string;
    stream?: boolean;
}

export class ChatService {
    constructor(private readonly aiClientFactory: RoutingAIClientFactory) {}

    public async handleChatRequest(tenant: Tenant, chatRequest: ChatServiceRequest, modelConfigs: ModelConfig[]): Promise<ChatHandlerResult> {
        const client = this.aiClientFactory.create(modelConfigs, chatRequest.system ?? DEFAULT_SYSTEM_PROMPT);
        const isStream = chatRequest.stream === true;

        log.info({tenantId: tenant.id, stream: isStream}, 'chat request starting');

        if (isStream) {
            if (!client.callStream) {
                throw new Error('Streaming not supported by this client');
            }
            const result = await client.callStream(chatRequest.messages, {tenantId: tenant.id, tenantName: tenant.name});
            
            if (!result) {
                throw new AiUnavailableError();
            }

            return {
                isStream: true as const,
                payload: result.body,
                model: result.model,
                aiProvider: result.aiProvider || result.model,
                aiProviderUrl: result.aiProviderUrl,
            };
        } else {
            const result = await client.chat(chatRequest.messages, {tenantId: tenant.id, tenantName: tenant.name});

            return {
                isStream: false as const,
                payload: this.buildChatResponsePayload(result.model, result.content),
                model: result.model,
                aiProvider: result.aiProvider || result.model,
                aiProviderUrl: result.aiProviderUrl,
            };
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

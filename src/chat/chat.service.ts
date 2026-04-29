import {ok, err, type Result} from 'neverthrow';
import type {Tenant} from '@/tenant/tenant.types';
import type {ModelConfig, ChatOptions} from '@/engine/client/client.types';
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
        const opts = this.extractChatOptions(chatRequest);

        log.info({tenantId: tenant.id, stream: isStream}, 'chat request starting');

        const tenantCtx = {tenantId: tenant.id, tenantName: tenant.name};
        const filteredMessages = chatRequest.messages.filter(m => m.role !== 'system');

        if (isStream) {
            const result = await aiRouter.chatStream(systemPrompt, filteredMessages, tenantCtx, opts);
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
            const result = await aiRouter.chat(systemPrompt, filteredMessages, tenantCtx, opts);
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

    private extractChatOptions(chatRequest: ChatServiceRequest): ChatOptions | undefined {
        const {
            tools, tool_choice, parallel_tool_calls, temperature, top_p,
            max_tokens, max_completion_tokens, presence_penalty, frequency_penalty,
            seed, stop, response_format, stream_options, user
        } = chatRequest;

        const rawOpts = {
            tools, tool_choice, parallel_tool_calls, temperature, top_p,
            max_tokens, max_completion_tokens, presence_penalty, frequency_penalty,
            seed, stop, response_format, stream_options, user
        };

        const opts = Object.fromEntries(Object.entries(rawOpts).filter(([_, v]) => v !== undefined));
        
        return Object.keys(opts).length > 0 ? opts as ChatOptions : undefined;
    }

}

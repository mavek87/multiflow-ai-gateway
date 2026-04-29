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

        if (isStream) {
            const result = await aiRouter.chatStream(systemPrompt, chatRequest.messages, tenantCtx, opts);
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
            const result = await aiRouter.chat(systemPrompt, chatRequest.messages, tenantCtx, undefined, undefined, opts);
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
        return systemMessage?.content ?? '';
    }

    private extractChatOptions(chatRequest: ChatServiceRequest): ChatOptions | undefined {
        const opts: ChatOptions = {};
        let hasOpts = false;

        const assign = <K extends keyof ChatOptions>(key: K, value: ChatOptions[K]) => {
            if (value !== undefined) { opts[key] = value; hasOpts = true; }
        };

        assign('tools', chatRequest.tools as ChatOptions['tools']);
        assign('tool_choice', chatRequest.tool_choice);
        assign('parallel_tool_calls', chatRequest.parallel_tool_calls);
        assign('temperature', chatRequest.temperature);
        assign('top_p', chatRequest.top_p);
        assign('max_tokens', chatRequest.max_tokens);
        assign('max_completion_tokens', chatRequest.max_completion_tokens);
        assign('presence_penalty', chatRequest.presence_penalty);
        assign('frequency_penalty', chatRequest.frequency_penalty);
        assign('seed', chatRequest.seed);
        assign('stop', chatRequest.stop);
        assign('response_format', chatRequest.response_format);
        assign('stream_options', chatRequest.stream_options);
        assign('user', chatRequest.user);

        return hasOpts ? opts : undefined;
    }

}

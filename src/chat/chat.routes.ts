import {Elysia} from 'elysia';
import type {TenantStore} from '@/tenant/tenant.store';
import {MULTIFLOW_AUTO_MODEL} from '@/tenant/tenant.types';
import {badRequestResponse, internalErrorResponse, tooManyRequestsResponse, unprocessableResponse} from '@/utils/http';
import {ChatService} from '@/chat/chat.service';
import {AIRouterFactory} from '@/engine/routing/ai-router.factory';
import {createModelSelector} from '@/engine/selection/model-selector.factory';
import {TenantModelPoolResolver} from '@/tenant/tenant-model-pool.resolver';
import {tenantAuthPlugin} from '@/auth/auth.middleware';
import {ChatRequestSchema} from '@/chat/chat.schema';
import {CHAT_COMPLETIONS_PATH} from '@/chat/chat.constants';
import {config} from '@/config/config';
import type {CryptoService} from '@/crypto/crypto';
import {MetricsStore} from '@/engine/observability/metrics';
import {CircuitBreaker} from '@/engine/resilience/circuit-breaker';
import type {AuditStore} from '@/db/audit/audit.store';

export function chatRoutePlugin(
    tenantStore: TenantStore,
    auditStore: AuditStore,
    metricsStore: MetricsStore,
    cryptoService: CryptoService,
    circuitBreaker: CircuitBreaker
) {
    const recentRecords = auditStore.getRecentRecords(Date.now() - config.metricsWarmUpWindowMs);
    metricsStore.warmUp(recentRecords);

    const aiRouterFactory = new AIRouterFactory(
        metricsStore,
        circuitBreaker,
        createModelSelector(config.selectorType),
        auditStore,
    );
    const chatService = new ChatService(aiRouterFactory);
    const tenantModelPoolResolver = new TenantModelPoolResolver(tenantStore, cryptoService);

    return new Elysia()
        .use(tenantAuthPlugin(tenantStore))
        .guard({detail: {security: [{GatewayApiKey: []}]}}) // This guard applies the security requirement for Swagger UI / OpenAPI docs
        .post(CHAT_COMPLETIONS_PATH, async ({body: chatRequest, tenant}) => {

            if (chatRequest.model && chatRequest.models) {
                return badRequestResponse("Cannot use both 'model' and 'models' fields simultaneously");
            }

            const modelConfigsResult = tenantModelPoolResolver.resolve({
                tenantId: tenant!.id,
                models: chatRequest.model ? [chatRequest.model] : (chatRequest.models ?? []),
                forceAiProviderId: tenant!.forceAiProviderId
            });

            if (modelConfigsResult.isErr()) {
                switch (modelConfigsResult.error.code) {
                    case 'no_usable_model':
                        return unprocessableResponse('No usable models configured for this tenant');
                    case 'model_not_found':
                        return badRequestResponse(`Model '${modelConfigsResult.error.model}' is not available for this tenant`);
                }
            }

            const arrayOfModelConfig = modelConfigsResult.value;
            const chatResult = await chatService.handleChatRequest(tenant!, chatRequest, arrayOfModelConfig);
            if (chatResult.isErr()) {
                switch (chatResult.error.code) {
                    case 'ai_unavailable':
                        if (chatRequest.stream) {
                            return new Response('data: {"error":"AI service unavailable"}\n\ndata: [DONE]\n\n', {
                                status: 503,
                                headers: {'Content-Type': 'text/event-stream'},
                            });
                        }
                        return Response.json({
                            error: {
                                message: 'AI service unavailable. All providers are currently exhausted or down.',
                                code: 'ai_unavailable',
                                type: 'service_unavailable'
                            }
                        }, {status: 503});
                }
            }

            const chat = chatResult.value;
            if (chat.isStream) {
                return new Response(chat.payload, {
                    headers: {
                        'Content-Type': 'text/event-stream',
                        'Cache-Control': 'no-cache',
                        'Connection': 'keep-alive',
                        'X-Model': chat.model,
                        'X-AI-Provider': chat.aiProvider,
                        'X-AI-Provider-URL': chat.aiProviderUrl,
                    },
                });
            } else {
                return Response.json(chat.payload, {
                    headers: {
                        'X-Model': chat.model,
                        'X-AI-Provider': chat.aiProvider,
                        'X-AI-Provider-URL': chat.aiProviderUrl,
                    },
                });
            }
        }, {
            beforeHandle: ({tenant}) => {
                if (tenant?.rateLimitDailyRequests != null && !auditStore.isAllowed(tenant.id, tenant.rateLimitDailyRequests)) {
                    return tooManyRequestsResponse('Daily rate limit exceeded for this tenant');
                }
            },
            body: ChatRequestSchema,
            detail: {
                summary: 'Chat completions',
                description: `OpenAI-compatible chat completions endpoint.

Requires a gateway API key (\`Authorization: Bearer gw_xxx\`). Routes the request through the best available model using intelligent selection (UCB1-Tuned by default, configurable via \`SELECTOR_TYPE\`) and circuit breaker.

**Model selection**
- \`model\` (optional) - restricts routing to providers that expose a model with that exact name. Supports \`"provider/model"\` syntax to target a specific provider. Pass \`"${MULTIFLOW_AUTO_MODEL}"\` to let the gateway route freely across all tenant models (useful for clients that require a non-empty model field).
- \`models\` (gateway extension, array) - restricts routing to an explicit subset of models. Takes precedence over \`model\`. Cannot be used together with \`model\`.

**Tool calling pass-through**

The gateway is fully compatible with OpenAI function calling. Pass \`tools\` and \`tool_choice\` in the request body: they are forwarded verbatim to the upstream provider. When the model decides to call a tool, the response will have \`finish_reason: "tool_calls"\` and \`choices[0].message.tool_calls\` populated - the client is responsible for executing the tool and sending back the result as a \`role: "tool"\` message in the next turn.

**Sampling parameters**

All standard OpenAI sampling parameters are forwarded upstream: \`temperature\`, \`top_p\`, \`max_tokens\`, \`max_completion_tokens\`, \`presence_penalty\`, \`frequency_penalty\`, \`seed\`, \`stop\`, \`response_format\`, \`stream_options\`, \`user\`, \`parallel_tool_calls\`.`,
                tags: ['Chat'],
            },
        });
}

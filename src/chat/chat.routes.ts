import {Elysia} from 'elysia';
import type {TenantStore} from '@/tenant/tenant.store';
import {badRequestResponse, internalErrorResponse, tooManyRequestsResponse, unprocessableResponse} from '@/utils/http';
import {ChatService} from './chat.service';
import {AIRouterFactory} from '@/engine/routing/ai-router.factory';
import {createModelSelector} from '@/engine/selection/model-selector.factory';
import {TenantModelConfigResolver} from '@/tenant/tenant-model-config.resolver';
import {tenantAuthPlugin} from '@/auth/auth.middleware';
import {ChatRequestSchema} from './chat.schema';
import {config} from '@/config/config';
import type {CryptoService} from '@/crypto/crypto';
import {MetricsStore} from '@/engine/observability/metrics';
import {CircuitBreaker} from '@/engine/resilience/circuit-breaker';
import type {AuditStore} from '@/audit/audit.store';

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
    const tenantModelConfResolver = new TenantModelConfigResolver(tenantStore, cryptoService);

    function parseModelString(entry: string): { providerName?: string; model: string } {
        const slashIdx = entry.indexOf('/');
        if (slashIdx === -1) {
            return {model: entry};
        }
        return {
            providerName: entry.slice(0, slashIdx),
            model: entry.slice(slashIdx + 1)
        };
    }

    return new Elysia()
        .use(tenantAuthPlugin(tenantStore))
        .guard({detail: {security: [{GatewayApiKey: []}]}}) // This guard applies the security requirement for Swagger UI / OpenAPI docs
        .post('/v1/chat/completions', async ({body, tenant}) => {

            if (body.model && body.models) {
                return badRequestResponse("Cannot use both 'model' and 'models' fields simultaneously");
            }

            const {
                providerName: requestedProviderName,
                model: requestedModel
            } = body.model ? parseModelString(body.model) : {providerName: undefined, model: undefined};

            const requestedModelsAndProviders = body.models?.map(parseModelString);

            const modelConfigsResult = tenantModelConfResolver.resolve({
                tenantId: tenant!.id,
                requestedModel,
                requestedProviderName,
                requestedModelsAndProviders: requestedModelsAndProviders,
                forceAiProviderId: tenant!.forceAiProviderId
            });
            if (modelConfigsResult.isErr()) {
                switch (modelConfigsResult.error.code) {
                    case 'no_providers':
                        return unprocessableResponse('No providers configured for this tenant');
                    case 'model_not_found':
                        return badRequestResponse(`Model '${modelConfigsResult.error.model}' is not available for this tenant`);
                }
            }

            const chatResult = await chatService.handleChatRequest(tenant!, body, modelConfigsResult.value);
            if (chatResult.isErr()) {
                switch (chatResult.error.code) {
                    case 'ai_unavailable':
                        if (body.stream) {
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
                    case 'stream_not_supported':
                        return internalErrorResponse();
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
                        }
                    }
                );
            } else {
                return Response.json(chat.payload, {
                    headers: {
                        'X-Model': chat.model,
                        'X-AI-Provider': chat.aiProvider,
                        'X-AI-Provider-URL': chat.aiProviderUrl
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
                description: 'OpenAI-compatible endpoint. Requires a gateway API key (Bearer gw_xxx). Routes the request through the best available model using intelligent selection (UCB1-Tuned by default, configurable via SELECTOR_TYPE) and circuit breaker. The `model` field is optional -- when provided, only providers with a matching modelName are considered. Use `models` (gateway extension) to restrict routing to a named subset of models; it takes precedence over `model` when provided.',
                tags: ['Chat'],
            },
        });
}

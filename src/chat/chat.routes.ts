import {Elysia} from 'elysia';
import type {TenantStore} from '@/tenant/tenant.store';
import {badRequestResponse, internalErrorResponse, unprocessableResponse} from '@/utils/http';
import {ChatService} from './chat.service';
import {RoutingAIClientFactory, createModelSelector} from '@/engine/routing/routing-client-factory';
import {TenantModelConfigResolver} from '@/tenant/tenant-model-config.resolver';
import {tenantAuthPlugin} from '@/auth/auth.middleware';
import {ChatRequestSchema} from './chat.schema';
import {config} from '@/config/config';
import type { CryptoService } from '@/crypto/crypto';
import type {ModelConfig} from '@/engine/client/client.types';
import type {Result} from 'neverthrow';
import type {TenantModelConfigError} from '@/tenant/tenant.types';
import {MetricsStore} from '@/engine/observability/metrics';
import {CircuitBreaker} from '@/engine/resilience/circuit-breaker';

export function chatRoutePlugin(tenantStore: TenantStore, cryptoService: CryptoService) {
    const routingAIClientFactory = new RoutingAIClientFactory(
        new MetricsStore(),
        new CircuitBreaker(),
        createModelSelector(config.selectorType)
    );
    const chatService = new ChatService(routingAIClientFactory);
    const tenantModelConfResolver = new TenantModelConfigResolver(tenantStore, cryptoService);

    return new Elysia()
        .use(tenantAuthPlugin(tenantStore))
        .guard({detail: {security: [{GatewayApiKey: []}]}}) // This guard applies the security requirement for Swagger UI / OpenAPI docs
        .post('/v1/chat/completions', async ({body, tenant}) => {

            const modelConfigResult: Result<ModelConfig[], TenantModelConfigError> = tenantModelConfResolver.resolve({
                tenantId: tenant!.id,
                requestedModel: body.model,
                forceAiProviderId: tenant!.forceAiProviderId
            });
            if (modelConfigResult.isErr()) {
                switch (modelConfigResult.error.code) {
                    case 'no_providers':
                        return unprocessableResponse('No providers configured for this tenant');
                    case 'model_not_found':
                        return badRequestResponse(`Model '${modelConfigResult.error.model}' is not available for this tenant`);
                }
            }

            const chatResult = await chatService.handleChatRequest(tenant!, body, modelConfigResult.value);
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
                        }, { status: 503 });
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
            body: ChatRequestSchema,
            detail: {
                summary: 'Chat completions',
                description: 'OpenAI-compatible endpoint. Requires a gateway API key (Bearer gw_xxx). Routes the request through the best available model using intelligent selection (Thompson Sampling by default, configurable via SELECTOR_TYPE) and circuit breaker. The `model` field is optional -- when provided, only providers with a matching modelName are considered.',
                tags: ['Chat'],
            },
        });
}

import {Elysia} from 'elysia';
import type {TenantStore} from '@/tenant/tenant-store';
import {badRequestResponse, internalErrorResponse, unprocessableResponse} from '@/utils/http';
import {ChatService, AiUnavailableError} from '@/services/chat.service';
import {RoutingAIClientFactory} from '@/engine/routing/routing-client-factory';
import {ModelConfigResolver} from '@/engine/selection/model-config-resolver';
import {tenantAuthPlugin} from '@/auth/middleware';
import {ChatRequestSchema} from '@/schemas/openai.schema';

export function chatRoutePlugin(tenantStore: TenantStore) {
    const routingAIClientFactory = new RoutingAIClientFactory();
    const chatService = new ChatService(routingAIClientFactory);
    const modelConfigResolver = new ModelConfigResolver(tenantStore);

    return new Elysia()
        .use(tenantAuthPlugin(tenantStore))
        .guard({detail: {security: [{GatewayApiKey: []}]}}) // This guard applies the security requirement for Swagger UI / OpenAPI docs
        .post('/v1/chat/completions', async ({body, tenant}) => {
            const modelConfResult = modelConfigResolver.resolve({
                tenantId: tenant!.id,
                requestedModel: body.model,
                forceAiProviderId: tenant!.forceAiProviderId
            });
            if (!modelConfResult.ok) {
                if (modelConfResult.error === 'no_providers') return unprocessableResponse('No providers configured for this tenant');
                return badRequestResponse(`Model '${modelConfResult.model}' is not available for this tenant`);
            }

            try {
                const result = await chatService.handleChatRequest(tenant!, body, modelConfResult.configs);

                if (result.isStream) {
                    return new Response(result.payload, {
                        headers: {
                            'Content-Type': 'text/event-stream',
                            'Cache-Control': 'no-cache',
                            'Connection': 'keep-alive',
                            'X-Model': result.model,
                            'X-AI-Provider': result.aiProvider,
                            'X-AI-Provider-URL': result.aiProviderUrl,
                        },
                    });
                } else {
                    return Response.json(result.payload, {
                        headers: {'X-Model': result.model, 'X-AI-Provider': result.aiProvider, 'X-AI-Provider-URL': result.aiProviderUrl},
                    });
                }
            } catch (err) {
                if (err instanceof AiUnavailableError) {
                    return new Response('data: {"error":"AI service unavailable"}\n\ndata: [DONE]\n\n', {
                        status: 503,
                        headers: {'Content-Type': 'text/event-stream'},
                    });
                }
                return internalErrorResponse();
            }
        }, {
            body: ChatRequestSchema,
            detail: {
                summary: 'Chat completions',
                description: 'OpenAI-compatible endpoint. Requires a gateway API key (Bearer gw_xxx). Routes the request through the best available model using UCB1 selection and circuit breaker. The `model` field is optional -- when provided, only providers with a matching modelName are considered.',
                tags: ['Chat'],
            },
        });
}

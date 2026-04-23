import {Elysia} from 'elysia';
import type {TenantStore} from '@/tenant/tenant.store';
import {badRequestResponse, internalErrorResponse, unprocessableResponse} from '@/utils/http';
import {ChatService} from './chat.service';
import {RoutingAIClientFactory} from '@/engine/routing/routing-client-factory';
import {TenantModelConfigResolver} from '@/tenant/tenant-model-config.resolver';
import {tenantAuthPlugin} from '@/auth/auth.middleware';
import {ChatRequestSchema} from './chat.schema';

export function chatRoutePlugin(tenantStore: TenantStore) {
    const routingAIClientFactory = new RoutingAIClientFactory();
    const chatService = new ChatService(routingAIClientFactory);
    const tenantModelConfResolver = new TenantModelConfigResolver(tenantStore);

    return new Elysia()
        .use(tenantAuthPlugin(tenantStore))
        .guard({detail: {security: [{GatewayApiKey: []}]}}) // This guard applies the security requirement for Swagger UI / OpenAPI docs
        .post('/v1/chat/completions', async ({body, tenant}) => {

            const modelConfResult = tenantModelConfResolver.resolve({
                tenantId: tenant!.id,
                requestedModel: body.model,
                forceAiProviderId: tenant!.forceAiProviderId
            });
            if (modelConfResult.isErr()) {
                switch (modelConfResult.error.code) {
                    case 'no_providers':
                        return unprocessableResponse('No providers configured for this tenant');
                    case 'model_not_found':
                        return badRequestResponse(`Model '${modelConfResult.error.model}' is not available for this tenant`);
                }
            }

            const chatResult = await chatService.handleChatRequest(tenant!, body, modelConfResult.value);
            if (chatResult.isErr()) {
                switch (chatResult.error.code) {
                    case 'ai_unavailable':
                        return new Response('data: {"error":"AI service unavailable"}\n\ndata: [DONE]\n\n', {
                            status: 503,
                            headers: {'Content-Type': 'text/event-stream'},
                        });
                    case 'stream_not_supported':
                        return internalErrorResponse();
                }
            }

            const result = chatResult.value;
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
                    headers: {
                        'X-Model': result.model,
                        'X-AI-Provider': result.aiProvider,
                        'X-AI-Provider-URL': result.aiProviderUrl
                    },
                });
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

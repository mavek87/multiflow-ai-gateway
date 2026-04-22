import {Elysia, t} from 'elysia';
import type {TenantStore} from '@/tenant/tenant-store';
import {badRequestResponse, unprocessableResponse, internalErrorResponse} from '@/utils/http';
import {ChatService} from '@/services/chat.service';
import {RoutingAIClientFactory} from '@/engine/routing/routing-client-factory';
import {tenantAuthPlugin} from '@/auth/middleware';

const MessageSchema = t.Object({
    role: t.Union([t.Literal('system'), t.Literal('user'), t.Literal('assistant'), t.Literal('tool')]),
    content: t.String(),
});

const ChatRequestSchema = t.Object({
    model: t.Optional(t.String()),
    messages: t.Array(MessageSchema, {minItems: 1, error: 'messages array is required and must not be empty'}),
    system: t.Optional(t.String()),
    stream: t.Optional(t.Boolean()),
});

export function chatRoutePlugin(tenantStore: TenantStore) {
    const routingAIClientFactory = new RoutingAIClientFactory();
    const chatService = new ChatService(tenantStore, routingAIClientFactory);

    return new Elysia()
        .use(tenantAuthPlugin(tenantStore))
        // This guard applies the security requirement for Swagger UI / OpenAPI docs
        .guard({detail: {security: [{GatewayApiKey: []}]}})
        .post('/v1/chat/completions', async ({body, tenant}) => {
            const modelConfResult = chatService.resolveModelConfigs({
                tenantId: tenant!.id,
                requestedModel: body.model,
                forceAiProviderId: tenant!.forceAiProviderId
            });
            if (!modelConfResult.ok) {
                if (modelConfResult.error === 'no_providers') return unprocessableResponse('No providers configured for this tenant');
                return badRequestResponse(`Model '${modelConfResult.model}' is not available for this tenant`);
            }

            try {
                const result = await chatService.handleChatRequest(tenant!, body as any, modelConfResult.configs);
                
                if (result.isStream) {
                    return new Response(result.streamBody, {
                        status: 200,
                        headers: {
                            'Content-Type': 'text/event-stream',
                            'Cache-Control': 'no-cache',
                            'Connection': 'keep-alive',
                            'X-Model': result.model,
                            'X-AI-Provider': result.aiProvider,
                        },
                    });
                } else {
                    return Response.json(result.data, {
                        headers: {'X-AI-Provider': result.aiProvider},
                    });
                }
            } catch (err: any) {
                if (err.message === 'AI service unavailable') {
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

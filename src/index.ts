import {Elysia} from 'elysia';
import {swagger} from '@elysiajs/swagger';
import {sql} from 'drizzle-orm';
import {db} from '@/db/database';
import {TenantStore} from '@/tenant/tenant.store';
import {ProviderStore} from '@/provider/provider.store';
import {adminRoutePlugin} from '@/admin/admin.routes';
import {chatRoutePlugin} from '@/chat/chat.routes';
import {CHAT_COMPLETIONS_PATH} from '@/chat/chat.constants';
import {config} from '@/config/config';
import {createLogger} from '@/utils/logger';
import {CryptoService} from '@/crypto/crypto';
import {runSeed} from '@/db/seed/seed.service';
import {AuditStore} from '@/audit/audit.store';
import {MetricsStore} from '@/engine/observability/metrics';
import {startHousekeeping} from '@/audit/audit.housekeeping';
import {CircuitBreaker} from '@/engine/resilience/circuit-breaker';

const log = createLogger('SERVER');

const cryptoService = new CryptoService();
const auditStore = new AuditStore(db);
const tenantStore = new TenantStore(db);
const providerStore = new ProviderStore(db);
const metricsStore = new MetricsStore();
const circuitBreaker = new CircuitBreaker();

runSeed(providerStore, tenantStore, cryptoService, config.seedFile);
startHousekeeping(auditStore, config.auditRetentionDays);

new Elysia()
    .onError(({code, error, request}) => {
        const {method, url} = request;
        const path = new URL(url).pathname;
        if (code === 'VALIDATION') {
            const message = error.all?.[0]?.summary ?? 'Validation error';
            const details = error.all?.map(({path: field, message: msg}) => ({field, message: msg})) ?? [];
            log.warn(`[422] ${method} ${path} - ${message}`);
            return Response.json({type: 'validation_error', message, details}, {status: 422});
        }
        if ('message' in error) {
            log.error(`[${code}] ${method} ${path} - ${error.message}`);
        }
    })
    .onAfterHandle({as: 'global'}, patchSwaggerExamples)
    .use(swagger({
        provider: 'swagger-ui',
        path: '/docs',
        documentation: {
            info: {
                title: 'Multiflow AI Gateway',
                version: '1.0.0',
                description: 'Self-hosted multi-tenant AI Gateway with OpenAI-compatible API, intelligent routing (UCB1 + circuit breaker), and per-tenant provider isolation.'
            },
            tags: [
                {name: 'Health', description: 'Liveness and readiness probes'},
                {name: 'Chat', description: 'OpenAI-compatible chat completions endpoint'},
                {name: 'Admin - Management', description: 'Tenant and provider management (master key required)'},
                {name: 'Admin - Observability', description: 'Routing metrics and circuit breaker state (master key required)'},
            ],
            components: {
                securitySchemes: {
                    GatewayApiKey: {
                        type: 'http',
                        scheme: 'bearer',
                        bearerFormat: 'gw_xxx',
                    },
                    AdminMasterKey: {
                        type: 'apiKey',
                        in: 'header',
                        name: 'x-master-key',
                    },
                },
            },
        },
    }))
    .get('/', ({redirect}) => redirect('/docs'))
    .get('/liveness', () => ({status: 'ok', timestamp: new Date().toISOString()}), {
        detail: {summary: 'Liveness probe', tags: ['Health']},
    })
    .get('/readiness', () => {
        try {
            db.run(sql`SELECT 1`);
            return new Response(JSON.stringify({status: 'ok', db: 'ok', timestamp: new Date().toISOString()}), {
                status: 200,
                headers: {'content-type': 'application/json'},
            });
        } catch {
            return new Response(JSON.stringify({status: 'error', db: 'unreachable', timestamp: new Date().toISOString()}), {
                status: 503,
                headers: {'content-type': 'application/json'},
            });
        }
    }, {
        detail: {summary: 'Readiness probe', tags: ['Health']},
    })
    .use(adminRoutePlugin(tenantStore, providerStore, cryptoService, auditStore, metricsStore, circuitBreaker))
    .use(chatRoutePlugin(tenantStore, auditStore, metricsStore, cryptoService, circuitBreaker))
    .listen(config.port);

log.info(`multiflow-ai-gateway listening on port ${config.port}`);

function patchSwaggerExamples({request, responseValue}: { request: Request; responseValue: unknown }) {
    if (new URL(request.url).pathname !== '/docs/json') return;
    const spec = responseValue as Record<string, unknown>;
    const post = (spec?.paths as Record<string, Record<string, unknown>>)?.[CHAT_COMPLETIONS_PATH]?.post as Record<string, unknown> | undefined;
    if (!post) return;
    const requestBody = post.requestBody as Record<string, unknown>;
    const content = requestBody?.content as Record<string, Record<string, unknown>>;
    if (!content?.['application/json']) return;
    content['application/json'].examples = {
        'minimal': {
            summary: 'Minimal request (auto-route)',
            value: {messages: [{role: 'user', content: 'Hello!'}]},
        },
        'single-model': {
            summary: 'Single model (OpenAI-compatible)',
            value: {model: 'gpt-4o', messages: [{role: 'user', content: 'Hello!'}]},
        },
        'provider-slash-model': {
            summary: 'Force specific provider',
            value: {model: 'groq/llama-3-70b', messages: [{role: 'user', content: 'Hello!'}]},
        },
        'models-subset': {
            summary: 'Gateway extension: restrict to a subset of models',
            value: {models: ['groq/llama-3-70b', 'openai/gpt-4o-mini', 'gemma-2-9b'], messages: [{role: 'user', content: 'Hello!'}]},
        },
        'with-system-and-sampling': {
            summary: 'System prompt + sampling parameters',
            value: {
                model: 'gpt-4o',
                system: 'You are a helpful assistant.',
                messages: [{role: 'user', content: 'Tell me a joke'}],
                temperature: 0.9,
                max_tokens: 256,
                seed: 42,
            },
        },
        'streaming': {
            summary: 'Streaming response (SSE)',
            value: {
                model: 'gpt-4o',
                messages: [{role: 'user', content: 'Tell me a joke'}],
                stream: true,
            },
        },
        'with-tools': {
            summary: 'Tool calling - Turn 1: send tools and ask the model',
            value: {
                model: 'gpt-4o',
                messages: [{role: 'user', content: 'What is the weather in Rome?'}],
                tools: [{
                    type: 'function',
                    function: {
                        name: 'get_weather',
                        description: 'Get current weather for a city',
                        parameters: {
                            type: 'object',
                            properties: {city: {type: 'string'}},
                            required: ['city'],
                        },
                    },
                }],
                tool_choice: 'auto',
            },
        },
        'with-tool-result': {
            summary: 'Tool calling - Turn 2: send back the tool result',
            value: {
                model: 'gpt-4o',
                messages: [
                    {role: 'user', content: 'What is the weather in Rome?'},
                    {
                        role: 'assistant',
                        content: null,
                        tool_calls: [{id: 'call_1', type: 'function', function: {name: 'get_weather', arguments: '{"city":"Rome"}'}}],
                    },
                    {role: 'tool', content: '{"temperature": 22, "condition": "sunny"}', tool_call_id: 'call_1'},
                ],
                tools: [{
                    type: 'function',
                    function: {
                        name: 'get_weather',
                        description: 'Get current weather for a city',
                        parameters: {
                            type: 'object',
                            properties: {city: {type: 'string'}},
                            required: ['city'],
                        },
                    },
                }],
            },
        },
    };
}
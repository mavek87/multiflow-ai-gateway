import { Elysia } from 'elysia';
import { swagger } from '@elysiajs/swagger';
import { db } from '@/db/database';
import { TenantStore } from '@/tenant/tenant-store';
import { adminRoutePlugin } from '@/routes/admin';
import { chatRoutePlugin } from '@/routes/chat';
import { config } from '@/config/config';
import { createLogger } from '@/utils/logger';

const log = createLogger('SERVER');

const store = new TenantStore(db);

new Elysia()
  .use(swagger({
    provider: 'swagger-ui',
    path: '/docs',
    documentation: {
      info: { title: 'bun-ai-gateway', version: '1.0.0', description: 'Self-hosted multi-tenant AI Gateway with OpenAI-compatible API, intelligent routing (UCB1 + circuit breaker), and per-tenant provider isolation.' },
      tags: [
        { name: 'Chat', description: 'OpenAI-compatible chat completions endpoint' },
        { name: 'Admin', description: 'Tenant and provider management (master key required)' },
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
  .get('/health', () => ({ status: 'ok', timestamp: new Date().toISOString() }))
  .use(adminRoutePlugin(store))
  .use(chatRoutePlugin(store))
  .listen(config.port);

log.info(`multiflow-ai-gateway listening on port ${config.port}`);
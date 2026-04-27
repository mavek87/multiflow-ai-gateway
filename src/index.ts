import { Elysia } from 'elysia';
import { swagger } from '@elysiajs/swagger';
import { db } from '@/db/database';
import { TenantStore } from '@/tenant/tenant.store';
import { ProviderStore } from '@/provider/provider.store';
import { adminRoutePlugin } from '@/admin/admin.routes';
import { chatRoutePlugin } from '@/chat/chat.routes';
import { config } from '@/config/config';
import { createLogger } from '@/utils/logger';
import { CryptoService } from '@/crypto/crypto';
import { runBootstrap } from '@/bootstrap/seed.service';

const log = createLogger('SERVER');

const cryptoService = new CryptoService();

runBootstrap(db, cryptoService, config.seedFile);

const tenantStore = new TenantStore(db);
const providerStore = new ProviderStore(db);

new Elysia()
  .onError(({ code, error, request }) => {
    const { method, url } = request;
    const path = new URL(url).pathname;
    if (code === 'VALIDATION') {
      const message = error.all?.[0]?.summary ?? 'Validation error';
      const details = error.all?.map(({ path: field, message: msg }) => ({ field, message: msg })) ?? [];
      log.warn(`[422] ${method} ${path} - ${message}`);
      return Response.json({ type: 'validation_error', message, details }, { status: 422 });
    }
    if ('message' in error) {
      log.error(`[${code}] ${method} ${path} - ${error.message}`);
    }
  })
  .use(swagger({
    provider: 'swagger-ui',
    path: '/docs',
    documentation: {
      info: { title: 'Multiflow AI Gateway', version: '1.0.0', description: 'Self-hosted multi-tenant AI Gateway with OpenAI-compatible API, intelligent routing (UCB1 + circuit breaker), and per-tenant provider isolation.' },
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
  .use(adminRoutePlugin(tenantStore, providerStore, cryptoService))
  .use(chatRoutePlugin(tenantStore, cryptoService))
  .listen(config.port);

log.info(`multiflow-ai-gateway listening on port ${config.port}`);

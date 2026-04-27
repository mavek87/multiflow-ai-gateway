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
    const url = new URL(request.url);
    if (code === 'VALIDATION') {
      let summary: string;
      try {
        const parsed = JSON.parse(error.message) as { summary?: string };
        summary = parsed.summary ?? 'Validation error';
      } catch {
        summary = error.message;
      }
      log.warn(`[422] ${request.method} ${url.pathname} - ${summary}`);
      const details = (error.all as Array<{ path: string; message: string }> | undefined)
        ?.map((e) => ({ field: e.path, message: e.message })) ?? [];
      return Response.json({ type: 'validation_error', message: summary, details }, { status: 422 });
    }
    if ('message' in error) {
      log.error(`[${code}] ${request.method} ${url.pathname} - ${error.message}`);
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

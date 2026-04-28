import { Elysia, t } from 'elysia';
import type { TenantStore } from '@/tenant/tenant.store';
import type { ProviderStore } from '@/provider/provider.store';
import { badRequestResponse, notFoundResponse, createdResponse, conflictResponse } from '@/utils/http';
import { checkMasterKey } from '@/auth/auth.middleware';
import type { CryptoService } from '@/crypto/crypto';
import type { AuditStore } from '@/audit/audit.store';
import type { MetricsStore } from '@/engine/observability/metrics';
import type { CircuitBreaker } from '@/engine/resilience/circuit-breaker';

export function adminRoutePlugin(
  tenantStore: TenantStore,
  providerStore: ProviderStore,
  cryptoService: CryptoService,
  auditStore: AuditStore,
  metricsStore: MetricsStore,
  circuitBreaker: CircuitBreaker
) {
  return new Elysia({ prefix: '/admin' })
    .guard({
      beforeHandle: ({ headers }) => checkMasterKey(headers as Record<string, string | undefined>),
      detail: { security: [{ AdminMasterKey: [] }] },
    })

    // --- Tenants ---
    .get('/tenants', () => tenantStore.listTenants(), {
      detail: { summary: 'List all tenants', tags: ['Admin'] },
    })
    .post('/tenants', async ({ body }) => {
      const name = body.name?.trim();
      if (!name) return badRequestResponse('name is required');
      const { tenant, rawApiKey } = tenantStore.createTenant(name);
      return createdResponse({ tenantId: tenant.id, name: tenant.name, apiKey: rawApiKey });
    }, {
      body: t.Object({ name: t.String({ minLength: 1 }) }),
      detail: { summary: 'Create a tenant', description: 'Creates a tenant and returns a gateway API key. The key is shown once only.', tags: ['Admin'] },
    })
    .patch('/tenants/:id', ({ params, body }) => {
      const tenant = tenantStore.getTenantById(params.id);
      if (!tenant) return notFoundResponse('Tenant not found');
      if (body.forceAiProviderId !== undefined && body.forceAiProviderId !== null) {
        if (!providerStore.getProviderById(body.forceAiProviderId)) return notFoundResponse('Provider not found');
      }
      const updates: Parameters<typeof tenantStore.updateTenant>[1] = {};
      if (body.forceAiProviderId !== undefined) updates.forceAiProviderId = body.forceAiProviderId;
      if (body.rateLimitDailyRequests !== undefined) updates.rateLimitDailyRequests = body.rateLimitDailyRequests;
      return tenantStore.updateTenant(params.id, updates);
    }, {
      body: t.Object({
        forceAiProviderId: t.Optional(t.Union([t.String({ minLength: 1 }), t.Null()])),
        rateLimitDailyRequests: t.Optional(t.Union([t.Integer({ minimum: 0 }), t.Null()])),
      }),
      detail: { summary: 'Update tenant settings (forceAiProviderId, rateLimitDailyRequests). Pass null to remove a limit.', tags: ['Admin'] },
    })
    .get('/tenants/:id', ({ params }) => {
      const tenant = tenantStore.getTenantById(params.id);
      if (!tenant) return notFoundResponse('Tenant not found');
      return Response.json({
        ...tenant,
        credentials: tenantStore.listTenantAiProviderKeys(tenant.id),
        modelConfigs: tenantStore.listTenantAiModelPriorities(tenant.id),
      });
    }, {
      detail: { summary: 'Get tenant details', tags: ['Admin'] },
    })
    .delete('/tenants/:id', ({ params }) => {
      const deleted = tenantStore.deleteTenant(params.id);
      if (!deleted) return notFoundResponse('Tenant not found');
      return new Response(null, { status: 204 });
    }, {
      detail: { summary: 'Delete a tenant (hard delete, cascades to keys and models)', tags: ['Admin'] },
    })

    // --- Global providers ---
    .get('/providers', () => providerStore.listProviders(), {
      detail: { summary: 'List all global providers', tags: ['Admin'] },
    })
    .post('/providers', ({ body }) => {
      const result = providerStore.createProvider({ name: body.name, type: body.type, baseUrl: body.baseUrl });
      if (result.isErr()) return conflictResponse('Provider already exists');
      return createdResponse(result.value);
    }, {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        type: t.String({ minLength: 1 }),
        baseUrl: t.String({ minLength: 1 }),
      }),
      detail: {
        summary: 'Create a global provider',
        tags: ['Admin'],
        responses: {
          201: { description: 'Provider created' },
          409: { description: 'Provider name already exists' },
        },
      },
    })
    .patch('/providers/:providerId', ({ params, body }) => {
      const updated = providerStore.updateProvider(params.providerId, body);
      if (!updated) return notFoundResponse('Provider not found');
      return updated;
    }, {
      body: t.Object({
        type: t.Optional(t.String({ minLength: 1 })),
        baseUrl: t.Optional(t.String({ minLength: 1 })),
      }),
      detail: { summary: 'Update a provider', tags: ['Admin'] },
    })
    .delete('/providers/:providerId', ({ params }) => {
      const deleted = providerStore.deleteProvider(params.providerId);
      if (!deleted) return notFoundResponse('Provider not found');
      return new Response(null, { status: 204 });
    }, {
      detail: { summary: 'Delete a provider (hard delete, cascades)', tags: ['Admin'] },
    })

    // --- Provider models ---
    .get('/providers/:providerId/models', ({ params }) => {
      if (!providerStore.getProviderById(params.providerId)) return notFoundResponse('Provider not found');
      return providerStore.listProviderModels(params.providerId);
    }, {
      detail: { summary: 'List models for a provider', tags: ['Admin'] },
    })
    .post('/providers/:providerId/models', ({ params, body }) => {
      if (!providerStore.getProviderById(params.providerId)) return notFoundResponse('Provider not found');
      const result = providerStore.createProviderModel({ aiProviderId: params.providerId, modelName: body.modelName });
      if (result.isErr()) return conflictResponse('Model already exists for this provider');
      return createdResponse(result.value);
    }, {
      body: t.Object({ modelName: t.String({ minLength: 1 }) }),
      detail: {
        summary: 'Add a model to a provider',
        tags: ['Admin'],
        responses: {
          201: { description: 'Model created' },
          404: { description: 'Provider not found' },
          409: { description: 'Model already exists for this provider' },
        },
      },
    })
    .patch('/providers/:providerId/models/:modelId', ({ params, body }) => {
      if (!providerStore.getProviderById(params.providerId)) return notFoundResponse('Provider not found');
      const updated = providerStore.updateProviderModel(params.modelId, body);
      if (!updated) return notFoundResponse('Provider model not found');
      return updated;
    }, {
      body: t.Object({ enabled: t.Optional(t.Boolean()) }),
      detail: { summary: 'Update a provider model (toggle enabled)', tags: ['Admin'] },
    })
    .delete('/providers/:providerId/models/:modelId', ({ params }) => {
      if (!providerStore.getProviderById(params.providerId)) return notFoundResponse('Provider not found');
      const deleted = providerStore.deleteProviderModel(params.modelId);
      if (!deleted) return notFoundResponse('Provider model not found');
      return new Response(null, { status: 204 });
    }, {
      detail: { summary: 'Delete a provider model (hard delete, cascades)', tags: ['Admin'] },
    })

    // --- Tenant AI provider keys ---
    .get('/tenants/:id/credentials', ({ params }) => {
      if (!tenantStore.getTenantById(params.id)) return notFoundResponse('Tenant not found');
      return tenantStore.listTenantAiProviderKeys(params.id);
    }, {
      detail: { summary: 'List tenant AI provider keys (raw keys are never returned)', tags: ['Admin'] },
    })
    .post('/tenants/:id/credentials', ({ params, body }) => {
      if (!tenantStore.getTenantById(params.id)) return notFoundResponse('Tenant not found');
      if (!providerStore.getProviderById(body.aiProviderId)) return notFoundResponse('Provider not found');
      const credential = tenantStore.assignAiProviderKey(params.id, {
        aiProviderId: body.aiProviderId,
        aiProviderApiKeyEncrypted: body.apiKey ? cryptoService.encrypt(body.apiKey) : undefined,
      });
      const { aiProviderApiKeyEncrypted: _, ...safe } = credential;
      return createdResponse(safe);
    }, {
      body: t.Object({
        aiProviderId: t.String({ minLength: 1 }),
        apiKey: t.Optional(t.String()),
      }),
      detail: { summary: 'Assign an AI provider key to a tenant. API key is encrypted at rest.', tags: ['Admin'] },
    })
    .patch('/tenants/:id/credentials/:credentialId', ({ params, body }) => {
      if (!tenantStore.getTenantById(params.id)) return notFoundResponse('Tenant not found');
      const updated = tenantStore.updateTenantAiProviderKey(params.credentialId, body);
      if (!updated) return notFoundResponse('Tenant credential not found');
      const { aiProviderApiKeyEncrypted: _, ...safe } = updated;
      return safe;
    }, {
      body: t.Object({ enabled: t.Optional(t.Boolean()) }),
      detail: { summary: 'Update a tenant AI provider key (toggle enabled)', tags: ['Admin'] },
    })
    .delete('/tenants/:id/credentials/:credentialId', ({ params }) => {
      if (!tenantStore.getTenantById(params.id)) return notFoundResponse('Tenant not found');
      const deleted = tenantStore.deleteTenantAiProviderKey(params.credentialId);
      if (!deleted) return notFoundResponse('Tenant credential not found');
      return new Response(null, { status: 204 });
    }, {
      detail: { summary: 'Delete a tenant AI provider key (hard delete)', tags: ['Admin'] },
    })

    // --- Tenant AI model priorities ---
    .get('/tenants/:id/models', ({ params }) => {
      if (!tenantStore.getTenantById(params.id)) return notFoundResponse('Tenant not found');
      return tenantStore.listTenantAiModelPriorities(params.id);
    }, {
      detail: { summary: 'List AI model priorities for tenant', tags: ['Admin'] },
    })
    .post('/tenants/:id/models', ({ params, body }) => {
      if (!tenantStore.getTenantById(params.id)) return notFoundResponse('Tenant not found');
      const model = providerStore.getProviderModelById(body.aiProviderModelId);
      if (!model) return notFoundResponse('Provider model not found');
      const cfg = tenantStore.assignAiModelPriority(params.id, {
        aiProviderModelId: body.aiProviderModelId,
        priority: body.priority ?? 0,
      });
      return createdResponse(cfg);
    }, {
      body: t.Object({
        aiProviderModelId: t.String({ minLength: 1 }),
        priority: t.Optional(t.Number()),
      }),
      detail: { summary: 'Assign an AI model priority entry to a tenant', tags: ['Admin'] },
    })
    .patch('/tenants/:id/models/:entryId', ({ params, body }) => {
      if (!tenantStore.getTenantById(params.id)) return notFoundResponse('Tenant not found');
      const updated = tenantStore.updateTenantAiModelPriority(params.entryId, body);
      if (!updated) return notFoundResponse('Model priority entry not found');
      return updated;
    }, {
      body: t.Object({
        priority: t.Optional(t.Number()),
        enabled: t.Optional(t.Boolean()),
      }),
      detail: { summary: 'Update an AI model priority entry for a tenant', tags: ['Admin'] },
    })
    .delete('/tenants/:id/models/:entryId', ({ params }) => {
      if (!tenantStore.getTenantById(params.id)) return notFoundResponse('Tenant not found');
      const deleted = tenantStore.deleteTenantAiModelPriority(params.entryId);
      if (!deleted) return notFoundResponse('Model priority entry not found');
      return new Response(null, { status: 204 });
    }, {
      detail: { summary: 'Delete an AI model priority entry for a tenant', tags: ['Admin'] },
    })

    // --- Tenant Gateway API keys ---
    .get('/tenants/:id/api-keys', ({ params }) => {
      if (!tenantStore.getTenantById(params.id)) return notFoundResponse('Tenant not found');
      return tenantStore.listGatewayApiKeys(params.id);
    }, {
      detail: { summary: 'List gateway API keys for a tenant', tags: ['Admin'] },
    })
    .post('/tenants/:id/api-keys', ({ params }) => {
      const result = tenantStore.createGatewayApiKey(params.id);
      if (!result) return notFoundResponse('Tenant not found');
      return createdResponse(result);
    }, {
      detail: { summary: 'Create a new gateway API key for a tenant', tags: ['Admin'] },
    })
    .delete('/tenants/:id/api-keys/:keyId', ({ params }) => {
      if (!tenantStore.getTenantById(params.id)) return notFoundResponse('Tenant not found');
      const deleted = tenantStore.deleteGatewayApiKey(params.keyId);
      if (!deleted) return notFoundResponse('API key not found');
      return new Response(null, { status: 204 });
    }, {
      detail: { summary: 'Delete a gateway API key', tags: ['Admin'] },
    })

    // --- Observability ---
    .get('/metrics', () => metricsStore.all(), {
      detail: { summary: 'Get routing metrics snapshot', tags: ['Admin'] },
    })
    .get('/circuit-breakers', () => circuitBreaker.all(), {
      detail: { summary: 'Get circuit breakers snapshot', tags: ['Admin'] },
    })

    // --- Audit log ---
    .get('/audit', ({ query }) => {
      const from = query.from ? new Date(query.from).getTime() : undefined;
      const to = query.to ? new Date(query.to).getTime() : undefined;
      const limit = query.limit ? Math.min(parseInt(query.limit, 10), 1000) : 100;
      const offset = query.offset ? parseInt(query.offset, 10) : 0;
      return auditStore.query({ tenantId: query.tenantId, from, to, limit, offset });
    }, {
      query: t.Object({
        tenantId: t.Optional(t.String()),
        from: t.Optional(t.String()),
        to: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
      }),
      detail: { summary: 'Query audit log. Filters: tenantId, from/to (ISO date strings), limit (max 1000), offset.', tags: ['Admin'] },
    });
}

import { Elysia, t } from 'elysia';
import type { TenantStore } from '@/tenant/tenant.store';
import { badRequestResponse, notFoundResponse, createdResponse, conflictResponse } from '@/utils/http';
import { checkMasterKey } from '@/auth/auth.middleware';

export function adminRoutePlugin(store: TenantStore) {
  return new Elysia({ prefix: '/admin' })
    .guard({
      beforeHandle: ({ headers }) => checkMasterKey(headers as Record<string, string | undefined>),
      detail: { security: [{ AdminMasterKey: [] }] },
    })

    // --- Tenants ---
    .get('/tenants', () => store.listTenants(), {
      detail: { summary: 'List all tenants', tags: ['Admin'] },
    })
    .post('/tenants', async ({ body }) => {
      const name = body.name?.trim();
      if (!name) return badRequestResponse('name is required');
      const { tenant, rawApiKey } = store.createTenant(name);
      return createdResponse({ tenantId: tenant.id, name: tenant.name, apiKey: rawApiKey });
    }, {
      body: t.Object({ name: t.String({ minLength: 1 }) }),
      detail: { summary: 'Create a tenant', description: 'Creates a tenant and returns a gateway API key. The key is shown once only.', tags: ['Admin'] },
    })
    .patch('/tenants/:id', ({ params, body }) => {
      const tenant = store.getTenantById(params.id);
      if (!tenant) return notFoundResponse('Tenant not found');
      if (body.forceAiProviderId !== undefined && body.forceAiProviderId !== null) {
        if (!store.getProviderById(body.forceAiProviderId)) return notFoundResponse('Provider not found');
      }
      return store.updateTenant(params.id, { forceAiProviderId: body.forceAiProviderId });
    }, {
      body: t.Object({
        forceAiProviderId: t.Union([t.String({ minLength: 1 }), t.Null()]),
      }),
      detail: { summary: 'Update tenant settings. Set forceAiProviderId to restrict routing to a single provider (null to remove the lock).', tags: ['Admin'] },
    })
    .get('/tenants/:id', ({ params }) => {
      const tenant = store.getTenantById(params.id);
      if (!tenant) return notFoundResponse('Tenant not found');
      return Response.json({
        ...tenant,
        credentials: store.listTenantAiProviderKeys(tenant.id),
        modelConfigs: store.listTenantAiModelPriorities(tenant.id),
      });
    }, {
      detail: { summary: 'Get tenant details', tags: ['Admin'] },
    })

    // --- Global providers ---
    .get('/providers', () => store.listProviders(), {
      detail: { summary: 'List all global providers', tags: ['Admin'] },
    })
    .post('/providers', ({ body }) => {
      const result = store.createProvider({ name: body.name, type: body.type, baseUrl: body.baseUrl });
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

    // --- Provider models ---
    .get('/providers/:providerId/models', ({ params }) => {
      if (!store.getProviderById(params.providerId)) return notFoundResponse('Provider not found');
      return store.listProviderModels(params.providerId);
    }, {
      detail: { summary: 'List models for a provider', tags: ['Admin'] },
    })
    .post('/providers/:providerId/models', ({ params, body }) => {
      if (!store.getProviderById(params.providerId)) return notFoundResponse('Provider not found');
      const result = store.createProviderModel({ aiProviderId: params.providerId, modelName: body.modelName });
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

    // --- Tenant AI provider keys ---
    .get('/tenants/:id/credentials', ({ params }) => {
      if (!store.getTenantById(params.id)) return notFoundResponse('Tenant not found');
      return store.listTenantAiProviderKeys(params.id);
    }, {
      detail: { summary: 'List tenant AI provider keys (raw keys are never returned)', tags: ['Admin'] },
    })
    .post('/tenants/:id/credentials', ({ params, body }) => {
      if (!store.getTenantById(params.id)) return notFoundResponse('Tenant not found');
      if (!store.getProviderById(body.aiProviderId)) return notFoundResponse('Provider not found');
      const credential = store.assignAiProviderKey(params.id, {
        aiProviderId: body.aiProviderId,
        apiKey: body.apiKey,
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

    // --- Tenant AI model priorities ---
    .get('/tenants/:id/models', ({ params }) => {
      if (!store.getTenantById(params.id)) return notFoundResponse('Tenant not found');
      return store.listTenantAiModelPriorities(params.id);
    }, {
      detail: { summary: 'List AI model priorities for tenant', tags: ['Admin'] },
    })
    .post('/tenants/:id/models', ({ params, body }) => {
      if (!store.getTenantById(params.id)) return notFoundResponse('Tenant not found');
      const model = store.getProviderModelById(body.aiProviderModelId);
      if (!model) return notFoundResponse('Provider model not found');
      const cfg = store.assignAiModelPriority(params.id, {
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
    });
}

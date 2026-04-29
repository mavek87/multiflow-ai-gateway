import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import * as schema from '@/db/schema';
import { TenantStore } from '@/tenant/tenant.store';
import { ProviderStore } from '@/provider/provider.store';
import { CryptoService } from '@/crypto/crypto';
import { AuditStore } from '@/audit/audit.store';
import { MetricsStore } from '@/engine/observability/metrics';
import { Elysia } from 'elysia';
import { chatRoutePlugin } from '@/chat/chat.routes';
import { adminRoutePlugin } from '@/admin/admin.routes';
import { CircuitBreaker } from '@/engine/resilience/circuit-breaker';

export function setupTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.run('PRAGMA foreign_keys=ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: './drizzle' });
  return db;
}

export function createTestContext() {
  const db = setupTestDb();
  const tenantStore = new TenantStore(db);
  const providerStore = new ProviderStore(db);
  const auditStore = new AuditStore(db);
  const metricsStore = new MetricsStore();
  const circuitBreaker = new CircuitBreaker();

  return { db, tenantStore, providerStore, auditStore, metricsStore, circuitBreaker };
}

export function seedTestTenantAndProvider(tenantStore: TenantStore, providerStore: ProviderStore) {
  const { tenant, rawApiKey } = tenantStore.createTenant('TestTenant');
  const cryptoService = new CryptoService();

  const provider = providerStore.createProvider({
    name: 'OpenAI',
    type: 'openai',
    baseUrl: 'https://api.openai.com/v1'
  })._unsafeUnwrap();

  const providerModel = providerStore.createProviderModel({
    aiProviderId: provider.id,
    modelName: 'gpt-4o'
  })._unsafeUnwrap();

  tenantStore.assignAiProviderKey(tenant.id, {
    aiProviderId: provider.id,
    aiProviderApiKeyEncrypted: cryptoService.encrypt('sk-fake-key')
  });

  tenantStore.assignAiModelPriority(tenant.id, {
    aiProviderModelId: providerModel.id,
    priority: 10
  });

  return { tenant, rawApiKey, provider, providerModel };
}

export function seedTestTenantWithMultipleModels(tenantStore: TenantStore, providerStore: ProviderStore) {
  const { tenant, rawApiKey } = tenantStore.createTenant('MultiModelTenant');
  const cryptoService = new CryptoService();

  const providerA = providerStore.createProvider({
    name: 'ProviderA',
    type: 'openai',
    baseUrl: 'https://api.provider-a.com/v1',
  })._unsafeUnwrap();

  const providerB = providerStore.createProvider({
    name: 'ProviderB',
    type: 'openai',
    baseUrl: 'https://api.provider-b.com/v1',
  })._unsafeUnwrap();

  const modelA = providerStore.createProviderModel({ aiProviderId: providerA.id, modelName: 'model-a' })._unsafeUnwrap();
  const modelB = providerStore.createProviderModel({ aiProviderId: providerB.id, modelName: 'model-b' })._unsafeUnwrap();

  tenantStore.assignAiProviderKey(tenant.id, { aiProviderId: providerA.id, aiProviderApiKeyEncrypted: cryptoService.encrypt('key-a') });
  tenantStore.assignAiProviderKey(tenant.id, { aiProviderId: providerB.id, aiProviderApiKeyEncrypted: cryptoService.encrypt('key-b') });

  tenantStore.assignAiModelPriority(tenant.id, { aiProviderModelId: modelA.id, priority: 0 });
  tenantStore.assignAiModelPriority(tenant.id, { aiProviderModelId: modelB.id, priority: 1 });

  return { tenant, rawApiKey, providerA, providerB, modelA, modelB };
}

export function createTestApp(tenantStore: TenantStore, providerStore: ProviderStore, auditStore: AuditStore, metricsStore: MetricsStore, circuitBreaker: CircuitBreaker, cryptoService: CryptoService) {
  return new Elysia()
    .get('/health', () => ({ status: 'ok', timestamp: new Date().toISOString() }))
    .use(chatRoutePlugin(tenantStore, auditStore, metricsStore, cryptoService, circuitBreaker))
    .use(adminRoutePlugin(tenantStore, providerStore, cryptoService, auditStore, metricsStore, circuitBreaker));
}

export async function sendRequest(app: ReturnType<typeof createTestApp>, path: string, options: {
  method?: string;
  body?: any;
  apiKey?: string;
  masterKey?: string;
  headers?: Record<string, string>;
} = {}) {
  const { method = 'GET', body, apiKey, masterKey, headers = {} } = options;
  const requestHeaders = new Headers(headers);
  if (apiKey) requestHeaders.set('Authorization', `Bearer ${apiKey}`);
  if (masterKey) requestHeaders.set('x-master-key', masterKey);
  if (body && !requestHeaders.has('Content-Type')) {
    requestHeaders.set('Content-Type', 'application/json');
  }

  return await app.handle(new Request(`http://localhost${path}`, {
    method,
    headers: requestHeaders,
    body: body ? JSON.stringify(body) : undefined,
  }));
}

export function mockJsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {'Content-Type': 'application/json'},
  });
}

export function mockSseResponse(content: string | string[]) {
  const tokens = Array.isArray(content) ? content : [content];
  const sse = tokens.map(t => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`).join('') + `data: [DONE]\n\n`;
  return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

export function mockFetch(mockResponse: Response | ((...args: any[]) => Response)) {
  const originalFetch = globalThis.fetch;
  const fn = typeof mockResponse === 'function' ? mockResponse : () => mockResponse;
  globalThis.fetch = fn as unknown as typeof globalThis.fetch;
  return () => { globalThis.fetch = originalFetch; };
}

export function createTestAppEmpty() {
  const { tenantStore, providerStore, auditStore, metricsStore, circuitBreaker } = createTestContext();
  const app = createTestApp(tenantStore, providerStore, auditStore, metricsStore, circuitBreaker, new CryptoService());
  return { app, tenantStore, providerStore, auditStore, metricsStore, circuitBreaker };
}

export function createTestAppWithTenantAndProvider() {
  const { tenantStore, providerStore, auditStore, metricsStore, circuitBreaker } = createTestContext();
  const seeded = seedTestTenantAndProvider(tenantStore, providerStore);
  const app = createTestApp(tenantStore, providerStore, auditStore, metricsStore, circuitBreaker, new CryptoService());
  return { app, rawApiKey: seeded.rawApiKey, tenant: seeded.tenant };
}

export function createTestAppWithMultipleModels() {
  const { tenantStore, providerStore, auditStore, metricsStore, circuitBreaker } = createTestContext();
  const seeded = seedTestTenantWithMultipleModels(tenantStore, providerStore);
  const app = createTestApp(tenantStore, providerStore, auditStore, metricsStore, circuitBreaker, new CryptoService());
  return { app, rawApiKey: seeded.rawApiKey, tenant: seeded.tenant };
}
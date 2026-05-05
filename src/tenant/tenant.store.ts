import { and, desc, eq } from 'drizzle-orm';
import type { DrizzleDb } from '@/db/database';
import { aiProviderModels, aiProviders, gatewayApiKeys, tenantAiModelPriorities, tenantAiProviderKeys, tenants } from '@/db/schema';
import type {
  AssignAiModelPriorityInput,
  AssignAiProviderKeyInput,
  GatewayApiKeyListOutput,
  Tenant,
  TenantAiModelPriority,
  TenantAiProviderKey,
  TenantModelConfig,
  UpdateTenantAiModelPriorityInput,
  UpdateTenantAiProviderKeyInput,
  UpdateTenantInput,
} from './tenant.types';
import { generateApiKey, hashApiKey } from '@/auth/auth.utils';
import { createLogger } from '@/utils/logger';
import { randomUUID } from 'node:crypto';

const log = createLogger('TENANT-STORE');

export class TenantStore {
  constructor(private db: DrizzleDb) {}

  createTenant(name: string): { tenant: Tenant; rawApiKey: string } {
    const tenant: Tenant = { id: randomUUID(), name, forceAiProviderId: null, rateLimitDailyRequests: null, createdAt: Date.now() };
    const rawKey = generateApiKey();
    const keyHash = hashApiKey(rawKey);
    const keyId = randomUUID();

    this.db.insert(tenants).values(tenant).run();
    this.db.insert(gatewayApiKeys).values({
      id: keyId,
      tenantId: tenant.id,
      keyHash,
      createdAt: tenant.createdAt,
    }).run();

    log.info(`Created tenant: ${tenant.name} (${tenant.id})`);
    return { tenant, rawApiKey: rawKey };
  }

  getTenantByApiKey(rawKey: string): Tenant | null {
    const hash = hashApiKey(rawKey);

    const row = this.db
      .select({
        id: tenants.id,
        name: tenants.name,
        forceAiProviderId: tenants.forceAiProviderId,
        rateLimitDailyRequests: tenants.rateLimitDailyRequests,
        createdAt: tenants.createdAt,
        keyId: gatewayApiKeys.id,
      })
      .from(gatewayApiKeys)
      .innerJoin(tenants, eq(tenants.id, gatewayApiKeys.tenantId))
      .where(eq(gatewayApiKeys.keyHash, hash))
      .get();

    if (!row) return null;

    this.db
      .update(gatewayApiKeys)
      .set({ lastUsedAt: Date.now() })
      .where(eq(gatewayApiKeys.id, row.keyId))
      .run();

    return { id: row.id, name: row.name, forceAiProviderId: row.forceAiProviderId ?? null, rateLimitDailyRequests: row.rateLimitDailyRequests ?? null, createdAt: row.createdAt };
  }

  getTenantById(id: string): Tenant | null {
    const row = this.db.select().from(tenants).where(eq(tenants.id, id)).get();
    if (!row) return null;
    return { ...row, forceAiProviderId: row.forceAiProviderId ?? null, rateLimitDailyRequests: row.rateLimitDailyRequests ?? null };
  }

  updateTenant(id: string, input: UpdateTenantInput): Tenant | null {
    const row = this.db.update(tenants).set(input).where(eq(tenants.id, id)).returning().get();
    if (!row) return null;
    log.info(`Updated tenant ${id}`);
    return { ...row, forceAiProviderId: row.forceAiProviderId ?? null, rateLimitDailyRequests: row.rateLimitDailyRequests ?? null };
  }

  deleteTenant(id: string): boolean {
    this.db.delete(tenants).where(eq(tenants.id, id)).run();
    log.info(`Deleted tenant ${id}`);
    return true;
  }

  listTenants(): Tenant[] {
    return this.db.select().from(tenants).orderBy(desc(tenants.createdAt)).all().map(row => ({
      ...row,
      forceAiProviderId: row.forceAiProviderId ?? null,
      rateLimitDailyRequests: row.rateLimitDailyRequests ?? null,
    }));
  }

  // --- Tenant AI provider key management ---

  assignAiProviderKey(tenantId: string, input: AssignAiProviderKeyInput): TenantAiProviderKey {
    const credential: TenantAiProviderKey = {
      id: randomUUID(),
      tenantId,
      aiProviderId: input.aiProviderId,
      aiProviderApiKeyEncrypted: input.aiProviderApiKeyEncrypted ?? null,
      enabled: true,
      createdAt: Date.now(),
    };
    this.db.insert(tenantAiProviderKeys).values(credential).run();
    log.info(`Assigned AI provider key for provider ${input.aiProviderId} to tenant ${tenantId}`);
    return credential;
  }

  listTenantAiProviderKeys(tenantId: string): Array<Omit<TenantAiProviderKey, 'aiProviderApiKeyEncrypted'>> {
    return this.db
      .select({
        id: tenantAiProviderKeys.id,
        tenantId: tenantAiProviderKeys.tenantId,
        aiProviderId: tenantAiProviderKeys.aiProviderId,
        enabled: tenantAiProviderKeys.enabled,
        createdAt: tenantAiProviderKeys.createdAt,
      })
      .from(tenantAiProviderKeys)
      .where(eq(tenantAiProviderKeys.tenantId, tenantId))
      .all();
  }

  getTenantAiProviderKeyById(id: string): TenantAiProviderKey | null {
    return this.db.select().from(tenantAiProviderKeys).where(eq(tenantAiProviderKeys.id, id)).get() ?? null;
  }

  updateTenantAiProviderKey(id: string, input: UpdateTenantAiProviderKeyInput): TenantAiProviderKey | null {
    const row = this.db.update(tenantAiProviderKeys).set(input).where(eq(tenantAiProviderKeys.id, id)).returning().get();
    if (!row) return null;
    log.info(`Updated tenant AI provider key ${id}`);
    return row;
  }

  deleteTenantAiProviderKey(id: string): boolean {
    this.db.delete(tenantAiProviderKeys).where(eq(tenantAiProviderKeys.id, id)).run();
    log.info(`Deleted tenant AI provider key ${id}`);
    return true;
  }

  // --- Tenant AI model priority management ---

  assignAiModelPriority(tenantId: string, input: AssignAiModelPriorityInput): TenantAiModelPriority {
    const config: TenantAiModelPriority = {
      id: randomUUID(),
      tenantId,
      aiProviderModelId: input.aiProviderModelId,
      priority: input.priority ?? 0,
      enabled: true,
      createdAt: Date.now(),
    };
    this.db.insert(tenantAiModelPriorities).values(config).run();
    log.info(`Assigned AI model priority ${input.aiProviderModelId} to tenant ${tenantId}`);
    return config;
  }

  listTenantAiModelPriorities(tenantId: string): TenantAiModelPriority[] {
    return this.db
      .select()
      .from(tenantAiModelPriorities)
      .where(eq(tenantAiModelPriorities.tenantId, tenantId))
      .orderBy(tenantAiModelPriorities.priority)
      .all();
  }

  getTenantAiModelPriorityById(id: string): TenantAiModelPriority | null {
    return this.db.select().from(tenantAiModelPriorities).where(eq(tenantAiModelPriorities.id, id)).get() ?? null;
  }

  updateTenantAiModelPriority(id: string, input: UpdateTenantAiModelPriorityInput): TenantAiModelPriority | null {
    const row = this.db.update(tenantAiModelPriorities).set(input).where(eq(tenantAiModelPriorities.id, id)).returning().get();
    if (!row) return null;
    log.info(`Updated tenant AI model priority ${id}`);
    return row;
  }

  deleteTenantAiModelPriority(id: string): boolean {
    this.db.delete(tenantAiModelPriorities).where(eq(tenantAiModelPriorities.id, id)).run();
    log.info(`Deleted tenant AI model priority ${id}`);
    return true;
  }

  // --- Gateway API key management ---

  listGatewayApiKeys(tenantId: string): GatewayApiKeyListOutput[] {
    return this.db
      .select({
        id: gatewayApiKeys.id,
        createdAt: gatewayApiKeys.createdAt,
        lastUsedAt: gatewayApiKeys.lastUsedAt,
      })
      .from(gatewayApiKeys)
      .where(eq(gatewayApiKeys.tenantId, tenantId))
      .orderBy(desc(gatewayApiKeys.createdAt))
      .all();
  }

  createGatewayApiKey(tenantId: string): { keyId: string; rawApiKey: string } | null {
    if (!this.getTenantById(tenantId)) return null;
    
    const rawApiKey = generateApiKey();
    const keyHash = hashApiKey(rawApiKey);
    const keyId = randomUUID();

    this.db.insert(gatewayApiKeys).values({
      id: keyId,
      tenantId,
      keyHash,
      createdAt: Date.now(),
    }).run();

    log.info(`Created new gateway API key ${keyId} for tenant ${tenantId}`);
    return { keyId, rawApiKey };
  }

  deleteGatewayApiKey(id: string): boolean {
    this.db.delete(gatewayApiKeys).where(eq(gatewayApiKeys.id, id)).run();
    log.info(`Deleted gateway API key ${id}`);
    return true;
  }

  // --- Upsert methods for seed bootstrap ---

  getTenantByName(name: string): Tenant | null {
    const row = this.db.select().from(tenants).where(eq(tenants.name, name)).get();
    if (!row) return null;
    return { ...row, forceAiProviderId: row.forceAiProviderId ?? null, rateLimitDailyRequests: row.rateLimitDailyRequests ?? null };
  }

  upsertTenant(name: string): { tenant: Tenant; rawApiKey: string | null; isNew: boolean } {
    const id = randomUUID();
    const now = Date.now();
    
    this.db.insert(tenants)
      .values({ id, name, forceAiProviderId: null, rateLimitDailyRequests: null, createdAt: now })
      .onConflictDoNothing({ target: tenants.name })
      .run();

    const row = this.db.select().from(tenants).where(eq(tenants.name, name)).get()!;
    const isNew = row.id === id;
    let rawApiKey = null;
    
    if (isNew) {
      rawApiKey = generateApiKey();
      const keyHash = hashApiKey(rawApiKey);
      const keyId = randomUUID();

      this.db.insert(gatewayApiKeys).values({
        id: keyId,
        tenantId: row.id,
        keyHash,
        createdAt: row.createdAt,
      }).run();
      
      log.info(`Created tenant via upsert: ${row.name} (${row.id})`);
    }

    return { 
        tenant: { ...row, forceAiProviderId: row.forceAiProviderId ?? null, rateLimitDailyRequests: row.rateLimitDailyRequests ?? null }, 
        rawApiKey, 
        isNew 
    };
  }

  getAiProviderKey(tenantId: string, aiProviderId: string): TenantAiProviderKey | null {
    return this.db.select().from(tenantAiProviderKeys)
      .where(and(eq(tenantAiProviderKeys.tenantId, tenantId), eq(tenantAiProviderKeys.aiProviderId, aiProviderId)))
      .get() ?? null;
  }

  upsertAiProviderKey(tenantId: string, input: AssignAiProviderKeyInput): TenantAiProviderKey {
    const id = randomUUID();
    const now = Date.now();
    const encrypted = input.aiProviderApiKeyEncrypted ?? null;
    this.db.insert(tenantAiProviderKeys)
      .values({ id, tenantId, aiProviderId: input.aiProviderId, aiProviderApiKeyEncrypted: encrypted, enabled: true, createdAt: now })
      .onConflictDoUpdate({
        target: [tenantAiProviderKeys.tenantId, tenantAiProviderKeys.aiProviderId],
        set: { aiProviderApiKeyEncrypted: encrypted, enabled: true },
      })
      .run();
    return this.db.select().from(tenantAiProviderKeys)
      .where(and(eq(tenantAiProviderKeys.tenantId, tenantId), eq(tenantAiProviderKeys.aiProviderId, input.aiProviderId)))
      .get()!;
  }

  upsertAiModelPriority(tenantId: string, input: AssignAiModelPriorityInput): { priority: TenantAiModelPriority; op: 'created' | 'updated' | 'unchanged' } {
    const existing = this.db.select().from(tenantAiModelPriorities)
      .where(and(eq(tenantAiModelPriorities.tenantId, tenantId), eq(tenantAiModelPriorities.aiProviderModelId, input.aiProviderModelId)))
      .get() ?? null;
    const id = randomUUID();
    const now = Date.now();
    const priorityVal = input.priority ?? 0;
    this.db.insert(tenantAiModelPriorities)
      .values({ id, tenantId, aiProviderModelId: input.aiProviderModelId, priority: priorityVal, enabled: true, createdAt: now })
      .onConflictDoUpdate({
        target: [tenantAiModelPriorities.tenantId, tenantAiModelPriorities.aiProviderModelId],
        set: { priority: priorityVal, enabled: true },
      })
      .run();
    const priority = this.db.select().from(tenantAiModelPriorities)
      .where(and(eq(tenantAiModelPriorities.tenantId, tenantId), eq(tenantAiModelPriorities.aiProviderModelId, input.aiProviderModelId)))
      .get()!;
    let op: 'created' | 'updated' | 'unchanged';
    if (!existing) op = 'created';
    else if (existing.priority !== priorityVal) op = 'updated';
    else op = 'unchanged';
    return { priority, op };
  }

  // --- Chat routing ---

  getTenantModelConfigs(tenantId: string, forceAiProviderId?: string | null): TenantModelConfig[] {
    const rows = this.db
      .select({
        id: tenantAiModelPriorities.id,
        tenantId: tenantAiModelPriorities.tenantId,
        aiProviderModelId: tenantAiModelPriorities.aiProviderModelId,
        priority: tenantAiModelPriorities.priority,
        modelName: aiProviderModels.modelName,
        aiProviderId: aiProviders.id,
        aiProviderName: aiProviders.name,
        aiProviderType: aiProviders.type,
        baseUrl: aiProviders.baseUrl,
        aiProviderApiKeyEncrypted: tenantAiProviderKeys.aiProviderApiKeyEncrypted,
      })
      .from(tenantAiModelPriorities)
      .innerJoin(aiProviderModels, eq(tenantAiModelPriorities.aiProviderModelId, aiProviderModels.id))
      .innerJoin(aiProviders, eq(aiProviderModels.aiProviderId, aiProviders.id))
      .innerJoin(
        tenantAiProviderKeys,
        and(
          eq(tenantAiProviderKeys.tenantId, tenantAiModelPriorities.tenantId),
          eq(tenantAiProviderKeys.aiProviderId, aiProviders.id),
        ),
      )
      .where(
        and(
          eq(tenantAiModelPriorities.tenantId, tenantId),
          eq(tenantAiModelPriorities.enabled, true),
          eq(aiProviderModels.enabled, true),
          eq(tenantAiProviderKeys.enabled, true),
          forceAiProviderId ? eq(aiProviders.id, forceAiProviderId) : undefined,
        ),
      )
      .orderBy(tenantAiModelPriorities.priority)
      .all();

    return rows;
  }
}

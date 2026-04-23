import {ok, err, type Result} from 'neverthrow';
import {and, desc, eq} from 'drizzle-orm';
import type {DrizzleDb} from '@/db/database';
import {aiProviderModels, aiProviders, gatewayApiKeys, tenantAiModelPriorities, tenantAiProviderKeys, tenants} from '@/db/schema';
import type {
  AiProvider,
  AiProviderModel,
  AssignAiModelPriorityInput,
  AssignAiProviderKeyInput,
  CreateProviderInput,
  CreateProviderModelInput,
  DecryptedModelConfig,
  Tenant,
  TenantAiModelPriority,
  TenantAiProviderKey,
  UpdateTenantInput,
} from './tenant.types';
import {generateApiKey, hashApiKey} from '@/auth/auth.utils';
import {decrypt, encrypt} from '@/utils/crypto';
import {createLogger} from '@/utils/logger';
import {randomUUID} from 'node:crypto';

const log = createLogger('TENANT-STORE');

export class TenantStore {
  constructor(private db: DrizzleDb) {}

  createTenant(name: string): { tenant: Tenant; rawApiKey: string } {
    const tenant: Tenant = { id: randomUUID(), name, forceAiProviderId: null, createdAt: Date.now() };
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

    return { id: row.id, name: row.name, forceAiProviderId: row.forceAiProviderId ?? null, createdAt: row.createdAt };
  }

  getTenantById(id: string): Tenant | null {
    const row = this.db.select().from(tenants).where(eq(tenants.id, id)).get();
    if (!row) return null;
    return { ...row, forceAiProviderId: row.forceAiProviderId ?? null };
  }

  updateTenant(id: string, input: UpdateTenantInput): Tenant | null {
    if (!this.getTenantById(id)) return null;
    this.db.update(tenants).set(input).where(eq(tenants.id, id)).run();
    log.info(`Updated tenant ${id}: forceAiProviderId=${input.forceAiProviderId ?? null}`);
    return this.getTenantById(id);
  }

  listTenants(): Tenant[] {
    return this.db.select().from(tenants).orderBy(desc(tenants.createdAt)).all();
  }

  // --- Global provider management ---

  createProvider(input: CreateProviderInput): Result<AiProvider, 'duplicate'> {
    const provider: AiProvider = {
      id: randomUUID(),
      name: input.name,
      type: input.type,
      baseUrl: input.baseUrl,
      createdAt: Date.now(),
    };
    try {
      this.db.insert(aiProviders).values(provider).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('UNIQUE constraint failed')) return err('duplicate');
      throw e;
    }
    log.info(`Created provider: ${provider.name} (${provider.id})`);
    return ok(provider);
  }

  listProviders(): AiProvider[] {
    return this.db.select().from(aiProviders).orderBy(desc(aiProviders.createdAt)).all();
  }

  getProviderById(id: string): AiProvider | null {
    return this.db.select().from(aiProviders).where(eq(aiProviders.id, id)).get() ?? null;
  }

  // --- Provider model management ---

  createProviderModel(input: CreateProviderModelInput): Result<AiProviderModel, 'duplicate'> {
    const model: AiProviderModel = {
      id: randomUUID(),
      aiProviderId: input.aiProviderId,
      modelName: input.modelName,
      enabled: true,
      createdAt: Date.now(),
    };
    try {
      this.db.insert(aiProviderModels).values(model).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('UNIQUE constraint failed')) return err('duplicate');
      throw e;
    }
    log.info(`Created model: ${model.modelName} for provider ${model.aiProviderId}`);
    return ok(model);
  }

  listProviderModels(aiProviderId: string): AiProviderModel[] {
    return this.db
      .select()
      .from(aiProviderModels)
      .where(eq(aiProviderModels.aiProviderId, aiProviderId))
      .all();
  }

  getProviderModelById(id: string): AiProviderModel | null {
    return this.db.select().from(aiProviderModels).where(eq(aiProviderModels.id, id)).get() ?? null;
  }

  // --- Tenant AI provider key management ---

  assignAiProviderKey(tenantId: string, input: AssignAiProviderKeyInput): TenantAiProviderKey {
    const credential: TenantAiProviderKey = {
      id: randomUUID(),
      tenantId,
      aiProviderId: input.aiProviderId,
      aiProviderApiKeyEncrypted: input.apiKey ? encrypt(input.apiKey) : null,
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

  // --- Chat routing ---

  getDecryptedModelConfigs(tenantId: string, forceAiProviderId?: string | null): DecryptedModelConfig[] {
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

    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      aiProviderModelId: row.aiProviderModelId,
      priority: row.priority,
      modelName: row.modelName,
      aiProviderId: row.aiProviderId,
      aiProviderName: row.aiProviderName,
      aiProviderType: row.aiProviderType,
      baseUrl: row.baseUrl,
      apiKeyPlain: row.aiProviderApiKeyEncrypted ? decrypt(row.aiProviderApiKeyEncrypted) : null,
    }));
  }
}

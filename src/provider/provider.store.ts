import { ok, err, type Result } from 'neverthrow';
import { and, desc, eq } from 'drizzle-orm';
import type { DrizzleDb } from '@/db/database';
import { aiProviderModels, aiProviders } from '@/db/schema';
import type {
  AiProvider,
  AiProviderModel,
  CreateProviderInput,
  CreateProviderModelInput,
  UpdateProviderInput,
  UpdateProviderModelInput,
} from '@/provider/provider.types';
import { createLogger } from '@/utils/logger';
import { randomUUID } from 'node:crypto';

const log = createLogger('PROVIDER-STORE');

export class ProviderStore {
  constructor(private db: DrizzleDb) {}

  // --- Global provider management ---

  listProviders(): AiProvider[] {
    return this.db.select().from(aiProviders).orderBy(desc(aiProviders.createdAt)).all();
  }

  getProviderById(id: string): AiProvider | null {
    return this.db.select().from(aiProviders).where(eq(aiProviders.id, id)).get() ?? null;
  }

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

  updateProvider(id: string, input: UpdateProviderInput): AiProvider | null {
    const row = this.db.update(aiProviders).set(input).where(eq(aiProviders.id, id)).returning().get();
    if (!row) return null;
    log.info(`Updated provider ${id}`);
    return row;
  }

  deleteProvider(id: string): boolean {
    this.db.delete(aiProviders).where(eq(aiProviders.id, id)).run();
    log.info(`Deleted provider ${id}`);
    return true;
  }

  // --- Provider model management ---

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

  updateProviderModel(id: string, input: UpdateProviderModelInput): AiProviderModel | null {
    const row = this.db.update(aiProviderModels).set(input).where(eq(aiProviderModels.id, id)).returning().get();
    if (!row) return null;
    log.info(`Updated provider model ${id}`);
    return row;
  }

  deleteProviderModel(id: string): boolean {
    this.db.delete(aiProviderModels).where(eq(aiProviderModels.id, id)).run();
    log.info(`Deleted provider model ${id}`);
    return true;
  }

  // --- Upsert methods for seed bootstrap ---

  getProviderByName(name: string): AiProvider | null {
    return this.db.select().from(aiProviders).where(eq(aiProviders.name, name)).get() ?? null;
  }

  upsertProvider(input: CreateProviderInput): { provider: AiProvider; op: 'created' | 'updated' | 'unchanged' } {
    const existing = this.getProviderByName(input.name);
    const id = randomUUID();
    const now = Date.now();
    this.db.insert(aiProviders)
      .values({ id, name: input.name, type: input.type, baseUrl: input.baseUrl, createdAt: now })
      .onConflictDoUpdate({ target: aiProviders.name, set: { type: input.type, baseUrl: input.baseUrl } })
      .run();
    const provider = this.db.select().from(aiProviders).where(eq(aiProviders.name, input.name)).get()!;
    let op: 'created' | 'updated' | 'unchanged';
    if (!existing) op = 'created';
    else if (existing.type !== input.type || existing.baseUrl !== input.baseUrl) op = 'updated';
    else op = 'unchanged';
    return { provider, op };
  }

  getProviderModelByName(aiProviderId: string, modelName: string): AiProviderModel | null {
    return this.db.select().from(aiProviderModels)
      .where(and(eq(aiProviderModels.aiProviderId, aiProviderId), eq(aiProviderModels.modelName, modelName)))
      .get() ?? null;
  }

  upsertProviderModel(input: CreateProviderModelInput): { model: AiProviderModel; op: 'created' | 'unchanged' } {
    const existing = this.getProviderModelByName(input.aiProviderId, input.modelName);
    const id = randomUUID();
    const now = Date.now();
    this.db.insert(aiProviderModels)
      .values({ id, aiProviderId: input.aiProviderId, modelName: input.modelName, enabled: true, createdAt: now })
      .onConflictDoUpdate({
        target: [aiProviderModels.aiProviderId, aiProviderModels.modelName],
        set: { enabled: true },
      })
      .run();
    const model = this.db.select().from(aiProviderModels)
      .where(and(eq(aiProviderModels.aiProviderId, input.aiProviderId), eq(aiProviderModels.modelName, input.modelName)))
      .get()!;
    return { model, op: existing ? 'unchanged' : 'created' };
  }
}

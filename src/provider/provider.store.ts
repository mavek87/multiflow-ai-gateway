import { ok, err, type Result } from 'neverthrow';
import { and, desc, eq } from 'drizzle-orm';
import type { DrizzleDb } from '@/db/database';
import { aiProviderModels, aiProviders } from '@/db/schema';
import type {
  AiProvider,
  AiProviderModel,
  CreateProviderInput,
  CreateProviderModelInput,
} from './provider.types';
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

  // --- Upsert methods for seed bootstrap ---

  getProviderByName(name: string): AiProvider | null {
    return this.db.select().from(aiProviders).where(eq(aiProviders.name, name)).get() ?? null;
  }

  upsertProvider(input: CreateProviderInput): AiProvider {
    const id = randomUUID();
    const now = Date.now();
    this.db.insert(aiProviders)
      .values({ id, name: input.name, type: input.type, baseUrl: input.baseUrl, createdAt: now })
      .onConflictDoUpdate({ target: aiProviders.name, set: { type: input.type, baseUrl: input.baseUrl } })
      .run();
    return this.db.select().from(aiProviders).where(eq(aiProviders.name, input.name)).get()!;
  }

  getProviderModelByName(aiProviderId: string, modelName: string): AiProviderModel | null {
    return this.db.select().from(aiProviderModels)
      .where(and(eq(aiProviderModels.aiProviderId, aiProviderId), eq(aiProviderModels.modelName, modelName)))
      .get() ?? null;
  }

  upsertProviderModel(input: CreateProviderModelInput): AiProviderModel {
    const id = randomUUID();
    const now = Date.now();
    this.db.insert(aiProviderModels)
      .values({ id, aiProviderId: input.aiProviderId, modelName: input.modelName, enabled: true, createdAt: now })
      .onConflictDoUpdate({
        target: [aiProviderModels.aiProviderId, aiProviderModels.modelName],
        set: { enabled: true },
      })
      .run();
    return this.db.select().from(aiProviderModels)
      .where(and(eq(aiProviderModels.aiProviderId, input.aiProviderId), eq(aiProviderModels.modelName, input.modelName)))
      .get()!;
  }
}

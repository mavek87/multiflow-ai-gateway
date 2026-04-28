import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import type { DrizzleDb } from '@/db/database';
import { CryptoService } from '@/crypto/crypto';
import { ProviderStore } from '@/provider/provider.store';
import { TenantStore } from '@/tenant/tenant.store';
import { createLogger } from '@/utils/logger';
import type { SeedFile } from './seed.types';

const log = createLogger('SEED');

function resolveSeedPath(seedFilePath: string): string | null {
  if (existsSync(seedFilePath)) return seedFilePath;
  if (seedFilePath.endsWith('.yaml')) {
    const yml = seedFilePath.slice(0, -5) + '.yml';
    if (existsSync(yml)) return yml;
  } else if (seedFilePath.endsWith('.yml')) {
    const yaml = seedFilePath.slice(0, -4) + '.yaml';
    if (existsSync(yaml)) return yaml;
  }
  return null;
}

export function runSeed(db: DrizzleDb, cryptoService: CryptoService, seedFilePath: string): void {
  const resolvedPath = resolveSeedPath(seedFilePath);
  if (!resolvedPath) return;
  seedFilePath = resolvedPath;

  let seed: SeedFile;
  try {
    const raw = readFileSync(seedFilePath, 'utf-8');
    seed = parse(raw) as SeedFile;
  } catch (e) {
    log.error({ err: e }, 'seed: failed to parse seed file');
    throw e;
  }

  if (!seed || typeof seed !== 'object') {
    throw new Error('seed: seed file must be a YAML object');
  }
  if (seed.providers !== undefined && !Array.isArray(seed.providers)) {
    throw new Error('seed: "providers" must be an array');
  }
  if (seed.tenants !== undefined && !Array.isArray(seed.tenants)) {
    throw new Error('seed: "tenants" must be an array');
  }

  const providerStore = new ProviderStore(db);
  const tenantStore = new TenantStore(db);

  // Phase 1: upsert providers and models
  const providerModelIndex = new Map<string, string>();

  for (const entry of seed.providers ?? []) {
    if (!entry.name || !entry.type || !entry.baseUrl) {
      log.warn({ entry }, 'seed: skipping provider entry missing name, type, or baseUrl');
      continue;
    }
    const { provider, op: providerOp } = providerStore.upsertProvider({ name: entry.name, type: entry.type, baseUrl: entry.baseUrl });
    let createdModels = 0;
    for (const modelName of entry.models ?? []) {
      const { model, op: modelOp } = providerStore.upsertProviderModel({ aiProviderId: provider.id, modelName });
      providerModelIndex.set(`${entry.name}:${modelName}`, model.id);
      if (modelOp === 'created') createdModels++;
    }
    log.info(`seed: ${providerOp} provider "${entry.name}" (models created: ${createdModels})`);
  }

  // Phase 2: upsert tenants, credentials, and model priorities
  for (const entry of seed.tenants ?? []) {
    if (!entry.name) {
      log.warn({ entry }, 'seed: skipping tenant entry missing name');
      continue;
    }

    const { tenant: upsertedTenant, rawApiKey, isNew: tenantIsNew } = tenantStore.upsertTenant(entry.name);
    if (tenantIsNew) {
      log.info(`seed: created tenant "${entry.name}" - gateway API key: ${rawApiKey} (save this key, it will not be shown again)`);
    } else {
      log.info(`seed: tenant "${entry.name}" already exists, skipping creation`);
    }

    if (entry.rateLimitDailyRequests !== undefined) {
      tenantStore.updateTenant(upsertedTenant.id, { rateLimitDailyRequests: entry.rateLimitDailyRequests ?? null });
    }

    const tenant = tenantStore.getTenantById(upsertedTenant.id)!;

    for (const providerEntry of entry.providers ?? []) {
      const provider = providerStore.getProviderByName(providerEntry.name);
      if (!provider) {
        log.warn(`seed: provider "${providerEntry.name}" not found, skipping for tenant "${entry.name}"`);
        continue;
      }

      let rawKey: string | undefined;
      let encryptedKey: string | undefined;
      if (providerEntry.apiKeyEnv !== undefined) {
        rawKey = process.env[providerEntry.apiKeyEnv];
        if (!rawKey) {
          log.warn(`seed: env var "${providerEntry.apiKeyEnv}" not set, skipping provider "${providerEntry.name}" for tenant "${entry.name}"`);
          continue;
        }
        encryptedKey = cryptoService.encrypt(rawKey);
      }

      const existingKey = tenantStore.getAiProviderKey(tenant.id, provider.id);
      let keyOp: 'created' | 'updated' | 'unchanged';
      if (!existingKey) {
        keyOp = 'created';
      } else {
        const existingRaw = existingKey.aiProviderApiKeyEncrypted ? cryptoService.decrypt(existingKey.aiProviderApiKeyEncrypted) : null;
        keyOp = existingRaw === (rawKey ?? null) ? 'unchanged' : 'updated';
      }
      tenantStore.upsertAiProviderKey(tenant.id, { aiProviderId: provider.id, aiProviderApiKeyEncrypted: encryptedKey });
      log.info(`seed: ${keyOp} API key for provider "${providerEntry.name}" (tenant: "${entry.name}")`);

      for (const modelEntry of providerEntry.models ?? []) {
        const key = `${providerEntry.name}:${modelEntry.name}`;
        const modelId = providerModelIndex.get(key);
        if (!modelId) {
          log.warn(`seed: model "${modelEntry.name}" not found for provider "${providerEntry.name}", skipping`);
          continue;
        }
        const { op: priorityOp } = tenantStore.upsertAiModelPriority(tenant.id, { aiProviderModelId: modelId, priority: modelEntry.priority });
        log.info(`seed: ${priorityOp} model priority "${modelEntry.name}" (priority: ${modelEntry.priority}, tenant: "${entry.name}")`);
      }
    }
  }

  log.info('seed: seed file applied successfully');
}

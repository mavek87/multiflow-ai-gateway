import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import type { DrizzleDb } from '@/db/database';
import { CryptoService } from '@/crypto/crypto';
import { ProviderStore } from '@/provider/provider.store';
import { TenantStore } from '@/tenant/tenant.store';
import { createLogger } from '@/utils/logger';
import type { SeedFile } from './seed.types';

const log = createLogger('BOOTSTRAP');

export function runBootstrap(db: DrizzleDb, cryptoService: CryptoService, seedFilePath: string): void {
  if (!existsSync(seedFilePath)) return;

  let seed: SeedFile;
  try {
    const raw = readFileSync(seedFilePath, 'utf-8');
    seed = parse(raw) as SeedFile;
  } catch (e) {
    log.error({ err: e }, 'bootstrap: failed to parse seed file');
    throw e;
  }

  if (!seed || typeof seed !== 'object') {
    throw new Error('bootstrap: seed file must be a YAML object');
  }
  if (seed.providers !== undefined && !Array.isArray(seed.providers)) {
    throw new Error('bootstrap: "providers" must be an array');
  }
  if (seed.tenants !== undefined && !Array.isArray(seed.tenants)) {
    throw new Error('bootstrap: "tenants" must be an array');
  }

  const providerStore = new ProviderStore(db);
  const tenantStore = new TenantStore(db);

  // Phase 1: upsert providers and models
  const providerModelIndex = new Map<string, string>();

  for (const entry of seed.providers ?? []) {
    if (!entry.name || !entry.type || !entry.baseUrl) {
      log.warn({ entry }, 'bootstrap: skipping provider entry missing name, type, or baseUrl');
      continue;
    }
    const provider = providerStore.upsertProvider({ name: entry.name, type: entry.type, baseUrl: entry.baseUrl });
    const modelCount = (entry.models ?? []).length;
    for (const modelName of entry.models ?? []) {
      const model = providerStore.upsertProviderModel({ aiProviderId: provider.id, modelName });
      providerModelIndex.set(`${entry.name}:${modelName}`, model.id);
    }
    log.info(`bootstrap: upserted provider ${entry.name} with ${modelCount} models`);
  }

  // Phase 2: upsert tenants, credentials, and model priorities
  for (const entry of seed.tenants ?? []) {
    if (!entry.name) {
      log.warn({ entry }, 'bootstrap: skipping tenant entry missing name');
      continue;
    }

    const { tenant, rawApiKey, isNew } = tenantStore.upsertTenant(entry.name);
    if (isNew) {
      log.info(`bootstrap: created tenant "${entry.name}" - gateway API key: ${rawApiKey}`);
    }

    for (const providerEntry of entry.providers ?? []) {
      const provider = providerStore.getProviderByName(providerEntry.name);
      if (!provider) {
        log.warn(`bootstrap: provider "${providerEntry.name}" not found, skipping for tenant "${entry.name}"`);
        continue;
      }

      let encryptedKey: string | undefined;
      if (providerEntry.apiKeyEnv !== undefined) {
        const rawKey = process.env[providerEntry.apiKeyEnv];
        if (!rawKey) {
          log.warn(`bootstrap: env var "${providerEntry.apiKeyEnv}" not set, skipping provider "${providerEntry.name}" for tenant "${entry.name}"`);
          continue;
        }
        encryptedKey = cryptoService.encrypt(rawKey);
      }

      tenantStore.upsertAiProviderKey(tenant.id, { aiProviderId: provider.id, aiProviderApiKeyEncrypted: encryptedKey });

      for (const modelEntry of providerEntry.models ?? []) {
        const key = `${providerEntry.name}:${modelEntry.name}`;
        const modelId = providerModelIndex.get(key);
        if (!modelId) {
          log.warn(`bootstrap: model "${modelEntry.name}" not found for provider "${providerEntry.name}", skipping`);
          continue;
        }
        tenantStore.upsertAiModelPriority(tenant.id, { aiProviderModelId: modelId, priority: modelEntry.priority });
      }
    }

    log.info(`bootstrap: upserted tenant "${entry.name}"`);
  }

  log.info('bootstrap: seed file applied');
}

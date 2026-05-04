import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { CryptoService } from '@/crypto/crypto';
import { ProviderStore } from '@/provider/provider.store';
import { TenantStore } from '@/tenant/tenant.store';
import { createLogger } from '@/utils/logger';
import type { SeedFile, SeedProviderEntry, SeedTenantEntry, SeedTenantProviderEntry } from './seed.types';

const log = createLogger('SEED');

export function runSeed(providerStore: ProviderStore, tenantStore: TenantStore, cryptoService: CryptoService, seedFilePath: string): void {
  const seedPath = resolveSeedPath(seedFilePath);
  if (!seedPath) return;

  const seedFileContent = parseSeedFile(seedPath);

  const providerModelMap = applyProviders(providerStore, seedFileContent.providers ?? []);
  applyTenants(tenantStore, providerStore, cryptoService, seedFileContent.tenants ?? [], providerModelMap);

  log.info('seed file applied successfully');
}

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

function parseSeedFile(seedFilePath: string): SeedFile {
  let seed: SeedFile;
  try {
    const raw = readFileSync(seedFilePath, 'utf-8');
    seed = parse(raw) as SeedFile;
  } catch (e) {
    log.error({ err: e }, 'failed to parse seed file');
    throw e;
  }

  if (!seed || typeof seed !== 'object') {
    throw new Error('sseed file must be a YAML object');
  }
  if (seed.providers !== undefined && !Array.isArray(seed.providers)) {
    throw new Error('"providers" must be an array');
  }
  if (seed.tenants !== undefined && !Array.isArray(seed.tenants)) {
    throw new Error('"tenants" must be an array');
  }

  return seed;
}

function applyProviders(providerStore: ProviderStore, entries: SeedProviderEntry[]): Map<string, string> {
  const providerModelIndex = new Map<string, string>();

  for (const entry of entries) {
    if (!entry.name || !entry.type || !entry.baseUrl) {
      log.warn({ entry }, 'skipping provider entry missing name, type, or baseUrl');
      continue;
    }
    const { provider, op: providerOp } = providerStore.upsertProvider({ name: entry.name, type: entry.type, baseUrl: entry.baseUrl });
    let createdModels = 0;
    for (const modelName of entry.models ?? []) {
      const { model, op: modelOp } = providerStore.upsertProviderModel({ aiProviderId: provider.id, modelName });
      providerModelIndex.set(`${entry.name}:${modelName}`, model.id);
      if (modelOp === 'created') createdModels++;
    }
    log.info(`${providerOp} provider "${entry.name}" (models created: ${createdModels})`);
  }

  return providerModelIndex;
}

function applyTenants(
  tenantStore: TenantStore,
  providerStore: ProviderStore,
  cryptoService: CryptoService,
  entries: SeedTenantEntry[],
  providerModelIndex: Map<string, string>,
): void {
  for (const entry of entries) {
    if (!entry.name) {
      log.warn({ entry }, 'skipping tenant entry missing name');
      continue;
    }

    const { tenant, rawApiKey, isNew } = tenantStore.upsertTenant(entry.name);
    if (isNew) {
      log.info(`created tenant "${entry.name}" - gateway API key: ${rawApiKey} (save this key, it will not be shown again)`);
    } else {
      log.info(`tenant "${entry.name}" already exists, skipping creation`);
    }

    if (entry.rateLimitDailyRequests !== undefined) {
      tenantStore.updateTenant(tenant.id, { rateLimitDailyRequests: entry.rateLimitDailyRequests ?? null });
    }

    for (const providerEntry of entry.providers ?? []) {
      applyTenantProvider(tenantStore, providerStore, cryptoService, tenant.id, entry.name, providerEntry, providerModelIndex);
    }
  }
}

function applyTenantProvider(
  tenantStore: TenantStore,
  providerStore: ProviderStore,
  cryptoService: CryptoService,
  tenantId: string,
  tenantName: string,
  providerEntry: SeedTenantProviderEntry,
  providerModelIndex: Map<string, string>,
): void {
  const provider = providerStore.getProviderByName(providerEntry.name);
  if (!provider) {
    log.warn(`provider "${providerEntry.name}" not found, skipping for tenant "${tenantName}"`);
    return;
  }

  let rawKey: string | undefined;
  let encryptedKey: string | undefined;
  if (providerEntry.apiKeyEnv !== undefined) {
    rawKey = process.env[providerEntry.apiKeyEnv];
    if (!rawKey) {
      log.warn(`env var "${providerEntry.apiKeyEnv}" not set, skipping provider "${providerEntry.name}" for tenant "${tenantName}"`);
      return;
    }
    encryptedKey = cryptoService.encrypt(rawKey);
  }

  const existingKey = tenantStore.getAiProviderKey(tenantId, provider.id);
  let keyOp: 'created' | 'updated' | 'unchanged';
  if (!existingKey) {
    keyOp = 'created';
  } else {
    const existingRaw = existingKey.aiProviderApiKeyEncrypted ? cryptoService.decrypt(existingKey.aiProviderApiKeyEncrypted) : null;
    keyOp = existingRaw === (rawKey ?? null) ? 'unchanged' : 'updated';
  }
  tenantStore.upsertAiProviderKey(tenantId, { aiProviderId: provider.id, aiProviderApiKeyEncrypted: encryptedKey });
  log.info(`${keyOp} API key for provider "${providerEntry.name}" (tenant: "${tenantName}")`);

  for (const modelEntry of providerEntry.models ?? []) {
    const modelId = providerModelIndex.get(`${providerEntry.name}:${modelEntry.name}`);
    if (!modelId) {
      log.warn(`model "${modelEntry.name}" not found for provider "${providerEntry.name}", skipping`);
      continue;
    }
    const { op: priorityOp } = tenantStore.upsertAiModelPriority(tenantId, { aiProviderModelId: modelId, priority: modelEntry.priority });
    log.info(`${priorityOp} model priority "${modelEntry.name}" (priority: ${modelEntry.priority}, tenant: "${tenantName}")`);
  }
}

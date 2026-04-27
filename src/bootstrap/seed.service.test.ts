import { describe, test, expect, beforeAll, afterEach } from 'bun:test';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createTestContext, ensureTestEncryptionKey } from '@test/test-setup';
import { CryptoService } from '@/crypto/crypto';
import { TenantStore } from '@/tenant/tenant.store';
import { ProviderStore } from '@/provider/provider.store';
import { runSeed } from './seed.service';

beforeAll(() => {
  ensureTestEncryptionKey();
});

describe('runSeed', () => {
  const tempFiles: string[] = [];

  function writeTempYaml(content: string): string {
    const path = `/tmp/seed-test-${randomUUID()}.yaml`;
    writeFileSync(path, content, 'utf-8');
    tempFiles.push(path);
    return path;
  }

  function writeTempYml(content: string): string {
    const path = `/tmp/seed-test-${randomUUID()}.yml`;
    writeFileSync(path, content, 'utf-8');
    tempFiles.push(path);
    return path;
  }

  afterEach(() => {
    for (const file of tempFiles) {
      if (existsSync(file)) unlinkSync(file);
    }
    tempFiles.length = 0;
  });

  test('no-op when file absent', () => {
    const { db } = createTestContext();
    const crypto = new CryptoService();
    expect(() => runSeed(db, crypto, '/nonexistent/path.yaml')).not.toThrow();
    const tenantStore = new TenantStore(db);
    expect(tenantStore.listTenants()).toHaveLength(0);
  });

  test('upserts providers and models', () => {
    const { db, providerStore } = createTestContext();
    const crypto = new CryptoService();
    const path = writeTempYaml(`
providers:
  - name: Groq
    type: groq
    baseUrl: https://api.groq.com/openai/v1
    models:
      - llama3-70b
      - llama3-8b
`);
    runSeed(db, crypto, path);
    const providers = providerStore.listProviders();
    expect(providers).toHaveLength(1);
    expect(providers[0]!.name).toBe('Groq');
    const models = providerStore.listProviderModels(providers[0]!.id);
    expect(models).toHaveLength(2);
    expect(models.map(m => m.modelName)).toContain('llama3-70b');
    expect(models.map(m => m.modelName)).toContain('llama3-8b');
  });

  test('upserts tenant with credential and model priorities', () => {
    const { db, providerStore } = createTestContext();
    const crypto = new CryptoService();
    process.env['TEST_GROQ_KEY'] = 'sk-groq-secret';
    const path = writeTempYaml(`
providers:
  - name: Groq
    type: groq
    baseUrl: https://api.groq.com/openai/v1
    models:
      - llama3-70b
tenants:
  - name: Acme
    providers:
      - name: Groq
        apiKeyEnv: TEST_GROQ_KEY
        models:
          - name: llama3-70b
            priority: 0
`);
    runSeed(db, crypto, path);
    const tenantStore = new TenantStore(db);
    const tenant = tenantStore.getTenantByName('Acme')!;
    expect(tenant).not.toBeNull();
    const keys = tenantStore.listTenantAiProviderKeys(tenant.id);
    expect(keys).toHaveLength(1);
    const priorities = tenantStore.listTenantAiModelPriorities(tenant.id);
    expect(priorities).toHaveLength(1);
    expect(priorities[0]!.priority).toBe(0);
    delete process.env['TEST_GROQ_KEY'];
  });

  test('idempotent on second run', () => {
    const { db, providerStore } = createTestContext();
    const crypto = new CryptoService();
    process.env['TEST_GROQ_KEY'] = 'sk-groq-secret';
    const path = writeTempYaml(`
providers:
  - name: Groq
    type: groq
    baseUrl: https://api.groq.com/openai/v1
    models:
      - llama3-70b
tenants:
  - name: Acme
    providers:
      - name: Groq
        apiKeyEnv: TEST_GROQ_KEY
        models:
          - name: llama3-70b
            priority: 0
`);
    runSeed(db, crypto, path);
    runSeed(db, crypto, path);
    expect(providerStore.listProviders()).toHaveLength(1);
    const tenantStore = new TenantStore(db);
    expect(tenantStore.listTenants()).toHaveLength(1);
    delete process.env['TEST_GROQ_KEY'];
  });

  test('priority update on re-run', () => {
    const { db } = createTestContext();
    const crypto = new CryptoService();
    process.env['TEST_GROQ_KEY'] = 'sk-groq-secret';
    const pathFirst = writeTempYaml(`
providers:
  - name: Groq
    type: groq
    baseUrl: https://api.groq.com/openai/v1
    models:
      - llama3-70b
tenants:
  - name: Acme
    providers:
      - name: Groq
        apiKeyEnv: TEST_GROQ_KEY
        models:
          - name: llama3-70b
            priority: 5
`);
    const pathSecond = writeTempYaml(`
providers:
  - name: Groq
    type: groq
    baseUrl: https://api.groq.com/openai/v1
    models:
      - llama3-70b
tenants:
  - name: Acme
    providers:
      - name: Groq
        apiKeyEnv: TEST_GROQ_KEY
        models:
          - name: llama3-70b
            priority: 10
`);
    runSeed(db, crypto, pathFirst);
    runSeed(db, crypto, pathSecond);
    const tenantStore = new TenantStore(db);
    const tenant = tenantStore.getTenantByName('Acme')!;
    const priorities = tenantStore.listTenantAiModelPriorities(tenant.id);
    expect(priorities[0]!.priority).toBe(10);
    delete process.env['TEST_GROQ_KEY'];
  });

  test('missing apiKeyEnv env var skips credential', () => {
    const { db } = createTestContext();
    const crypto = new CryptoService();
    delete process.env['NONEXISTENT_VAR'];
    const path = writeTempYaml(`
providers:
  - name: Groq
    type: groq
    baseUrl: https://api.groq.com/openai/v1
    models:
      - llama3-70b
tenants:
  - name: Acme
    providers:
      - name: Groq
        apiKeyEnv: NONEXISTENT_VAR
        models:
          - name: llama3-70b
            priority: 0
`);
    runSeed(db, crypto, path);
    const tenantStore = new TenantStore(db);
    const tenant = tenantStore.getTenantByName('Acme')!;
    expect(tenantStore.listTenantAiProviderKeys(tenant.id)).toHaveLength(0);
  });

  test('no apiKeyEnv stores null (no-auth provider)', () => {
    const { db } = createTestContext();
    const crypto = new CryptoService();
    const path = writeTempYaml(`
providers:
  - name: Ollama
    type: ollama
    baseUrl: http://localhost:11434/v1
    models:
      - qwen3-6b
tenants:
  - name: Acme
    providers:
      - name: Ollama
        models:
          - name: qwen3-6b
            priority: 0
`);
    runSeed(db, crypto, path);
    const tenantStore = new TenantStore(db);
    const tenant = tenantStore.getTenantByName('Acme')!;
    const keys = tenantStore.listTenantAiProviderKeys(tenant.id);
    expect(keys).toHaveLength(1);
  });

  test('provider referenced in tenant but not in providers section is skipped', () => {
    const { db } = createTestContext();
    const crypto = new CryptoService();
    const path = writeTempYaml(`
providers: []
tenants:
  - name: Acme
    providers:
      - name: UnknownProvider
        models:
          - name: some-model
            priority: 0
`);
    expect(() => runSeed(db, crypto, path)).not.toThrow();
    const tenantStore = new TenantStore(db);
    const tenant = tenantStore.getTenantByName('Acme')!;
    expect(tenantStore.listTenantAiProviderKeys(tenant.id)).toHaveLength(0);
  });

  test('resolves .yml file when path uses .yaml extension', () => {
    const { db } = createTestContext();
    const crypto = new CryptoService();
    const id = randomUUID();
    const ymlPath = `/tmp/seed-test-${id}.yml`;
    const yamlPath = `/tmp/seed-test-${id}.yaml`;
    writeFileSync(ymlPath, `
providers:
  - name: Groq
    type: groq
    baseUrl: https://api.groq.com/openai/v1
    models:
      - llama3-70b
`, 'utf-8');
    tempFiles.push(ymlPath);
    runSeed(db, crypto, yamlPath);
    const providers = new ProviderStore(db).listProviders();
    expect(providers).toHaveLength(1);
    expect(providers[0]!.name).toBe('Groq');
  });

  test('resolves .yaml file when path uses .yml extension', () => {
    const { db } = createTestContext();
    const crypto = new CryptoService();
    const id = randomUUID();
    const yamlPath = `/tmp/seed-test-${id}.yaml`;
    const ymlPath = `/tmp/seed-test-${id}.yml`;
    writeFileSync(yamlPath, `
providers:
  - name: Ollama
    type: ollama
    baseUrl: http://localhost:11434/v1
    models:
      - qwen3-6b
`, 'utf-8');
    tempFiles.push(yamlPath);
    runSeed(db, crypto, ymlPath);
    const providers = new ProviderStore(db).listProviders();
    expect(providers).toHaveLength(1);
    expect(providers[0]!.name).toBe('Ollama');
  });

  test('no-op when neither .yaml nor .yml exists', () => {
    const { db } = createTestContext();
    const crypto = new CryptoService();
    expect(() => runSeed(db, crypto, '/nonexistent/path.yaml')).not.toThrow();
    const tenantStore = new TenantStore(db);
    expect(tenantStore.listTenants()).toHaveLength(0);
  });

  test('invalid YAML throws', () => {
    const { db } = createTestContext();
    const crypto = new CryptoService();
    const path = writeTempYaml('key: [unclosed bracket');
    expect(() => runSeed(db, crypto, path)).toThrow();
  });

  test('new tenant has API key (isNew path)', () => {
    const { db } = createTestContext();
    const crypto = new CryptoService();
    const path = writeTempYaml(`
tenants:
  - name: Acme
    providers: []
`);
    runSeed(db, crypto, path);
    const tenantStore = new TenantStore(db);
    const tenants = tenantStore.listTenants();
    expect(tenants).toHaveLength(1);
    expect(tenants[0]!.name).toBe('Acme');
  });
});

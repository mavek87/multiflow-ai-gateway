import { db } from '@/db/database';
import { TenantStore } from '@/tenant/tenant.store';
import { ProviderStore } from '@/provider/provider.store';
import { CryptoService } from '@/crypto/crypto';

const cryptoService = new CryptoService();
const store = new TenantStore(db);
const providerStore = new ProviderStore(db);

// --- Providers ---

const groq = providerStore.createProvider({
  name: 'Groq',
  type: 'openai',
  baseUrl: 'https://api.groq.com/openai/v1',
})._unsafeUnwrap();
console.log(`[provider] Groq: ${groq.id}`);

// --- Models ---

const groqModels = [
  { name: 'llama-3.3-70b-versatile', priority: 0 },
  { name: 'llama-3.1-8b-instant',    priority: 1 },
  { name: 'mixtral-8x7b-32768',      priority: 2 },
];

const createdModels: Array<{ id: string; priority: number; name: string }> = [];
for (const m of groqModels) {
  const model = providerStore.createProviderModel({ aiProviderId: groq.id, modelName: m.name })._unsafeUnwrap();
  createdModels.push({ id: model.id, priority: m.priority, name: m.name });
  console.log(`[model] ${m.name}: ${model.id}`);
}

// --- Tenant ---

const { tenant, rawApiKey } = store.createTenant('matteo');
console.log(`[tenant] matteo: ${tenant.id}`);

// --- Credentials ---

const groqApiKey = process.env.GROQ_API_KEY;
if (!groqApiKey) {
  console.error('GROQ_API_KEY not set in .env -- aborting');
  process.exit(1);
}
store.assignAiProviderKey(tenant.id, { aiProviderId: groq.id, aiProviderApiKeyEncrypted: cryptoService.encrypt(groqApiKey) });
console.log(`[credential] Groq key assigned`);

// --- Model priorities ---

for (const m of createdModels) {
  store.assignAiModelPriority(tenant.id, { aiProviderModelId: m.id, priority: m.priority });
  console.log(`[priority ${m.priority}] ${m.name}`);
}

// --- Output for .env ---

console.log('\n### TENANT ###');
console.log(`#${JSON.stringify({ tenantId: tenant.id, name: tenant.name, apiKey: rawApiKey }, null, 2)}`);

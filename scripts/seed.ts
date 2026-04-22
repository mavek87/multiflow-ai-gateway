import { getDb } from '@/db/database';
import { TenantStore } from '@/tenant/tenant-store';

const db = await getDb();
const store = new TenantStore(db);

// --- Providers ---

const groq = store.createProvider({
  name: 'Groq',
  type: 'openai',
  baseUrl: 'https://api.groq.com/openai/v1',
});
console.log(`[provider] Groq: ${groq.id}`);

// --- Models ---

const groqModels = [
  { name: 'llama-3.3-70b-versatile', priority: 0 },
  { name: 'llama-3.1-8b-instant',    priority: 1 },
  { name: 'mixtral-8x7b-32768',      priority: 2 },
];

const createdModels: Array<{ id: string; priority: number; name: string }> = [];
for (const m of groqModels) {
  const model = store.createProviderModel({ aiProviderId: groq.id, modelName: m.name });
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
store.assignAiProviderKey(tenant.id, { aiProviderId: groq.id, apiKey: groqApiKey });
console.log(`[credential] Groq key assigned`);

// --- Model priorities ---

for (const m of createdModels) {
  store.assignAiModelPriority(tenant.id, { aiProviderModelId: m.id, priority: m.priority });
  console.log(`[priority ${m.priority}] ${m.name}`);
}

// --- Output for .env ---

console.log('\n### TENANT ###');
console.log(`#${JSON.stringify({ tenantId: tenant.id, name: tenant.name, apiKey: rawApiKey }, null, 2)}`);

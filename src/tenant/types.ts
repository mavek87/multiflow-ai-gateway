export type Tenant = {
  id: string;
  name: string;
  forceAiProviderId: string | null;
  createdAt: number;
};

export type GatewayApiKey = {
  id: string;
  tenantId: string;
  keyHash: string;
  createdAt: number;
  lastUsedAt: number | null;
};

export type AiProvider = {
  id: string;
  name: string;
  type: string;
  baseUrl: string;
  createdAt: number;
};

export type AiProviderModel = {
  id: string;
  aiProviderId: string;
  modelName: string;
  enabled: boolean;
  createdAt: number;
};

export type TenantAiProviderKey = {
  id: string;
  tenantId: string;
  aiProviderId: string;
  aiProviderApiKeyEncrypted: string | null;
  enabled: boolean;
  createdAt: number;
};

export type TenantAiModelPriority = {
  id: string;
  tenantId: string;
  aiProviderModelId: string;
  priority: number;
  enabled: boolean;
  createdAt: number;
};

export type DecryptedModelConfig = {
  id: string;
  tenantId: string;
  aiProviderModelId: string;
  modelName: string;
  aiProviderId: string;
  aiProviderType: string;
  baseUrl: string;
  priority: number;
  apiKeyPlain: string | null;
};

export type CreateProviderInput = {
  name: string;
  type: string;
  baseUrl: string;
};

export type CreateProviderModelInput = {
  aiProviderId: string;
  modelName: string;
};

export type AssignAiProviderKeyInput = {
  aiProviderId: string;
  apiKey?: string;
};

export type AssignAiModelPriorityInput = {
  aiProviderModelId: string;
  priority?: number;
};

export type UpdateTenantInput = {
  forceAiProviderId?: string | null;
};

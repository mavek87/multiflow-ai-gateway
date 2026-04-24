export type TenantModelConfigError =
    | { code: 'no_providers' }
    | { code: 'model_not_found'; model: string };

export interface TenantModelConfig {
    tenantId: string;
    requestedModel?: string;
    forceAiProviderId?: string | null;
}

export type Tenant = {
  id: string;
  name: string;
  forceAiProviderId: string | null;
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
  aiProviderName: string;
  aiProviderType: string;
  baseUrl: string;
  priority: number;
  apiKeyPlain: string | null;
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
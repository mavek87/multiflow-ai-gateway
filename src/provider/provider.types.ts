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

export type CreateProviderInput = {
  name: string;
  type: string;
  baseUrl: string;
};

export type CreateProviderModelInput = {
  aiProviderId: string;
  modelName: string;
};

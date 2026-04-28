export type SeedProviderEntry = {
  name: string;
  type: string;
  baseUrl: string;
  models: string[];
};

export type SeedTenantModelEntry = {
  name: string;
  priority: number;
};

export type SeedTenantProviderEntry = {
  name: string;
  apiKeyEnv?: string;
  models: SeedTenantModelEntry[];
};

export type SeedTenantEntry = {
  name: string;
  rateLimitDailyRequests?: number | null;
  providers: SeedTenantProviderEntry[];
};

export type SeedFile = {
  providers?: SeedProviderEntry[];
  tenants?: SeedTenantEntry[];
};

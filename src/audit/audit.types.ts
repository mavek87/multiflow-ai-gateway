export type AuditLogEntry = {
  tenantId: string;
  aiProvider: { id: string; name: string };
  model: string;
  latencyMs: number;
  success: boolean;
  statusCode: number;
};

export type AuditRecord = {
  id: string;
  tenantId: string;
  ts: number;
  model: string;
  aiProviderId: string;
  aiProviderName: string;
  latencyMs: number;
  success: boolean;
  statusCode: number;
};

export type AuditQueryParams = {
  tenantId?: string;
  from?: number;
  to?: number;
  limit?: number;
  offset?: number;
};

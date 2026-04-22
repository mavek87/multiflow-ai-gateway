function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const config = {
  port: parseInt(optional('PORT', '3000'), 10),
  masterKey: required('MASTER_KEY'),
  dbPath: optional('DB_PATH', './data/gateway.db'),
  auditLogPath: optional('AUDIT_LOG_PATH', './logs/audit.jsonl'),
} as const;

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '@/config/config';

type AuditEntry = {
  tenantId: string;
  aiProvider: { id: string; name: string };
  model: string;
  latencyMs: number;
  success: boolean;
  statusCode: number;
};

let dirEnsured = false;

function ensureDir(): void {
  if (dirEnsured) return;
  mkdirSync(dirname(config.auditLogPath), { recursive: true });
  dirEnsured = true;
}

export function logAudit(entry: AuditEntry): void {
  ensureDir();
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
  // Fire-and-forget - synchronous append is fine for MVP (one file, low volume)
  try {
    appendFileSync(config.auditLogPath, line, 'utf8');
  } catch {
    // Non-fatal: audit log failure must not break the request
  }
}

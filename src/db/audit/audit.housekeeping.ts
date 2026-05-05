import type { AuditStore } from '@/db/audit/audit.store';
import { createLogger } from '@/utils/logger';

const log = createLogger('HOUSEKEEPING');
const INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export function startHousekeeping(auditStore: AuditStore, retentionDays: number): void {
  const retentionMs = retentionDays * 24 * 60 * 60 * 1000;

  setInterval(() => {
    try {
      const cutoff = Date.now() - retentionMs;
      auditStore.deleteOlderThan(cutoff);
      log.debug(`Deleted audit records older than ${retentionDays} days`);
    } catch (err) {
      log.error({ err }, 'Housekeeping cleanup failed');
    }
  }, INTERVAL_MS);
}

import type { SelectorType } from '@/engine/selection/selector.types';

const VALID_SELECTOR_TYPES: SelectorType[] = ['thompson', 'ucb1-tuned', 'sw-ucb1-tuned'];

function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function selectorType(): SelectorType {
  const val = optional('SELECTOR_TYPE', 'ucb1-tuned');
  if (!VALID_SELECTOR_TYPES.includes(val as SelectorType)) {
    throw new Error(`Invalid SELECTOR_TYPE "${val}". Valid values: ${VALID_SELECTOR_TYPES.join(', ')}`);
  }
  return val as SelectorType;
}

export const config = {
  port: parseInt(optional('PORT', '3000'), 10),
  masterKey: required('MASTER_KEY'),
  dbPath: optional('DB_PATH', './data/gateway.db'),
  auditLogPath: optional('AUDIT_LOG_PATH', './logs/audit.jsonl'),
  selectorType: selectorType(),
} as const;

import type { ModelSelectorType } from '@/engine/selection/model-selector.types';

const VALID_SELECTOR_TYPES: ModelSelectorType[] = ['thompson', 'ucb1-tuned', 'sw-ucb1-tuned'];

function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function selectorType(): ModelSelectorType {
  const val = optional('SELECTOR_TYPE', 'ucb1-tuned');
  if (!VALID_SELECTOR_TYPES.includes(val as ModelSelectorType)) {
    throw new Error(`Invalid SELECTOR_TYPE "${val}". Valid values: ${VALID_SELECTOR_TYPES.join(', ')}`);
  }
  return val as ModelSelectorType;
}

export const config = {
  port: parseInt(optional('PORT', '13000'), 10),
  masterKey: required('MASTER_KEY'),
  dbPath: optional('DB_PATH', './data/gateway.db'),
  auditRetentionDays: parseInt(optional('AUDIT_RETENTION_DAYS', '90'), 10),
  selectorType: selectorType(),
  providerStreamFirstTokenTimeoutMs: parseInt(optional('PROVIDER_STREAM_FIRST_TOKEN_TIMEOUT_MS', '300000'), 10), // 5 minutes
  providerRequestTimeoutMs: parseInt(optional('PROVIDER_REQUEST_TIMEOUT_MS', '600000'), 10), // 10 minutes
  seedFile: optional('SEED_FILE', './seed.yaml'),
  metricsWarmUpWindowMs: parseInt(optional('METRICS_WARM_UP_WINDOW_MS', '3600000'), 10),
} as const;

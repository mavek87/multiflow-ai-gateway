import { randomBytes, createHash } from 'node:crypto';

const PREFIX = 'gw_';

/** Generates a cryptographically random API key: gw_<32 random bytes base64url> */
export function generateApiKey(): string {
  return PREFIX + randomBytes(32).toString('base64url');
}

/** SHA-256 hex digest of the raw key - fast, keys are already high-entropy */
export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

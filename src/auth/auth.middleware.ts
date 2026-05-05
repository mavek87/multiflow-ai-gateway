import {Elysia} from 'elysia';
import {bearer} from '@elysiajs/bearer';
import { timingSafeEqual } from 'node:crypto';
import { config } from '@/config/config';
import type {TenantStore} from '@/tenant/tenant.store';
import type {Tenant} from '@/tenant/tenant.types';
import {unauthorizedResponse, forbiddenResponse} from '@/utils/http';

export const tenantAuthPlugin = (tenantStore: TenantStore) => (app: Elysia) => app
    .use(bearer())
    .derive(({bearer}) => {
        return {
            tenant: extractTenant(bearer ?? '', tenantStore)
        };
    })
    .onBeforeHandle(({tenant}) => {
        if (!tenant) return unauthorizedResponse();
    });

function extractTenant(apiKey: string, tenantStore: TenantStore): Tenant | null {
    if (!apiKey.startsWith('gw_')) return null;
    return tenantStore.getTenantByApiKey(apiKey);
}

/**
 * Checks if the x-master-key header matches the configured master key.
 * Used for admin endpoints.
 */
export function checkMasterKey(headers: Record<string, string | undefined>): Response | undefined {
  const key = headers['x-master-key'];
  if (!key) return forbiddenResponse();
  
  const providedKey = Buffer.from(key);
  const masterKey = Buffer.from(config.masterKey);

  if (providedKey.length !== masterKey.length || !timingSafeEqual(providedKey, masterKey)) {
    return forbiddenResponse();
  }
}

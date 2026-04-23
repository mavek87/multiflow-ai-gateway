import {Elysia} from 'elysia';
import { timingSafeEqual } from 'node:crypto';
import { config } from '@/config/config';
import type {TenantStore} from '@/tenant/tenant.store';
import type {Tenant} from '@/tenant/tenant.types';
import {unauthorizedResponse, forbiddenResponse} from '@/utils/http';

export const tenantAuthPlugin = (tenantStore: TenantStore) => (app: Elysia) => app
    .derive(({headers}) => {
        return {
            tenant: extractTenant(headers['authorization'] ?? '', tenantStore)
        };
    })
    .onBeforeHandle(({tenant}) => {
        if (!tenant) return unauthorizedResponse();
    });

export function extractTenant(authorization: string, tenantStore: TenantStore): Tenant | null {
    if (!authorization.startsWith('Bearer ')) return null;
    const apiKey = authorization.slice(7);
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
  
  const a = Buffer.from(key);
  const b = Buffer.from(config.masterKey);
  
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return forbiddenResponse();
  }
}

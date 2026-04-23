import {Elysia} from 'elysia';
import type {TenantStore} from '@/tenant/tenant-store';
import type {Tenant} from '@/tenant/types';
import {unauthorizedResponse} from '@/utils/http';

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

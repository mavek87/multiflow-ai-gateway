import { createTestContext } from '@test/test-setup';
import { CryptoService } from '@/crypto/crypto';

export function setupTenantStoreContext() {
  const context = createTestContext();
  const cryptoService = new CryptoService();
  return { ...context, cryptoService };
}

export function createTenant(tenantStore: any, name: string = 'Acme') {
  return tenantStore.createTenant(name);
}

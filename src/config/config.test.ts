import { test, expect, describe } from 'bun:test';

describe('Config', () => {
  const checkScript = 'src/config/config-check.ts';

  test('throws if MASTER_KEY is missing', () => {
    const proc = Bun.spawnSync(['bun', checkScript], {
      env: { ...process.env, MASTER_KEY: '' }
    });
    expect(proc.success).toBe(false);
    expect(proc.stderr.toString()).toContain('Missing required environment variable: MASTER_KEY');
  });

  test('validates SELECTOR_TYPE', () => {
    const proc = Bun.spawnSync(['bun', checkScript], {
      env: { ...process.env, MASTER_KEY: 'test', SELECTOR_TYPE: 'invalid' }
    });
    expect(proc.success).toBe(false);
    expect(proc.stderr.toString()).toContain('Invalid SELECTOR_TYPE "invalid"');
  });

  test('loads values from environment', () => {
    const proc = Bun.spawnSync(['bun', checkScript], {
      env: { 
        ...process.env, 
        MASTER_KEY: 'key123', 
        PORT: '4000',
        SELECTOR_TYPE: 'thompson'
      }
    });
    expect(proc.success).toBe(true);
    const config = JSON.parse(proc.stdout.toString());
    expect(config.port).toBe(4000);
    expect(config.masterKey).toBe('key123');
    expect(config.selectorType).toBe('thompson');
  });
});

import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '@/config/config';
import { createLogger } from '@/utils/logger';
import * as schema from './schema/index';

const log = createLogger('DB');

export type DrizzleDb = BunSQLiteDatabase<typeof schema>;

mkdirSync(dirname(config.dbPath), { recursive: true });

const sqlite = new Database(config.dbPath, { create: true });
sqlite.run('PRAGMA journal_mode=WAL');
sqlite.run('PRAGMA foreign_keys=ON');

export const db = drizzle(sqlite, { schema });

try {
    migrate(db, { migrationsFolder: './drizzle' });
    log.info(`Database initialized and migrated: ${config.dbPath}`);
} catch (error) {
    log.error({ 
        path: config.dbPath, 
        error: error instanceof Error ? error.message : String(error) 
    }, 'CRITICAL: Database migration failed');
    process.exit(1);
}
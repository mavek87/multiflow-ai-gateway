import {drizzle} from 'drizzle-orm/bun-sqlite';
import {migrate} from 'drizzle-orm/bun-sqlite/migrator';
import {Database} from 'bun:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {config} from '@/config/config';
import {createLogger} from '@/utils/logger';
import * as schema from './schema';

const log = createLogger('DB');

export type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

let _dbPromise: Promise<DrizzleDb> | null = null;

export async function getDb(): Promise<DrizzleDb> {
    if (!_dbPromise) {
        _dbPromise = initDb();
    }
    return _dbPromise;
}

async function initDb(): Promise<DrizzleDb> {
    try {
        mkdirSync(dirname(config.dbPath), {recursive: true});

        const sqlite = new Database(config.dbPath, {create: true});
        sqlite.run('PRAGMA journal_mode=WAL');
        sqlite.run('PRAGMA foreign_keys=ON');

        const db = drizzle(sqlite, {schema});
        migrate(db, {migrationsFolder: './drizzle'});

        log.info(`SQLite connected and migrated: ${config.dbPath}`);
        return db;
    } catch (error) {
        log.error({
            path: config.dbPath,
            error: error instanceof Error ? error.message : String(error)
        }, 'Database initialization failed');
        _dbPromise = null;
        throw error;
    }
}
import type {BunSQLiteDatabase} from 'drizzle-orm/bun-sqlite';
import * as schema from './schema/index';

export type DrizzleDb = BunSQLiteDatabase<typeof schema>;

import type {BunSQLiteDatabase} from 'drizzle-orm/bun-sqlite';
import * as schema from '@/db/schema/index';

export type DrizzleDb = BunSQLiteDatabase<typeof schema>;

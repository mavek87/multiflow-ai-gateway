import { describe, it, expect, mock } from "bun:test";
import * as fs from "node:fs";
import { Database } from "bun:sqlite";
import { getDb } from "./database";

mock.module("bun:sqlite", () => ({
    Database: mock(() => ({
        run: mock(),
    }))
}));

mock.module("node:fs", () => ({
    mkdirSync: mock(),
}));

mock.module("drizzle-orm/bun-sqlite/migrator", () => ({
    migrate: mock(),
}));

describe("Database", () => {
    it("should initialize exactly once and apply pragmas", async () => {
        const db1 = await getDb();
        const db2 = await getDb();
        
        expect(db1).toBe(db2);
        expect(fs.mkdirSync).toHaveBeenCalled();

        const { Database: MockDb } = await import("bun:sqlite");
        const dbInstance = (MockDb as any).mock.results[0].value;
        expect(dbInstance.run).toHaveBeenCalledWith("PRAGMA journal_mode=WAL");
        expect(dbInstance.run).toHaveBeenCalledWith("PRAGMA foreign_keys=ON");
    });
});

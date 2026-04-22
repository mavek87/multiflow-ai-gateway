import {describe, expect, it, mock} from "bun:test";
import * as fs from "node:fs";
import {getDb} from "./database";

mock.module("bun:sqlite", () => ({
    Database: mock(function() {
        return {
            run: mock(),
            close: mock()
        };
    })
}));

mock.module("node:fs", () => ({
    mkdirSync: mock(),
    dirname: mock(() => "/tmp"),
}));

mock.module("drizzle-orm/bun-sqlite", () => ({
    drizzle: mock(() => ({})),
}));

mock.module("drizzle-orm/bun-sqlite/migrator", () => ({
    migrate: mock(),
}));

describe("Database", () => {
    it("should initialize exactly once and return the same instance", async () => {
        const db1 = await getDb();
        const db2 = await getDb();
        
        expect(db1).toBe(db2);
        expect(fs.mkdirSync).toHaveBeenCalled();
    });

    it("should use correct SQLite pragmas during initialization", async () => {
        const { Database: MockDb } = await import("bun:sqlite");
        await getDb();
        
        const dbInstance = (MockDb as any).mock.results[0].value;
        expect(dbInstance.run).toHaveBeenCalledWith("PRAGMA journal_mode=WAL");
        expect(dbInstance.run).toHaveBeenCalledWith("PRAGMA foreign_keys=ON");
    });
});

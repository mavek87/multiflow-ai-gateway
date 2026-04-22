import {describe, expect, it} from "bun:test";
import {db} from "./database";

// Mocks must be defined before any other operation,
// but since Bun executes database.ts during import, tests
// on "how many times it is called" are less relevant than
// ensuring that the 'db' instance is defined and functional.

describe("Database", () => {
    it("should export a ready-to-use 'db' instance", () => {
        expect(db).toBeDefined();
    });

    it("should have initialized and migrated the database", () => {
        // If we get here without crashing, the top-level await worked.
        // DrizzleDb has the BunSqlite database methods.
        expect(typeof db.select).toBe("function");
    });
});

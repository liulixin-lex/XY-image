import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  type MigrationClient,
  migrate,
  readMigrations,
} from "./selfhost-migrations.js";
const migration = {
  version: "20261009000001",
  name: "20261009000001_example.sql",
  sql: "CREATE TABLE example(id int)",
  checksum: "abc",
};
function client(
  options: {
    history?: Record<string, unknown>[];
    existing?: boolean;
    fail?: boolean;
    locked?: boolean;
  } = {},
) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("pg_available_extensions"))
      return { rows: [{ ok: true }] };
    if (sql.includes("pg_try_advisory_lock"))
      return { rows: [{ locked: options.locked ?? true }] };
    if (sql.includes("AS ledger"))
      return {
        rows: [
          { ledger: !!options.history, existing: options.existing ?? false },
        ],
      };
    if (sql.startsWith("SELECT version"))
      return { rows: options.history ?? [] };
    if (sql === migration.sql && options.fail)
      throw new Error("secret database payload");
    return { rows: [] };
  });
  return { query } as MigrationClient & { query: typeof query };
}
describe("selfhost migration ledger", () => {
  it("validates all repository migrations without applying them", async () => {
    const files = await readMigrations(
      fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url)),
    );
    expect(files.length).toBeGreaterThanOrEqual(32);
    expect(new Set(files.map((f) => f.version)).size).toBe(files.length);
  });
  it("status is read-only and releases the session lock", async () => {
    const db = client();
    expect(await migrate(db, [migration], false)).toMatchObject({
      applied: 0,
      pending: [migration.name],
    });
    expect(db.query.mock.calls.some(([s]) => s.startsWith("CREATE"))).toBe(
      false,
    );
    expect(db.query.mock.calls.at(-1)?.[0]).toContain("pg_advisory_unlock");
  });
  it("commits ledger and migration together and skips a second application", async () => {
    const db = client();
    expect(await migrate(db, [migration], true)).toEqual({
      applied: 1,
      pending: [],
    });
    const sql = db.query.mock.calls.map(([s]) => s);
    expect(sql.indexOf("BEGIN")).toBeLessThan(sql.indexOf(migration.sql));
    expect(
      sql.findIndex((s) => s.startsWith("INSERT INTO xy_ops")),
    ).toBeLessThan(sql.indexOf("COMMIT"));
    const repeat = client({ history: [migration] });
    await migrate(repeat, [migration], true);
    expect(repeat.query.mock.calls.some(([s]) => s === migration.sql)).toBe(
      false,
    );
  });
  it("rolls back and sanitizes a failed migration", async () => {
    const db = client({ fail: true });
    await expect(migrate(db, [migration], true)).rejects.toThrow(
      `Migration failed and rolled back: ${migration.name}`,
    );
    expect(db.query).toHaveBeenCalledWith("ROLLBACK");
    expect(db.query).not.toHaveBeenCalledWith("COMMIT");
  });
  it("rejects drift, unknown schema and concurrent execution", async () => {
    await expect(
      migrate(
        client({ history: [{ ...migration, checksum: "changed" }] }),
        [migration],
        true,
      ),
    ).rejects.toThrow("history mismatch");
    await expect(
      migrate(client({ existing: true }), [migration], true),
    ).rejects.toThrow("baseline audit");
    await expect(
      migrate(client({ locked: false }), [migration], true),
    ).rejects.toThrow("Another migration");
  });
});

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
export type Migration = {
  version: string;
  name: string;
  sql: string;
  checksum: string;
};
export interface MigrationClient {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
}
export async function readMigrations(directory: string): Promise<Migration[]> {
  const files = (await readdir(directory))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const versions = new Set<string>();
  return Promise.all(
    files.map(async (name) => {
      const version = /^(\d{14})_[a-z0-9_]+\.sql$/.exec(name)?.[1];
      if (!version || versions.has(version))
        throw new Error("Invalid or duplicate migration version");
      versions.add(version);
      const sql = await readFile(path.join(directory, name), "utf8");
      // These migrations run as one transaction. Standalone transaction controls are unsupported.
      if (
        /^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im.test(sql) ||
        /CREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY/i.test(sql)
      )
        throw new Error(`Non-transactional migration: ${name}`);
      return {
        version,
        name,
        sql,
        checksum: createHash("sha256").update(sql).digest("hex"),
      };
    }),
  );
}
export async function migrate(
  db: MigrationClient,
  migrations: Migration[],
  apply: boolean,
) {
  const { rows: prereq } = await db.query(`SELECT
    to_regnamespace('auth') IS NOT NULL AND to_regnamespace('storage') IS NOT NULL
    AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')
    AND EXISTS (SELECT 1 FROM pg_available_extensions WHERE name='pgmq') AS ok`);
  if (!prereq[0]?.ok)
    throw new Error(
      "Supabase Auth/Storage/roles or pgmq extension unavailable",
    );
  const { rows: lock } = await db.query(
    "SELECT pg_try_advisory_lock(903, 1) AS locked",
  );
  if (!lock[0]?.locked) throw new Error("Another migration is running");
  try {
    const { rows: state } = await db.query(
      "SELECT to_regclass('xy_ops.schema_migrations') IS NOT NULL AS ledger, to_regclass('public.workspaces') IS NOT NULL AS existing",
    );
    if (!state[0]?.ledger && state[0]?.existing)
      throw new Error(
        "Existing application schema has no verified ledger; baseline audit required",
      );
    const applied = state[0]?.ledger
      ? (
          await db.query(
            "SELECT version, name, checksum FROM xy_ops.schema_migrations ORDER BY version",
          )
        ).rows
      : [];
    for (const record of applied) {
      const file = migrations.find((m) => m.version === record.version);
      if (
        !file ||
        file.checksum !== record.checksum ||
        file.name !== record.name
      )
        throw new Error(`Migration history mismatch: ${record.version}`);
    }
    const last = String(applied.at(-1)?.version ?? "");
    const pending = migrations.filter(
      (m) => !applied.some((a) => a.version === m.version),
    );
    if (pending.some((m) => m.version < last))
      throw new Error("Out-of-order migration requires review");
    if (!apply)
      return { applied: applied.length, pending: pending.map((m) => m.name) };
    await db.query(`CREATE SCHEMA IF NOT EXISTS xy_ops;
      REVOKE ALL ON SCHEMA xy_ops FROM PUBLIC, anon, authenticated;
      CREATE TABLE IF NOT EXISTS xy_ops.schema_migrations (
        version text PRIMARY KEY, name text NOT NULL, checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now());
      REVOKE ALL ON xy_ops.schema_migrations FROM PUBLIC, anon, authenticated`);
    for (const file of pending) {
      await db.query("BEGIN");
      try {
        await db.query(
          "SET LOCAL lock_timeout = '10s'; SET LOCAL statement_timeout = '120s'",
        );
        await db.query(file.sql);
        await db.query(
          "INSERT INTO xy_ops.schema_migrations (version, name, checksum) VALUES ($1,$2,$3)",
          [file.version, file.name, file.checksum],
        );
        await db.query("COMMIT");
        console.log(`[migrate] Applied ${file.name}`);
      } catch {
        await db.query("ROLLBACK");
        // SQL errors may include row data. Expose only the file; investigate privately.
        throw new Error(`Migration failed and rolled back: ${file.name}`);
      }
    }
    await db.query("NOTIFY pgrst, 'reload schema'");
    return { applied: applied.length + pending.length, pending: [] };
  } finally {
    await db.query("SELECT pg_advisory_unlock(903, 1)");
  }
}

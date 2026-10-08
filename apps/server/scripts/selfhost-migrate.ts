import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate, readMigrations } from "./selfhost-migrations.js";
const mode = process.argv[2];
if (mode !== "status" && mode !== "apply") {
  console.error("Usage: selfhost-migrate.ts status|apply");
  process.exitCode = 1;
} else if (!process.env.SUPABASE_DB_URL) {
  console.error("SUPABASE_DB_URL is required");
  process.exitCode = 1;
} else {
  const db = new pg.Client({
    connectionString: process.env.SUPABASE_DB_URL,
    connectionTimeoutMillis: 10_000,
  });
  try {
    const files = await readMigrations(
      fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url)),
    );
    await db.connect();
    console.log(JSON.stringify(await migrate(db, files, mode === "apply")));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const safe =
      /^(Supabase Auth|Another migration|Existing application|Migration history|Out-of-order|Non-transactional|Invalid or duplicate|Migration failed)/.test(
        message,
      );
    console.error(
      `[migrate] ${safe ? message : "Connection or migration check failed; credentials are not logged"}`,
    );
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}

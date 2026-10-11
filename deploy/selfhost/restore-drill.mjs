// Restore drill (FINDINGS O1): proves a backup can be restored, without
// touching the running deployment.
//   1. verify-backup.mjs (manifest and checksums);
//   2. a throwaway container from the backup's own database image, with no
//      network, initialised like a fresh Supabase database;
//   3. roles.sql, then pg_restore --clean --if-exists of postgres.dump;
//   4. row counts of the tables that matter, next to the live database's
//      (live may be ahead: rows written after the backup);
//   5. project-assets objects in the restored storage.objects next to the
//      files in storage.tar.gz;
//   6. the container is removed (--keep leaves it for inspection).
// Prints one JSON summary; exit 1 when a check fails. Nothing is written to
// the deployment; the live side is read with SELECT count(*) only.
//
// Usage: node deploy/selfhost/restore-drill.mjs --backup <dir> --dir <deployment> [--keep]
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const here = path.dirname(fileURLToPath(import.meta.url));
const TABLES = [
  "auth.users",
  "public.workspaces",
  "public.projects",
  "public.canvases",
  "public.chat_sessions",
  "public.chat_messages",
  "public.background_jobs",
  "public.asset_objects",
  "public.brand_kits",
  "public.xy2api_accounts",
  "public.xy2api_api_keys",
  "storage.objects",
];

function run(command, args, { input, capture = true } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      if (capture && out.length < 5_000_000) out += chunk;
    });
    child.stderr.on("data", (chunk) => {
      if (err.length < 200_000) err += chunk;
    });
    if (input) createReadStream(input).pipe(child.stdin);
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out, err }));
  });
}

async function main() {
  const { values } = parseArgs({
    options: {
      backup: { type: "string" },
      dir: { type: "string" },
      keep: { type: "boolean", default: false },
    },
  });
  if (!values.backup || !values.dir)
    throw new Error("Required: --backup <backup dir> --dir <deployment>");
  const backup = path.resolve(values.backup);
  const dir = path.resolve(values.dir);
  const summary = { backup, checks: {} };

  const verify = await run(process.execPath, [path.join(here, "verify-backup.mjs"), backup]);
  summary.checks.checksums = verify.code === 0;
  if (verify.code !== 0) throw new Error("verify-backup failed");
  const manifest = JSON.parse(await readFile(path.join(backup, "manifest.json"), "utf8"));
  summary.backupCreatedAt = manifest.createdAt;
  summary.mode = manifest.mode ?? "maintenance";
  const compose = JSON.parse(await readFile(path.join(backup, "compose.json"), "utf8"));
  const image = compose.services?.db?.image;
  if (!image) throw new Error("No database image in compose.json");
  summary.image = image;

  const name = `xy-restore-drill-${Date.now()}`;
  const password = randomBytes(24).toString("hex");
  const started = await run("docker", [
    "run", "-d", "--name", name, "--network", "none",
    "-e", `POSTGRES_PASSWORD=${password}`,
    image,
  ]);
  if (started.code !== 0) throw new Error("Could not start the drill database");
  const exec = (args, options) => run("docker", ["exec", ...(options?.input ? ["-i"] : []), name, ...args], options);
  const psql = (sql) => exec(["psql", "-U", "supabase_admin", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql]);
  try {
    // The image runs its init scripts, restarts once, then accepts logins.
    let ready = false;
    for (let attempt = 0; attempt < 90 && !ready; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const probe = await psql("select count(*) from pg_roles where rolname = 'authenticator'");
      ready = probe.code === 0 && probe.out.trim() === "1";
    }
    if (!ready) throw new Error("Drill database did not initialise in 3 minutes");

    const roles = await exec(["psql", "-U", "supabase_admin", "-d", "postgres", "-q"], { input: path.join(backup, "roles.sql") });
    // Roles the init already created report "already exists"; anything else is a finding.
    summary.rolesErrors = roles.err
      .split("\n")
      .filter((line) => /ERROR/.test(line) && !/already exists/.test(line)).length;

    const restoreStarted = Date.now();
    const restored = await exec(
      ["pg_restore", "-U", "supabase_admin", "-d", "postgres", "--clean", "--if-exists", "--no-password"],
      { input: path.join(backup, "postgres.dump"), capture: false },
    );
    const errors = restored.err.split("\n").filter((line) => /error:/i.test(line));
    summary.restore = {
      exit: restored.code,
      seconds: Math.round((Date.now() - restoreStarted) / 1000),
      errors: errors.length,
      // Object names only, for the report; no data is in these lines.
      sampleErrors: errors.slice(0, 5).map((line) => line.slice(0, 200)),
    };

    const counts = {};
    for (const table of TABLES) {
      const drill = await psql(`select count(*) from ${table}`);
      const live = await run("docker", [
        "compose", "--project-directory", dir, "--env-file", path.join(dir, ".env"),
        "-f", path.join(dir, "compose.json"),
        "exec", "-T", "db", "psql", "-U", "postgres", "-d", "postgres", "-At", "-c", `select count(*) from ${table}`,
      ]);
      counts[table] = {
        restored: drill.code === 0 ? Number(drill.out.trim()) : null,
        live: live.code === 0 ? Number(live.out.trim()) : null,
      };
    }
    summary.counts = counts;
    const missing = Object.entries(counts).filter(
      ([, c]) => c.restored === null || (c.live > 0 && c.restored === 0) || (c.live !== null && c.restored > c.live),
    );
    summary.checks.tables = missing.length === 0;
    if (missing.length) summary.tableProblems = missing.map(([table]) => table);

    const objects = await psql("select count(*) from storage.objects where bucket_id = 'project-assets'");
    const listing = await run("tar", ["-tzf", path.join(backup, "storage.tar.gz")]);
    const files = listing.out
      .split("\n")
      .filter((line) => /\/project-assets\/.+[^/]$/.test(line)).length;
    summary.storage = { objects: Number(objects.out.trim()), files };
    // Each object is one file (its version) in the file backend; extra files
    // are objects uploaded after the dump (hot backups archive Storage last).
    summary.checks.storage = files >= Number(objects.out.trim());
  } finally {
    if (!values.keep) await run("docker", ["rm", "-f", "-v", name]);
    else summary.container = name;
  }
  summary.ok = Object.values(summary.checks).every(Boolean);
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[restore-drill] ${error.message}`);
  process.exitCode = 1;
});

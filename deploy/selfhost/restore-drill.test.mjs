import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createTestDirectory } from "./test-sandbox.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const docker = String.raw`#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const mode = process.env.TEST_DRILL_MODE;
const previous = fs.existsSync(process.env.TEST_DOCKER_LOG)
  ? fs.readFileSync(process.env.TEST_DOCKER_LOG, "utf8").trim().split("\n").map(JSON.parse)
  : [];
fs.appendFileSync(process.env.TEST_DOCKER_LOG, JSON.stringify(args) + "\n");
function fail(message, code = 1) {
  process.stderr.write(message + "\n");
  process.exitCode = code;
}
if (args[0] === "run") {
  process.stdout.write("disposable-container\n");
} else if (args[0] === "rm") {
  process.stdout.write("removed\n");
} else if (args.includes("/proc/1/comm")) {
  const probes = previous.filter((a) => a.includes("/proc/1/comm")).length;
  process.stdout.write(mode === "initialising" && probes === 0 ? "bash\n" : ".postgres-wrapp\n");
} else if (args.includes("pg_restore")) {
  if (mode === "early-exit") process.exit(9);
  process.stdin.resume();
  if (mode === "restore-exit") process.exitCode = 9;
  if (mode === "restore-error") fail("pg_restore: error: synthetic restore failure", 0);
} else if (args.includes("psql")) {
  const sql = args.includes("-c") ? args[args.indexOf("-c") + 1] : "";
  if (!sql) {
    process.stdin.resume();
    if (mode === "roles-error") fail('psql:<stdin>:2: ERROR: permission denied', 0);
    else if (mode === "roles-other-duplicate") fail('psql:<stdin>:2: ERROR: relation "unexpected" already exists', 0);
    else if (mode === "roles-fatal") fail('psql: FATAL: database unavailable', 0);
    else if (mode === "roles-exit") process.exitCode = 9;
    else fail('psql:<stdin>:1: ERROR: role "authenticator" already exists', 0);
  } else if (sql.startsWith("CREATE DATABASE")) {
    if (mode === "create-error") fail("ERROR: cannot create database");
  } else if (sql.includes("pg_roles")) {
    process.stdout.write("1\n");
  } else if (sql.includes("where bucket_id")) {
    if (mode === "storage-query-error") fail("ERROR: storage unavailable");
    else process.stdout.write("2\n");
  } else if (args[0] === "compose" && mode === "live-query-error") {
    fail("ERROR: live database unavailable");
  } else if (mode === "invalid-count") {
    process.stdout.write("not-a-count\n");
  } else if (mode !== "empty-count") {
    process.stdout.write(args[0] === "compose" ? "3\n" : "2\n");
  }
} else {
  fail("Unexpected docker invocation", 99);
}
`;
const tar = String.raw`#!/usr/bin/env node
if (process.env.TEST_DRILL_MODE === "tar-error") process.exitCode = 2;
process.stdout.write("./tenant/project-assets/asset-one/version\n./tenant/project-assets/asset-two/version\n");
`;

async function setup(t, mode = "success", backend = "file") {
  const root = await createTestDirectory("restore-drill-test-");
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = path.join(root, "bin");
  const backup = path.join(root, "backup");
  const deploy = path.join(root, "deployment");
  await Promise.all([bin, backup, deploy].map((dir) => mkdir(dir)));
  await writeFile(path.join(deploy, ".env"), "# Synthetic deployment environment\n");
  await writeFile(path.join(bin, "docker"), docker, { mode: 0o700 });
  await writeFile(path.join(bin, "tar"), tar, { mode: 0o700 });
  const files = {};
  for (const file of [
    "postgres.dump", "roles.sql", "supabase-internal.dump", "storage.tar.gz",
    "db-config.tar.gz", "deployment-config.tar.gz", "resume.json", "nginx.conf",
    "web.env", ".env", "server.env", "compose.json", "deployment.json",
  ]) {
    let content = "synthetic-backup-content";
    if (file === "compose.json") {
      content = JSON.stringify({ services: {
        db: { image: "supabase/postgres:drill-test" },
        storage: { environment: { STORAGE_BACKEND: backend } },
      } });
    } else if (file === "postgres.dump" && mode === "early-exit") {
      content = Buffer.alloc(8 * 1024 * 1024, 120);
    }
    await writeFile(path.join(backup, file), content);
    files[file] = createHash("sha256").update(content).digest("hex");
  }
  await writeFile(path.join(backup, "manifest.json"), JSON.stringify({
    format: 1, createdAt: "2026-01-01T00:00:00Z", mode: "hot", files,
  }));
  const env = {
    ...process.env, PATH: `${bin}:${process.env.PATH}`,
    TEST_DOCKER_LOG: path.join(root, "docker.jsonl"), TEST_DRILL_MODE: mode,
  };
  return { backup, deploy, env };
}

async function run(fixture, extra = []) {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(here, "restore-drill.mjs"),
      "--backup", fixture.backup, "--dir", fixture.deploy, ...extra,
    ], { env: fixture.env });
    let out = "", err = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out, err }));
  });
  const log = await readFile(fixture.env.TEST_DOCKER_LOG, "utf8").catch((error) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  return { ...result, summary: result.out ? JSON.parse(result.out) : null,
    calls: log.trim() ? log.trim().split("\n").map(JSON.parse) : [],
  };
}

function assertCleanup(calls) {
  const start = calls.find((args) => args[0] === "run");
  assert.ok(start);
  assert.equal(start[start.indexOf("--network") + 1], "none");
  assert.ok(!start.includes("-p") && !start.includes("-v"));
  assert.deepEqual(calls.at(-1), ["rm", "-f", "-v", start[start.indexOf("--name") + 1]]);
  for (const args of calls.filter((args) => args[0] === "compose")) {
    assert.deepEqual(args.slice(args.indexOf("exec"), -1),
      ["exec", "-T", "db", "psql", "-U", "postgres", "-d", "postgres", "-At", "-c"]);
    assert.match(args.at(-1), /^select count\(\*\) from [a-z0-9_.]+$/);
  }
}

test("restore drill waits for the final server and restores into template0 database", async (t) => {
  const result = await run(await setup(t, "initialising"));
  assert.equal(result.code, 0, result.err || result.out);
  assert.equal(result.summary.ok, true);
  assert.equal(result.summary.rolesErrors, 0);
  assert.equal(result.summary.checks.roles, true);
  assert.equal(result.summary.checks.restore, true);
  assert.equal(Object.keys(result.summary.counts).length, 12);
  assertCleanup(result.calls);
  const probes = result.calls.flatMap((a, i) => a.includes("/proc/1/comm") ? [i] : []);
  assert.equal(probes.length, 2);
  const roleProbe = result.calls.findIndex((a) => a.some((v) => v.includes("pg_roles")));
  assert.ok(roleProbe > probes[1], "temporary server must not pass readiness");
  const create = result.calls.findIndex((a) => a.includes("CREATE DATABASE xy_restore_drill WITH TEMPLATE template0"));
  const restore = result.calls.findIndex((a) => a.includes("pg_restore"));
  assert.ok(create > roleProbe && restore > create);
  assert.ok(result.calls[restore].includes("--exit-on-error"));
  for (const args of result.calls.slice(restore).filter((a) => a[0] === "exec")) {
    assert.equal(args[args.indexOf("-d") + 1], "xy_restore_drill");
  }
});

for (const [mode, check] of [
  ["restore-exit", "restore"], ["restore-error", "restore"], ["early-exit", "restore"],
  ["roles-error", "roles"], ["roles-other-duplicate", "roles"],
  ["roles-fatal", "roles"], ["roles-exit", "roles"],
  ["live-query-error", "tables"], ["invalid-count", "tables"], ["empty-count", "tables"],
  ["storage-query-error", "storage"], ["tar-error", "storage"],
]) {
  test(`restore drill fails closed for ${mode} and cleans up`, async (t) => {
    const result = await run(await setup(t, mode));
    assert.equal(result.code, 1, result.err);
    assert.equal(result.summary?.ok, false, result.err);
    assert.equal(result.summary.checks[check], false);
    for (const [name, passed] of Object.entries(result.summary.checks)) {
      if (name !== check) assert.equal(passed, true, name);
    }
    assert.doesNotMatch(result.err, /unhandled|EPIPE/i);
    assertCleanup(result.calls);
  });
}

test("restore drill never falls back to the bootstrap database when database creation fails", async (t) => {
  const result = await run(await setup(t, "create-error"));
  assert.equal(result.code, 1);
  assert.match(result.err, /Could not create the empty drill database/);
  assert.ok(!result.calls.some((a) => a.includes("pg_restore")));
  assertCleanup(result.calls);
});

test("restore drill --keep preserves only the disposable container for inspection", async (t) => {
  const result = await run(await setup(t), ["--keep"]);
  assert.equal(result.code, 0, result.err || result.out);
  assert.equal(result.summary.ok, true);
  assert.match(result.summary.container, /^xy-restore-drill-/);
  assert.ok(!result.calls.some((a) => a[0] === "rm"));
});

test("restore drill refuses a corrupt backup before starting Docker", async (t) => {
  const fixture = await setup(t);
  await writeFile(path.join(fixture.backup, "postgres.dump"), "tampered");
  const result = await run(fixture);
  assert.equal(result.code, 1);
  assert.match(result.err, /verify-backup failed/);
  assert.deepEqual(result.calls, []);
});

test("restore drill requires a valid Storage query even for S3", async (t) => {
  const result = await run(await setup(t, "storage-query-error", "s3"));
  assert.equal(result.code, 1);
  assert.equal(result.summary.checks.storage, false);
  assert.equal(result.summary.storage.objects, null);
  assertCleanup(result.calls);
});

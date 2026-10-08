import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { prepare } from "./prepare.mjs";
import { createTestDirectory } from "./test-sandbox.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
const run = (file, args, env) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file, ...args], { env });
    let out = "";
    let err = "";
    child.stdout.on("data", (v) => {
      out += v;
    });
    child.stderr.on("data", (v) => {
      err += v;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out, err }));
  });
async function setup() {
  const root = await createTestDirectory("backup-test-");
  const bin = path.join(root, "bin");
  const deploy = path.join(root, "deployment");
  await mkdir(bin);
  await prepare({
    dir: deploy,
    webOrigin: "https://image.example.com",
    apiOrigin: "https://api.image.example.com",
    supabaseOrigin: "https://db.image.example.com",
    ssoDomain: "sso.example.com",
  });
  await writeFile(
    path.join(deploy, "volumes/db/data/DO_NOT_BACKUP"),
    "live-db-data",
  );
  await writeFile(
    path.join(bin, "docker"),
    `#!/usr/bin/env node\n${String.raw`
const fs=require('fs');const a=process.argv.slice(2);
fs.appendFileSync(process.env.TEST_DOCKER_LOG,JSON.stringify(a)+'\n');
if(a.includes('ps')) process.stdout.write('db\nxy-api\nxy-worker\nauth\nrest\nstorage\n');
else if(a.includes('stop') && process.env.TEST_OUTPUT_DIRECTORY) { fs.mkdirSync(process.env.TEST_OUTPUT_DIRECTORY+'/postgres.dump'); }
else if(a.includes('pg_dump') && process.env.TEST_FAIL_DUMP) {process.stderr.write('synthetic-private-value');process.exit(9);}
else if(a.includes('pg_dump')||a.includes('pg_dumpall')||a.includes('tar'))process.stdout.write('synthetic-dump-content');
`}`,
    { mode: 0o700 },
  );
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    TEST_DOCKER_LOG: path.join(root, "calls.jsonl"),
  };
  return { root, deploy, env };
}
test("backup stops writers, includes files and secrets, verifies hashes, then resumes", async () => {
  const { root, deploy, env } = await setup();
  try {
    const output = path.join(root, "backup");
    const result = await run(
      path.join(here, "backup.mjs"),
      ["--dir", deploy, "--output", output],
      env,
    );
    assert.equal(result.code, 0, result.err);
    assert.ok(!result.out.includes("synthetic-private-value"));
    const verify = await run(
      path.join(here, "verify-backup.mjs"),
      [output],
      env,
    );
    assert.equal(verify.code, 0, verify.err);
    const archive = await new Promise((resolve, reject) => {
      const child = spawn("tar", [
        "-tzf",
        path.join(output, "deployment-config.tar.gz"),
      ]);
      let text = "";
      child.stdout.on("data", (chunk) => {
        text += chunk;
      });
      child.once("error", reject);
      child.once("close", (code) =>
        code === 0
          ? resolve(text)
          : reject(new Error("archive listing failed")),
      );
    });
    assert.match(archive, /volumes\/api\/envoy\/lds.template.yaml/);
    assert.match(archive, /volumes\/db\/roles.sql/);
    assert.match(archive, /volumes\/pooler\/pooler.exs/);
    assert.doesNotMatch(archive, /DO_NOT_BACKUP|volumes\/db\/data/);
    const calls = (await readFile(env.TEST_DOCKER_LOG, "utf8"))
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.ok(
      calls.findIndex((a) => a.includes("stop")) <
        calls.findIndex((a) => a.includes("pg_dump")),
    );
    assert.ok(calls.at(-1).includes("start"));
    assert.equal(
      (await stat(path.join(output, "server.env"))).mode & 0o777,
      0o600,
    );
    await writeFile(path.join(output, "storage.tar.gz"), "tampered");
    const invalid = await run(
      path.join(here, "verify-backup.mjs"),
      [output],
      env,
    );
    assert.equal(invalid.code, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("backup failure keeps writers stopped and records recovery list without secrets", async () => {
  const { root, deploy, env } = await setup();
  try {
    const output = path.join(root, "backup");
    const result = await run(
      path.join(here, "backup.mjs"),
      ["--dir", deploy, "--output", output],
      { ...env, TEST_FAIL_DUMP: "1" },
    );
    assert.equal(result.code, 1);
    assert.ok(!result.err.includes("synthetic-private-value"));
    assert.ok(result.err.includes("remain stopped"));
    assert.ok(
      JSON.parse(
        await readFile(path.join(output, "resume.json"), "utf8"),
      ).services.includes("xy-worker"),
    );
    const calls = (await readFile(env.TEST_DOCKER_LOG, "utf8"))
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.ok(!calls.some((a) => a.includes("start")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("output stream failure is handled and leaves explicit recovery state", async () => {
  const { root, deploy, env } = await setup();
  try {
    const output = path.join(root, "backup");
    const result = await run(
      path.join(here, "backup.mjs"),
      ["--dir", deploy, "--output", output],
      { ...env, TEST_OUTPUT_DIRECTORY: output },
    );
    assert.equal(result.code, 1);
    assert.match(result.err, /Backup output stream failed/);
    assert.match(result.err, /Writers remain stopped/);
    assert.doesNotMatch(result.err, /unhandled|synthetic-private-value/);
    const retry = await run(
      path.join(here, "backup.mjs"),
      ["--dir", deploy, "--output", path.join(root, "retry")],
      env,
    );
    assert.equal(retry.code, 1);
    assert.match(retry.err, /operator recovery/);
    const calls = (await readFile(env.TEST_DOCKER_LOG, "utf8"))
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.equal(calls.filter((a) => a.includes("stop")).length, 1);
    assert.ok(!calls.some((a) => a.includes("start")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("manual backups refuse an existing shared deployment lock before stopping services", async () => {
  const { root, deploy, env } = await setup();
  try {
    await mkdir(path.join(deploy, ".xy-backup.lock"));
    const result = await run(
      path.join(here, "backup.mjs"),
      ["--dir", deploy, "--output", path.join(root, "backup")],
      env,
    );
    assert.equal(result.code, 1);
    assert.match(result.err, /Operation lock unavailable/);
    await assert.rejects(readFile(env.TEST_DOCKER_LOG), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

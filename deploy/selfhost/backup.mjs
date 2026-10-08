import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { parseArgs } from "node:util";
import { acquireLock } from "./operation-lock.mjs";
const { values } = parseArgs({
  options: { dir: { type: "string" }, output: { type: "string" } },
});
if (!values.dir || !values.output)
  throw new Error(
    "Required: --dir prepared-directory --output new-backup-directory",
  );
const dir = path.resolve(values.dir);
const output = path.resolve(values.output);
if (output === dir || output.startsWith(dir + path.sep))
  throw new Error("Backup must be outside deployment directory");
await readFile(path.join(dir, "deployment.json")); // Verify correct target before stopping writers.
const compose = [
  "compose",
  "--project-directory",
  dir,
  "--env-file",
  path.join(dir, ".env"),
  "-f",
  path.join(dir, "compose.json"),
];
function run(args, { file, capture = false, command = "docker" } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let text = "";
    let errorBytes = 0;
    child.stderr.on("data", (chunk) => {
      errorBytes += chunk.length;
    }); // Never print secrets from docker config/errors.
    let transferError;
    const transfer = file
      ? pipeline(
          child.stdout,
          createWriteStream(file, { flags: "wx", mode: 0o600 }),
        ).catch(() => {
          transferError = new Error("Backup output stream failed");
          child.kill("SIGTERM");
        })
      : Promise.resolve();
    if (!file)
      child.stdout.on("data", (chunk) => {
        if (capture && text.length < 200000) text += chunk;
      });
    child.on("error", () =>
      reject(new Error("Docker command could not start")),
    );
    child.on("close", (code) => {
      void transfer
        .then(() =>
          code === 0 && !transferError
            ? resolve(text)
            : reject(
                transferError ??
                  new Error(
                    `Backup command failed (exit ${code}, diagnostic bytes ${errorBytes})`,
                  ),
              ),
        )
        .catch(reject);
    });
  });
}
async function staticAssets() {
  const files = [];
  async function visit(relative) {
    const info = await lstat(path.join(dir, relative));
    if (info.isSymbolicLink())
      throw new Error("Deployment static assets cannot contain symlinks");
    if (info.isDirectory()) {
      for (const entry of await readdir(path.join(dir, relative)))
        await visit(path.join(relative, entry));
    } else if (info.isFile()) files.push(relative);
    else throw new Error("Invalid deployment static asset");
  }
  for (const directory of ["volumes/api", "volumes/functions"])
    await visit(directory);
  await visit("volumes/pooler/pooler.exs");
  const sql = (await readdir(path.join(dir, "volumes/db"))).filter((name) =>
    name.endsWith(".sql"),
  );
  if (!sql.length) throw new Error("Missing database initialization assets");
  for (const file of sql) await visit(path.join("volumes/db", file));
  return files.sort();
}
let stopped = false;
let releaseLock;
const recoveryFile = path.join(dir, ".xy-backup-recovery.json");
try {
  releaseLock = await acquireLock(dir, ".xy-backup.lock");
  try {
    await access(recoveryFile);
    throw new Error(
      "Previous backup needs operator recovery; inspect .xy-backup-recovery.json",
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const assets = await staticAssets(); // Validate before stopping any writer; never archive DB data.
  const raw = await run(
    [...compose, "ps", "--services", "--status", "running"],
    { capture: true },
  );
  const running = raw.trim().split(/\s+/).filter(Boolean);
  if (!running.includes("db")) throw new Error("Database is not running");
  if (running.includes("xy-migrate")) throw new Error("A migration is active");
  await mkdir(output, { mode: 0o700 }); // Fail rather than overwrite a backup.
  // Stop every writer, including Auth/Storage/Realtime/Studio. PostgreSQL stays up for dump.
  const writers = running.filter((s) => s !== "db");
  await writeFile(
    path.join(output, "resume.json"),
    JSON.stringify(
      { services: writers, createdAt: new Date().toISOString() },
      null,
      2,
    ),
    { mode: 0o600, flag: "wx" },
  );
  if (writers.length) {
    await writeFile(
      recoveryFile,
      JSON.stringify({
        backup: output,
        services: writers,
        createdAt: new Date().toISOString(),
      }),
      { mode: 0o600, flag: "wx" },
    );
    stopped = true;
    await run([...compose, "stop", "--timeout", "720", ...writers]);
  }
  await run(
    [
      ...compose,
      "exec",
      "-T",
      "db",
      "pg_dump",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "--format=custom",
    ],
    { file: path.join(output, "postgres.dump") },
  );
  await run(
    [
      ...compose,
      "exec",
      "-T",
      "db",
      "pg_dumpall",
      "-U",
      "postgres",
      "--roles-only",
    ],
    { file: path.join(output, "roles.sql") },
  );
  await run(
    [
      ...compose,
      "exec",
      "-T",
      "db",
      "pg_dump",
      "-U",
      "postgres",
      "-d",
      "_supabase",
      "--format=custom",
    ],
    { file: path.join(output, "supabase-internal.dump") },
  );
  // Use existing storage image so no extra unpinned helper image is downloaded.
  await run(
    [
      ...compose,
      "run",
      "--rm",
      "--no-deps",
      "-T",
      "--entrypoint",
      "tar",
      "storage",
      "-C",
      "/var/lib/storage",
      "-czf",
      "-",
      ".",
    ],
    { file: path.join(output, "storage.tar.gz") },
  );
  await run(
    [
      ...compose,
      "exec",
      "-T",
      "db",
      "tar",
      "-C",
      "/etc/postgresql-custom",
      "-czf",
      "-",
      ".",
    ],
    { file: path.join(output, "db-config.tar.gz") },
  );
  await run(["-C", dir, "-czf", "-", "--", ...assets], {
    command: "tar",
    file: path.join(output, "deployment-config.tar.gz"),
  });
  for (const name of [
    ".env",
    "server.env",
    "web.env",
    "deployment.json",
    "compose.json",
    "nginx.conf",
  ]) {
    await writeFile(
      path.join(output, name),
      await readFile(path.join(dir, name)),
      { mode: 0o600, flag: "wx" },
    );
  }
  const hashes = {};
  for (const name of await readdir(output)) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path.join(output, name)))
      hash.update(chunk);
    hashes[name] = hash.digest("hex");
  }
  await writeFile(
    path.join(output, "manifest.json"),
    `${JSON.stringify(
      { format: 1, createdAt: new Date().toISOString(), files: hashes },
      null,
      2,
    )}\n`,
    { mode: 0o600, flag: "wx" },
  );
  if (writers.length) await run([...compose, "start", ...writers]);
  stopped = false;
  await rm(recoveryFile, { force: true });
  console.log(
    JSON.stringify({
      backup: output,
      files: Object.keys(hashes).length,
      status: "complete",
    }),
  );
} catch (error) {
  console.error(`[backup] ${error.message}`);
  if (stopped)
    console.error(
      "[backup] Writers remain stopped. Inspect the partial backup; resume only the services recorded in resume.json.",
    );
  process.exitCode = 1;
} finally {
  if (releaseLock) await releaseLock();
}

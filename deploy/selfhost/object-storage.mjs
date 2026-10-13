// Object storage (第 59 条): move a deployment's Storage files from this
// host's disk to an S3-compatible bucket (Cloudflare R2), so pictures stop
// filling the disk. Storage API keeps serving the same URLs; only where it
// keeps the bytes changes. The key layout is the same in both backends
// (<tenant>/<bucket>/<name>/<version>), so files copy across one to one.
//
// Usage (on the host, deployment prepared by prepare.mjs):
//   node deploy/selfhost/object-storage.mjs status  --dir <deployment>
//   node deploy/selfhost/object-storage.mjs copy    --dir <deployment> --credentials <file> [--to s3|local] [--dry-run]
//   node deploy/selfhost/object-storage.mjs verify  --dir <deployment> [--credentials <file>] [--target s3|local]
//   node deploy/selfhost/object-storage.mjs switch  --dir <deployment> [--credentials <file>] --to s3|local
//   node deploy/selfhost/object-storage.mjs prune-local --dir <deployment> [--yes]
//
// The order for an existing deployment: copy (bulk, while the site runs) →
// switch --to s3 (copies what is new, verifies, restarts Storage only, copies
// what arrived during the restart, verifies again) → watch for a few days →
// prune-local --yes (deletes only local files whose bucket copy has the same
// size). switch --to local is the way back: it first copies the bucket's
// objects to disk.
//
// The credentials file is KEY=VALUE, mode 600:
//   S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
//   S3_BUCKET=<bucket>
//   S3_REGION=auto
//   S3_ACCESS_KEY_ID=<R2 API token access key id>
//   S3_SECRET_ACCESS_KEY=<R2 API token secret>
// switch stores them in the deployment's .env (XY_S3_*, also 600), so later
// runs need no --credentials. Nothing here prints a key: the copier gets
// them on stdin, not in its arguments or environment.
//
// Set XY_COMPOSE_OVERRIDE to an extra compose file when the deployment uses
// one (the lab's lab.override.json); a recreate without it would drop the
// override's settings.
import { spawn } from "node:child_process";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, parseEnv } from "node:util";
import { acquireLock } from "./operation-lock.mjs";

const REQUIRED = [
  "S3_ENDPOINT",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
];
const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
/** .env names the switched compose file reads. */
const ENV_NAMES = {
  endpoint: "XY_S3_ENDPOINT",
  bucket: "XY_S3_BUCKET",
  region: "XY_S3_REGION",
  accessKeyId: "XY_S3_ACCESS_KEY_ID",
  secretAccessKey: "XY_S3_SECRET_ACCESS_KEY",
};
/** Storage API settings this tool owns; switching back removes them. */
const S3_SETTINGS = [
  "GLOBAL_S3_ENDPOINT",
  "GLOBAL_S3_FORCE_PATH_STYLE",
  "STORAGE_S3_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "STORAGE_S3_REQUEST_CHECKSUM_CALCULATION",
  "STORAGE_S3_RESPONSE_CHECKSUM_VALIDATION",
];

/**
 * Bucket settings from KEY=VALUE text (a credentials file, or the
 * deployment's .env with the XY_ prefix). Throws on anything incomplete or
 * unsafe; error messages name keys, never values.
 */
export function parseS3Settings(text, { prefix = "", allowHttp = false } = {}) {
  const env = parseEnv(text);
  const get = (name) => env[`${prefix}${name}`]?.trim() ?? "";
  const missing = REQUIRED.filter((name) => !get(name));
  if (missing.length)
    throw new Error(`Missing ${missing.map((n) => prefix + n).join(", ")}`);
  let endpoint;
  try {
    endpoint = new URL(get("S3_ENDPOINT"));
  } catch {
    throw new Error(`${prefix}S3_ENDPOINT is not a URL`);
  }
  const plainHttp = endpoint.protocol === "http:" && allowHttp;
  if (
    (endpoint.protocol !== "https:" && !plainHttp) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== "/"
  )
    throw new Error(
      `${prefix}S3_ENDPOINT must be an https origin (http only with --allow-http, for a lab)`,
    );
  const bucket = get("S3_BUCKET");
  if (!BUCKET.test(bucket))
    throw new Error(`${prefix}S3_BUCKET is not a valid bucket name`);
  const region = get("S3_REGION") || "auto";
  if (!/^[a-z0-9-]{2,32}$/.test(region))
    throw new Error(`${prefix}S3_REGION is not a region name`);
  for (const name of ["S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"])
    if (/[\s'"]/.test(get(name)))
      throw new Error(`${prefix}${name} has spaces or quotes`);
  return {
    endpoint: endpoint.origin,
    bucket,
    region,
    accessKeyId: get("S3_ACCESS_KEY_ID"),
    secretAccessKey: get("S3_SECRET_ACCESS_KEY"),
  };
}

/** The .env lines (XY_S3_*) a switched deployment reads its bucket from. */
export function settingsEnv(settings) {
  return Object.fromEntries(
    Object.entries(ENV_NAMES).map(([key, name]) => [name, settings[key]]),
  );
}

/**
 * Storage API environment for a backend. Pure: the compose file's storage
 * environment in, the new one out. The bucket settings are ${XY_S3_*}
 * references to .env, so compose.json never holds a key. Image
 * transformation stays on only for files: imgproxy reads local paths, and
 * the site never asks for transformed images.
 */
export function storageEnvironment(environment, backend) {
  const next = { ...environment };
  for (const name of S3_SETTINGS) delete next[name];
  if (backend === "local") {
    next.STORAGE_BACKEND = "file";
    next.GLOBAL_S3_BUCKET = "${GLOBAL_S3_BUCKET}";
    next.ENABLE_IMAGE_TRANSFORMATION = "true";
    return next;
  }
  if (backend !== "s3") throw new Error("Backend must be s3 or local");
  return {
    ...next,
    STORAGE_BACKEND: "s3",
    GLOBAL_S3_BUCKET: "${XY_S3_BUCKET}",
    GLOBAL_S3_ENDPOINT: "${XY_S3_ENDPOINT}",
    GLOBAL_S3_FORCE_PATH_STYLE: "true",
    STORAGE_S3_REGION: "${XY_S3_REGION}",
    AWS_ACCESS_KEY_ID: "${XY_S3_ACCESS_KEY_ID}",
    AWS_SECRET_ACCESS_KEY: "${XY_S3_SECRET_ACCESS_KEY}",
    // R2 and most S3-compatible stores reject the SDK's newer default checksums.
    STORAGE_S3_REQUEST_CHECKSUM_CALCULATION: "WHEN_REQUIRED",
    STORAGE_S3_RESPONSE_CHECKSUM_VALIDATION: "WHEN_REQUIRED",
    ENABLE_IMAGE_TRANSFORMATION: "false",
  };
}

/** Which backend a compose file's Storage uses. */
export function storageBackend(compose) {
  return compose.services?.storage?.environment?.STORAGE_BACKEND === "s3"
    ? "s3"
    : "local";
}

/**
 * Sets KEY='value' lines in env-file text: replaces the key's line where it
 * is, appends it otherwise, leaves every other line (and comment) alone.
 */
export function upsertEnv(text, entries) {
  const lines = text.length ? text.replace(/\n$/, "").split("\n") : [];
  for (const [key, value] of Object.entries(entries)) {
    if (/[\r\n']/.test(String(value)))
      throw new Error(`Invalid environment value for ${key}`);
    const line = `${key}='${value}'`;
    const at = lines.findIndex((l) => l.startsWith(`${key}=`));
    if (at === -1) lines.push(line);
    else lines[at] = line;
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Runs inside the Storage container (node -e, cwd /app), where Storage API's
 * own AWS SDK, pg and fs-xattr are installed, the files are mounted and
 * DATABASE_URL reaches storage.objects. Reads its job (with the keys) from
 * stdin; prints progress to stderr and one JSON summary to stdout. Walks
 * storage.objects, so only live objects move; files without a row are left
 * alone. Serialised with toString(): no closures over this module.
 */
async function copier() {
  const { createRequire } = require("node:module");
  const lib = createRequire("/app/package.json");
  const fs = require("node:fs");
  const fsp = require("node:fs/promises");
  const path = require("node:path");
  const { pipeline } = require("node:stream/promises");
  const S3 = lib("@aws-sdk/client-s3");
  const xattr = lib("fs-xattr");
  const pg = lib("pg");
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const job = JSON.parse(input);
  input = "";
  const log = (message) =>
    process.stderr.write(`[object-storage] ${message}\n`);
  const tenant = process.env.TENANT_ID;
  if (!tenant) throw new Error("TENANT_ID is not set in the storage container");
  const root = path.join(
    process.env.FILE_STORAGE_BACKEND_PATH || "/var/lib/storage",
    job.fileBucket,
  );
  const ATTR = {
    contentType: "user.supabase.content-type",
    cacheControl: "user.supabase.cache-control",
  };
  const s3 = job.s3
    ? new S3.S3Client({
        region: job.s3.region,
        endpoint: job.s3.endpoint,
        forcePathStyle: true,
        credentials: {
          accessKeyId: job.s3.accessKeyId,
          secretAccessKey: job.s3.secretAccessKey,
        },
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
      })
    : null;
  if (job.s3) job.s3.secretAccessKey = "";
  const Bucket = job.s3?.bucket;
  const stats = {
    mode: job.mode,
    direction: job.direction ?? null,
    dryRun: Boolean(job.dryRun),
    objects: 0,
    bytes: 0,
  };
  const samples = {};
  const count = (name, key, bytes = 0) => {
    stats[name] = (stats[name] ?? 0) + 1;
    if (bytes) stats[`${name}Bytes`] = (stats[`${name}Bytes`] ?? 0) + bytes;
    if (key) {
      samples[name] ??= [];
      if (samples[name].length < 10) samples[name].push(key);
    }
  };
  const attr = (file, name) => {
    try {
      return xattr.getAttributeSync(file, name).toString();
    } catch {
      return undefined;
    }
  };
  const localSize = async (file) => {
    try {
      const info = await fsp.stat(file);
      return info.isFile() ? info.size : null;
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  };
  const head = async (Key) => {
    try {
      const r = await s3.send(new S3.HeadObjectCommand({ Bucket, Key }));
      return {
        size: Number(r.ContentLength ?? 0),
        contentType: r.ContentType,
        cacheControl: r.CacheControl,
      };
    } catch (error) {
      if (
        error?.$metadata?.httpStatusCode === 404 ||
        error?.name === "NotFound"
      )
        return null;
      throw error;
    }
  };

  async function one(row) {
    const key = `${tenant}/${row.bucket_id}/${row.name}${row.version ? `/${row.version}` : ""}`;
    const file = path.join(root, key);
    if (!file.startsWith(root + path.sep)) return count("skippedUnsafe", key);
    const size = Number(row.metadata?.size ?? 0);
    stats.objects += 1;
    stats.bytes += size;
    if (job.mode === "status") {
      const local = await localSize(file);
      if (local === null) count("notOnDisk");
      else count("onDisk", null, local);
      return;
    }
    // A row with neither a file nor a bucket copy was broken before any
    // move (missingBoth); it does not block a switch.
    if (job.mode === "verify" && job.direction === "local") {
      const local = await localSize(file);
      if (local === null)
        return count(
          s3 && !(await head(key)) ? "missingBoth" : "missingLocal",
          key,
        );
      if (size && local !== size) return count("sizeMismatch", key);
      return count("ok");
    }
    if (job.mode === "verify") {
      const remote = await head(key);
      const local = await localSize(file);
      if (!remote)
        return count(local === null ? "missingBoth" : "missingRemote", key);
      const expected = local ?? size;
      if (expected && remote.size !== expected)
        return count("sizeMismatch", key);
      return count("ok");
    }
    if (job.mode === "prune") {
      const local = await localSize(file);
      if (local === null) return count("notOnDisk");
      const remote = await head(key);
      if (!remote) return count("keptMissingRemote", key);
      if (remote.size !== local) return count("keptSizeMismatch", key);
      if (!job.dryRun) {
        await fsp.unlink(file);
        // Drop the now-empty object directory, never above the bucket folder.
        let dir = path.dirname(file);
        const stop = path.join(root, tenant, row.bucket_id);
        while (dir.startsWith(stop + path.sep)) {
          try {
            await fsp.rmdir(dir);
          } catch {
            break;
          }
          dir = path.dirname(dir);
        }
      }
      return count(job.dryRun ? "wouldPrune" : "pruned", null, local);
    }
    if (job.direction === "s3") {
      const local = await localSize(file);
      if (local === null) return count("missingLocal", key);
      const remote = await head(key);
      if (remote && remote.size === local) return count("skipped");
      if (job.dryRun) return count("wouldCopy", null, local);
      await s3.send(
        new S3.PutObjectCommand({
          Bucket,
          Key: key,
          Body: fs.createReadStream(file),
          ContentLength: local,
          ContentType:
            attr(file, ATTR.contentType) ??
            row.metadata?.mimetype ??
            "application/octet-stream",
          CacheControl:
            attr(file, ATTR.cacheControl) ??
            row.metadata?.cacheControl ??
            "no-cache",
        }),
      );
      return count("copied", null, local);
    }
    // To local: the way back. Files get the xattrs the file backend reads.
    const remote = await head(key);
    if (!remote) return count("missingRemote", key);
    const local = await localSize(file);
    if (local === remote.size) return count("skipped");
    if (job.dryRun) return count("wouldCopy", null, remote.size);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.xy-copy-${process.pid}`;
    const response = await s3.send(
      new S3.GetObjectCommand({ Bucket, Key: key }),
    );
    await pipeline(
      response.Body,
      fs.createWriteStream(temporary, { mode: 0o644 }),
    );
    if (remote.contentType)
      xattr.setAttributeSync(temporary, ATTR.contentType, remote.contentType);
    if (remote.cacheControl)
      xattr.setAttributeSync(temporary, ATTR.cacheControl, remote.cacheControl);
    await fsp.rename(temporary, file);
    return count("copied", null, remote.size);
  }

  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    let after = ["", ""];
    let done = 0;
    for (;;) {
      const { rows } = await db.query(
        `select bucket_id, name, version, metadata from storage.objects
          where (bucket_id, name) > ($1, $2) order by bucket_id, name limit 1000`,
        after,
      );
      if (!rows.length) break;
      after = [rows.at(-1).bucket_id, rows.at(-1).name];
      let next = 0;
      const worker = async () => {
        while (next < rows.length) {
          const row = rows[next++];
          try {
            await one(row);
          } catch (error) {
            count("failed", `${row.bucket_id}/${row.name}`);
            if ((stats.failed ?? 0) <= 5)
              log(
                `failed ${row.bucket_id}/${row.name}: ${error?.name ?? ""} ${error?.message ?? error}`,
              );
          }
        }
      };
      await Promise.all(Array.from({ length: job.concurrency }, worker));
      done += rows.length;
      log(
        `${job.mode}${job.direction ? ` → ${job.direction}` : ""}: ${done} objects`,
      );
    }
  } finally {
    await db.end();
    s3?.destroy();
  }
  stats.samples = samples;
  process.stdout.write(`${JSON.stringify(stats)}\n`);
}

function composeArgs(dir) {
  const files = ["-f", path.join(dir, "compose.json")];
  const extra = process.env.XY_COMPOSE_OVERRIDE;
  if (extra) {
    if (!path.isAbsolute(extra))
      throw new Error("XY_COMPOSE_OVERRIDE must be an absolute path");
    files.push("-f", extra);
  }
  return [
    "compose",
    "--project-directory",
    dir,
    "--env-file",
    path.join(dir, ".env"),
    ...files,
  ];
}

/** Runs docker; never echoes its output (compose errors can carry config). */
function docker(args, { input, onStderr } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      if (out.length < 1_000_000) out += chunk;
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      // Only the copier's own lines are shown; they never hold a key.
      for (const line of text.split("\n"))
        if (line.startsWith("[object-storage]")) onStderr?.(line);
      if (err.length < 20_000) err += text;
    });
    child.on("error", () => reject(new Error("docker could not start")));
    child.on("close", (code) =>
      code === 0
        ? resolve(out)
        : reject(
            new Error(
              `docker ${args.find((a) => ["exec", "up", "ps"].includes(a)) ?? ""} failed (exit ${code}, ${err.length} diagnostic bytes)`,
            ),
          ),
    );
    child.stdin.end(input ?? "");
  });
}

/** The `node -e` program the Storage container runs (no keys in it). */
export function copierScript() {
  return `(${copier.toString()})().catch((e) => { process.stderr.write("[object-storage] " + (e && e.message ? e.message : e) + "\\n"); process.exit(1); })`;
}

async function runCopier(dir, job) {
  const out = await docker(
    [
      ...composeArgs(dir),
      "exec",
      "-T",
      "storage",
      "node",
      "-e",
      copierScript(),
    ],
    { input: JSON.stringify(job), onStderr: (line) => console.error(line) },
  );
  const last = out.trim().split("\n").at(-1);
  return JSON.parse(last);
}

async function readText(file) {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

/** Writes through a temporary file so a crash never leaves half a config. */
async function replaceFile(file, text) {
  const temporary = `${file}.xy-object-storage`;
  await writeFile(temporary, text, { mode: 0o600 });
  await rename(temporary, file);
}

async function loadSettings(dir, values) {
  const allowHttp = Boolean(values["allow-http"]);
  if (values.credentials) {
    const info = await stat(values.credentials);
    if (info.mode & 0o077)
      throw new Error(
        "The credentials file must be readable by its owner only (chmod 600)",
      );
    return parseS3Settings(await readFile(values.credentials, "utf8"), {
      allowHttp,
    });
  }
  const text = await readText(path.join(dir, ".env"));
  if (!text.includes(`${ENV_NAMES.bucket}=`))
    throw new Error("No bucket configured yet: give --credentials <file>");
  // The deployment's own settings were checked when they were stored.
  return parseS3Settings(text, { prefix: "XY_", allowHttp: true });
}

async function waitHealthy(dir, service) {
  for (let i = 0; i < 60; i += 1) {
    const out = await docker([
      ...composeArgs(dir),
      "ps",
      "--format",
      "json",
      service,
    ]).catch(() => "");
    // Newer Compose prints one JSON object per line, older ones an array.
    const text = out.trim();
    const rows = text.startsWith("[")
      ? JSON.parse(text)
      : text
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line));
    if (rows.some((row) => row.Health === "healthy")) return;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(
    `${service} did not become healthy in 2 minutes; check \`compose.sh logs ${service}\``,
  );
}

/** What a verify against `target` found wrong (missingBoth excluded: pre-existing). */
const problems = (summary, target) =>
  (target === "s3"
    ? (summary.missingRemote ?? 0)
    : (summary.missingLocal ?? 0)) +
  (summary.sizeMismatch ?? 0) +
  (summary.failed ?? 0);

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      dir: { type: "string" },
      credentials: { type: "string" },
      to: { type: "string" },
      target: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
      concurrency: { type: "string", default: "8" },
      "allow-http": { type: "boolean", default: false },
    },
  });
  const command = positionals[0];
  if (!values.dir || !command)
    throw new Error(
      "Usage: object-storage.mjs status|copy|verify|switch|prune-local --dir <deployment>",
    );
  const dir = path.resolve(values.dir);
  const deployment = JSON.parse(
    await readFile(path.join(dir, "deployment.json"), "utf8"),
  );
  const compose = JSON.parse(
    await readFile(path.join(dir, "compose.json"), "utf8"),
  );
  const env = parseEnv(await readText(path.join(dir, ".env")));
  const backend = storageBackend(compose);
  const concurrency = Number(values.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32)
    throw new Error("--concurrency must be 1-32");
  // The file backend's folder under volumes/storage (vendor default "stub").
  const fileBucket = env.GLOBAL_S3_BUCKET || "stub";
  const job = (extra, settings) => ({
    fileBucket,
    concurrency,
    ...extra,
    ...(settings ? { s3: { ...settings } } : {}),
  });
  const print = (value) => console.log(JSON.stringify(value, null, 2));

  if (command === "status") {
    const summary = await runCopier(dir, job({ mode: "status" }));
    print({
      backend,
      bucket: backend === "s3" ? env[ENV_NAMES.bucket] : null,
      endpointHost:
        backend === "s3" && env[ENV_NAMES.endpoint]
          ? new URL(env[ENV_NAMES.endpoint]).host
          : null,
      switchedAt: deployment.objectStorage?.switchedAt ?? null,
      objects: summary.objects,
      bytes: summary.bytes,
      onDisk: summary.onDisk ?? 0,
      onDiskBytes: summary.onDiskBytes ?? 0,
    });
    return;
  }

  if (command === "copy" || command === "verify") {
    const settings = await loadSettings(dir, values);
    const direction =
      command === "copy" ? (values.to ?? "s3") : (values.target ?? "s3");
    if (!["s3", "local"].includes(direction))
      throw new Error("--to / --target must be s3 or local");
    const release =
      command === "copy"
        ? await acquireLock(dir, ".xy-object-storage.lock")
        : null;
    try {
      const summary = await runCopier(
        dir,
        job({ mode: command, direction, dryRun: values["dry-run"] }, settings),
      );
      print(summary);
      if (command === "verify" && problems(summary, direction))
        process.exitCode = 1;
      if (command === "copy" && summary.failed) process.exitCode = 1;
    } finally {
      await release?.();
    }
    return;
  }

  if (command === "switch") {
    const to = values.to;
    if (!["s3", "local"].includes(to))
      throw new Error("switch needs --to s3 or --to local");
    if (to === backend)
      throw new Error(
        `Storage already uses ${to === "s3" ? "the bucket" : "local files"}`,
      );
    const settings = await loadSettings(dir, values);
    const release = await acquireLock(dir, ".xy-object-storage.lock");
    try {
      // 1. Bring the target up to date while the site still runs, and refuse
      //    to switch if anything is missing there.
      const copied = await runCopier(
        dir,
        job({ mode: "copy", direction: to }, settings),
      );
      const checked = await runCopier(
        dir,
        job({ mode: "verify", direction: to }, settings),
      );
      if (copied.failed || problems(checked, to)) {
        print({ copied, checked });
        throw new Error(
          "Not switching: the target is missing objects (see above). Fix them and run switch again.",
        );
      }
      if (checked.missingBoth)
        console.error(
          `[object-storage] ${checked.missingBoth} objects have neither a file nor a bucket copy; they were already broken`,
        );

      // 2. Configuration: keys in .env (600), references in compose.json.
      const backups = path.join(dir, "object-storage");
      await mkdir(backups, { recursive: true, mode: 0o700 });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      await writeFile(
        path.join(backups, `compose.json.${stamp}`),
        await readFile(path.join(dir, "compose.json")),
        { mode: 0o600, flag: "wx" },
      );
      if (to === "s3")
        await replaceFile(
          path.join(dir, ".env"),
          upsertEnv(
            await readText(path.join(dir, ".env")),
            settingsEnv(settings),
          ),
        );
      compose.services.storage.environment = storageEnvironment(
        compose.services.storage.environment,
        to,
      );
      await replaceFile(
        path.join(dir, "compose.json"),
        `${JSON.stringify(compose, null, 2)}\n`,
      );
      await replaceFile(
        path.join(dir, "server.env"),
        upsertEnv(await readText(path.join(dir, "server.env")), {
          LOOMIC_OBJECT_STORAGE: to,
        }),
      );
      deployment.objectStorage = {
        backend: to,
        bucket: settings.bucket,
        endpointHost: new URL(settings.endpoint).host,
        switchedAt: new Date().toISOString(),
      };
      await replaceFile(
        path.join(dir, "deployment.json"),
        `${JSON.stringify(deployment, null, 2)}\n`,
      );

      // 3. Restart Storage only (a few seconds of failed uploads; the worker
      //    holds finished pictures and places them when Storage is back).
      console.error("[object-storage] restarting storage");
      await docker([
        ...composeArgs(dir),
        "up",
        "-d",
        "--no-deps",
        "--force-recreate",
        "storage",
      ]);
      await waitHealthy(dir, "storage");

      // 4. Objects written during the restart window went to the old side.
      const catchUp = await runCopier(
        dir,
        job({ mode: "copy", direction: to }, settings),
      );
      const after = await runCopier(
        dir,
        job({ mode: "verify", direction: to }, settings),
      );
      print({
        switchedTo: to,
        bucket: settings.bucket,
        copiedBefore: copied.copied ?? 0,
        copiedAfter: catchUp.copied ?? 0,
        verify: {
          objects: after.objects,
          ok: after.ok ?? 0,
          missing:
            to === "s3"
              ? (after.missingRemote ?? 0)
              : (after.missingLocal ?? 0),
          brokenBefore: after.missingBoth ?? 0,
          sizeMismatch: after.sizeMismatch ?? 0,
        },
        next:
          to === "s3"
            ? "LOOMIC_OBJECT_STORAGE=s3 takes effect at the next xy-api/xy-worker restart. Keep the local files a few days, then prune-local --yes."
            : "Back on local files. The bucket still holds its copies.",
      });
      if (problems(after, to)) process.exitCode = 1;
    } finally {
      await release();
    }
    return;
  }

  if (command === "prune-local") {
    if (backend !== "s3")
      throw new Error("Storage still uses local files; switch --to s3 first");
    const settings = await loadSettings(dir, values);
    const release = await acquireLock(dir, ".xy-object-storage.lock");
    try {
      const summary = await runCopier(
        dir,
        job({ mode: "prune", dryRun: !values.yes }, settings),
      );
      print(summary);
      if (!values.yes)
        console.error(
          "[object-storage] dry run: nothing deleted. Add --yes to delete these local copies.",
        );
      if (summary.failed) process.exitCode = 1;
    } finally {
      await release();
    }
    return;
  }
  throw new Error(`Unknown command ${command}`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(`[object-storage] ${error.message}`);
    process.exitCode = 1;
  });

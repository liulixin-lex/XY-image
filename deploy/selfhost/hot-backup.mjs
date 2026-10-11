// Daily backup without a maintenance window (FINDINGS O1): backup.mjs --hot
// into <root>/hot-<time>, verify-backup.mjs, then local retention (the
// newest backup of each of the last --keep-daily days and of each of the
// last --keep-weekly ISO weeks). <root>/latest.json records the outcome for
// monitoring (operations.mjs monitor reads backup state the same way).
//
// The copies sit on the same host as the data: they cover a bad migration,
// a mistaken delete or a broken volume, not the loss of the machine.
// TODO(ops): ship <root> offsite (operations.mjs + restic) once a
// destination exists; until then this is the only backup.
//
// Usage: node deploy/selfhost/hot-backup.mjs --dir <deployment> --root <backups>
//          [--keep-daily 7] [--keep-weekly 4] [--min-free-gib 5]
import { spawn } from "node:child_process";
import { mkdir, readdir, rm, stat, statfs, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const here = path.dirname(fileURLToPath(import.meta.url));
const NAME = /^hot-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/;

/** UTC date of a backup directory name, or null if it is not one of ours. */
export function backupTime(name) {
  const m = NAME.exec(name);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]));
}

function isoWeek(date) {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  return `${day.getUTCFullYear()}-W${Math.ceil(((day - yearStart) / 86400000 + 1) / 7)}`;
}

/**
 * Which backup directories to delete. Pure: names in, names out. Keeps the
 * newest of each of the newest `keepDaily` days and `keepWeekly` weeks; the
 * newest backup is always kept. Names that are not backups are never touched.
 */
export function planRetention(names, keepDaily, keepWeekly) {
  const backups = names
    .map((name) => ({ name, time: backupTime(name) }))
    .filter((b) => b.time)
    .sort((a, b) => b.time - a.time);
  const keep = new Set(backups.slice(0, 1).map((b) => b.name));
  const days = new Set();
  const weeks = new Set();
  for (const b of backups) {
    const day = b.time.toISOString().slice(0, 10);
    if (!days.has(day) && days.size < keepDaily) {
      days.add(day);
      keep.add(b.name);
    }
    const week = isoWeek(b.time);
    if (!weeks.has(week) && weeks.size < keepWeekly) {
      weeks.add(week);
      keep.add(b.name);
    }
  }
  return backups.filter((b) => !keep.has(b.name)).map((b) => b.name);
}

function run(file, args) {
  return new Promise((resolve, reject) => {
    // Child output is not echoed: backup.mjs prints only its own summary,
    // but nothing from docker (which could include secrets) is passed on.
    const child = spawn(process.execPath, [file, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      if (out.length < 20000) out += chunk;
    });
    child.stderr.on("data", (chunk) => {
      if (err.length < 20000) err += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(out)
        : reject(new Error(`${path.basename(file)} exit ${code}: ${err.split("\n").filter((l) => l.startsWith("[backup]")).join(" ").slice(0, 300)}`)),
    );
  });
}

async function sizeOf(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true }))
    if (entry.isFile()) total += (await stat(path.join(dir, entry.name))).size;
  return total;
}

async function main() {
  const { values } = parseArgs({
    options: {
      dir: { type: "string" },
      root: { type: "string" },
      "keep-daily": { type: "string", default: "7" },
      "keep-weekly": { type: "string", default: "4" },
      "min-free-gib": { type: "string", default: "5" },
    },
  });
  if (!values.dir || !values.root)
    throw new Error("Required: --dir <deployment> --root <backups>");
  const dir = path.resolve(values.dir);
  const root = path.resolve(values.root);
  const keepDaily = Number(values["keep-daily"]);
  const keepWeekly = Number(values["keep-weekly"]);
  const minFree = Number(values["min-free-gib"]) * 1024 ** 3;
  if (![keepDaily, keepWeekly].every((n) => Number.isInteger(n) && n >= 1 && n <= 60))
    throw new Error("--keep-daily / --keep-weekly must be 1-60");
  if (root === dir || root.startsWith(dir + path.sep))
    throw new Error("Backups must be outside the deployment directory");
  await mkdir(root, { recursive: true, mode: 0o700 });

  const started = Date.now();
  const name = `hot-${new Date(started).toISOString().replace(/[:.]/g, "-")}`;
  const output = path.join(root, name);
  const record = async (status, extra) =>
    writeFile(
      path.join(root, status === "complete" ? "latest.json" : "latest-failure.json"),
      `${JSON.stringify({ status, backup: output, at: new Date().toISOString(), ...extra }, null, 2)}\n`,
      { mode: 0o600 },
    );
  try {
    const fs = await statfs(root);
    const free = fs.bavail * fs.bsize;
    if (free < minFree)
      throw new Error(`only ${(free / 1024 ** 3).toFixed(1)} GiB free in ${root}`);
    await run(path.join(here, "backup.mjs"), ["--dir", dir, "--output", output, "--hot"]);
    await run(path.join(here, "verify-backup.mjs"), [output]);
    const bytes = await sizeOf(output);
    const removed = planRetention(await readdir(root), keepDaily, keepWeekly);
    for (const old of removed) await rm(path.join(root, old), { recursive: true, force: true });
    await record("complete", { bytes, ms: Date.now() - started, removed });
    await rm(path.join(root, "latest-failure.json"), { force: true });
    console.log(
      `[hot-backup] ${name} complete: ${(bytes / 1024 ** 2).toFixed(1)} MiB in ${Math.round((Date.now() - started) / 1000)}s, removed ${removed.length} old`,
    );
  } catch (error) {
    await record("failed", { error: error.message.slice(0, 300) }).catch(() => {});
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(`[hot-backup] ${error.message}`);
    process.exitCode = 1;
  });

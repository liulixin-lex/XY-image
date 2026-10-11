// Publishes the static export (apps/web/out) into the web root the edge
// serves (FINDINGS E1, W3):
//   - pages and public files are replaced, files the new build no longer has
//     are removed;
//   - /_next/static is only added to: a browser still showing the previous
//     release asks for that release's chunks, and must get them rather than
//     a 404 (or, before the edge fix, the home page cached for a year as
//     JavaScript). Chunks no release among the last --keep (default 3) uses
//     are pruned; release lists live in <web-root>.releases, outside the
//     served tree;
//   - .br and .gz copies are written next to text files of 1 KB or more,
//     served by Caddy `file_server { precompressed br gzip }` and nginx
//     `gzip_static on`.
// Usage: node deploy/selfhost/publish-web.mjs --from apps/web/out --to /var/www/xy-image-prod [--keep 3] [--dry-run]
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const STATIC_DIR = "_next/static";
const COMPRESSIBLE = /\.(html|js|mjs|css|json|svg|txt|xml|webmanifest|map)$/i;
const MIN_COMPRESS_BYTES = 1024;

/** Every regular file under `root`, as POSIX paths relative to it. */
export async function listFiles(root, relative = "") {
  const files = [];
  let entries;
  try {
    entries = await readdir(path.join(root, relative), { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return files;
    throw error;
  }
  for (const entry of entries) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink())
      throw new Error(`Refusing symlink in web build: ${child}`);
    if (entry.isDirectory()) files.push(...(await listFiles(root, child)));
    else if (entry.isFile()) files.push(child);
  }
  return files.sort();
}

const isStatic = (file) => file.startsWith(`${STATIC_DIR}/`);
const isCompressedCopy = (file) => /\.(br|gz)$/.test(file);

async function sameContent(a, b) {
  try {
    const [x, y] = await Promise.all([readFile(a), readFile(b)]);
    return x.equals(y);
  } catch {
    return false;
  }
}

/** Writes .br and .gz next to compressible files in `root` (the build). */
export async function precompress(root, files) {
  let written = 0;
  for (const file of files) {
    if (!COMPRESSIBLE.test(file) || isCompressedCopy(file)) continue;
    const source = path.join(root, file);
    const bytes = await readFile(source);
    if (bytes.length < MIN_COMPRESS_BYTES) continue;
    const br = brotliCompressSync(bytes, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 11,
        [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
      },
    });
    const gz = gzipSync(bytes, { level: 9 });
    // Only when it pays: tiny or already-dense files are served as they are.
    if (br.length < bytes.length * 0.95) {
      await writeFile(`${source}.br`, br);
      written += 1;
    }
    if (gz.length < bytes.length * 0.95) {
      await writeFile(`${source}.gz`, gz);
      written += 1;
    }
  }
  return written;
}

/**
 * Plans a publish: what to copy, what to delete. Pure, so it is tested
 * without touching a web root.
 * @param {string[]} built files in the new build (compressed copies included)
 * @param {string[]} live files in the web root now
 * @param {string[][]} releases static file lists of earlier releases, newest first
 * @param {number} keep releases whose chunks stay, the new one included
 */
export function planPublish(built, live, releases, keep) {
  const builtSet = new Set(built);
  const kept = new Set(built.filter(isStatic));
  for (const list of releases.slice(0, Math.max(0, keep - 1)))
    for (const file of list) kept.add(file);
  const remove = live.filter((file) =>
    isStatic(file) ? !kept.has(file) : !builtSet.has(file),
  );
  return {
    copy: built,
    remove,
    keptOldChunks: [...kept].filter((file) => !builtSet.has(file)).length,
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      from: { type: "string" },
      to: { type: "string" },
      keep: { type: "string", default: "3" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  if (!values.from || !values.to)
    throw new Error("Required: --from apps/web/out --to /var/www/<site>");
  const from = path.resolve(values.from);
  const to = path.resolve(values.to);
  const keep = Number(values.keep);
  if (!Number.isInteger(keep) || keep < 1 || keep > 20)
    throw new Error("--keep must be 1-20");
  if (to === "/" || to.split(path.sep).length < 3)
    throw new Error(`Refusing to publish into ${to}`);
  await readFile(path.join(from, "index.html")); // a real build, not an empty dir
  await readFile(path.join(from, "404.html"));
  const dryRun = values["dry-run"];

  const compressed = dryRun ? 0 : await precompress(from, await listFiles(from));
  const built = await listFiles(from);
  const live = await listFiles(to);
  const releasesDir = `${to}.releases`;
  await mkdir(releasesDir, { recursive: true, mode: 0o755 });
  const releaseFiles = (await readdir(releasesDir))
    .filter((name) => name.endsWith(".json"))
    .sort()
    .reverse();
  const releases = [];
  for (const name of releaseFiles)
    releases.push(
      JSON.parse(await readFile(path.join(releasesDir, name), "utf8")).files,
    );
  const plan = planPublish(built, live, releases, keep);
  console.log(
    `[publish-web] ${built.length} files (${compressed} compressed copies written), remove ${plan.remove.length}, old chunks kept ${plan.keptOldChunks}${dryRun ? " (dry run)" : ""}`,
  );
  if (dryRun) return;

  // Chunks first, pages last: a page never points at a chunk not yet there.
  const order = [
    ...plan.copy.filter(isStatic),
    ...plan.copy.filter((file) => !isStatic(file)),
  ];
  let copied = 0;
  for (const file of order) {
    const source = path.join(from, file);
    const target = path.join(to, file);
    if (isStatic(file) && (await sameContent(source, target))) continue;
    await mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
    await copyFile(source, target);
    await chmod(target, 0o644);
    copied += 1;
  }
  for (const file of plan.remove) await rm(path.join(to, file), { force: true });
  await pruneEmptyDirs(to);

  const id = new Date().toISOString().replace(/[:.]/g, "-");
  const statics = built.filter(isStatic);
  const digest = createHash("sha256").update(statics.join("\n")).digest("hex");
  await writeFile(
    path.join(releasesDir, `${id}.json`),
    `${JSON.stringify({ publishedAt: new Date().toISOString(), digest, files: statics })}\n`,
    { mode: 0o644 },
  );
  // Release lists beyond what --keep needs only cost disk.
  for (const name of releaseFiles.slice(Math.max(0, keep + 2)))
    await rm(path.join(releasesDir, name), { force: true });
  console.log(
    `[publish-web] published to ${to}: ${copied} files written, ${plan.remove.length} removed, release ${id}`,
  );
}

async function pruneEmptyDirs(root, relative = "") {
  const dir = path.join(root, relative);
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries)
    if (entry.isDirectory())
      await pruneEmptyDirs(root, relative ? `${relative}/${entry.name}` : entry.name);
  if (relative && (await readdir(dir)).length === 0) await rm(dir, { recursive: true });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(`[publish-web] ${error.message}`);
    process.exitCode = 1;
  });

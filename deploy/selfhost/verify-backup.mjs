import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
const root = path.resolve(process.argv[2] ?? "");
try {
  if (!process.argv[2]) throw new Error("Pass a backup directory");
  const manifest = JSON.parse(
    await readFile(path.join(root, "manifest.json"), "utf8"),
  );
  if (manifest.format !== 1) throw new Error("Unsupported backup manifest");
  for (const required of [
    "postgres.dump",
    "roles.sql",
    "supabase-internal.dump",
    "storage.tar.gz",
    "db-config.tar.gz",
    "deployment-config.tar.gz",
    "resume.json",
    "nginx.conf",
    "web.env",
    ".env",
    "server.env",
    "compose.json",
    "deployment.json",
  ])
    if (!manifest.files[required]) throw new Error("Incomplete backup");
  for (const [file, expected] of Object.entries(manifest.files)) {
    if (file !== path.basename(file))
      throw new Error("Invalid manifest filename");
    const p = path.join(root, file);
    const s = await lstat(p);
    if (!s.isFile() || s.isSymbolicLink() || s.size === 0)
      throw new Error("Invalid backup entry");
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(p)) hash.update(chunk);
    if (hash.digest("hex") !== expected)
      throw new Error("Backup checksum mismatch");
  }
  console.log(
    "[backup] Checksums and required artifacts verified; restore drill is still required.",
  );
} catch (error) {
  console.error(`[backup] ${error.message}`);
  process.exitCode = 1;
}

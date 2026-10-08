import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
// No automatic stale-lock recovery: a stopped backup may have left writers down.
export async function acquireLock(directory, name) {
  const target = path.join(directory, name);
  try {
    await mkdir(target, { mode: 0o700 });
  } catch {
    throw new Error(
      "Operation lock unavailable; inspect owner and recovery files before retrying",
    );
  }
  try {
    await writeFile(
      path.join(target, "owner.json"),
      JSON.stringify({
        pid: process.pid,
        host: os.hostname(),
        createdAt: new Date().toISOString(),
      }),
      { mode: 0o600, flag: "wx" },
    );
  } catch {
    await rm(target, { recursive: true, force: true });
    throw new Error("Cannot record operation lock owner");
  }
  return async () => {
    await rm(target, { recursive: true, force: true });
  };
}

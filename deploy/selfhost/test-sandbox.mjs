import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
export async function createTestDirectory(prefix) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root =
    process.env.XY_SELFHOST_TEST_ROOT ??
    path.resolve(here, "../../../.xy-selfhost-tests");
  if (!path.isAbsolute(root))
    throw new Error("XY_SELFHOST_TEST_ROOT must be absolute");
  await mkdir(root, { recursive: true, mode: 0o700 });
  return mkdtemp(path.join(root, prefix));
}

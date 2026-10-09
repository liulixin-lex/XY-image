// One sweep of canvas image objects no canvas references (see
// features/canvas/canvas-files-sweeper.ts), for operators. Inside the backend
// container:
//   node --import tsx src/cli/sweep-canvas-files.ts --dry-run   # list only
//   node --import tsx src/cli/sweep-canvas-files.ts             # delete
// Uses SUPABASE_DB_URL and the service-role Storage client, like the worker.
import { loadServerEnv } from "../config/env.js";
import {
  createSweepStore,
  sweepCanvasFiles,
} from "../features/canvas/canvas-files-sweeper.js";
import { createAdminSupabaseClient } from "../supabase/admin.js";

const env = loadServerEnv();
if (!env.supabaseDbUrl) {
  console.error("SUPABASE_DB_URL is required.");
  process.exit(1);
}
const dryRun = process.argv.includes("--dry-run");
const store = createSweepStore(env.supabaseDbUrl);
const storage = createAdminSupabaseClient(env).storage.from("project-assets");
try {
  const counts = await sweepCanvasFiles({
    store,
    remove: (paths) => storage.remove(paths),
    dryRun,
  });
  console.log(
    `[canvas-files-sweep] ${dryRun ? "dry run: " : ""}workspaces=${counts.workspaces} orphaned=${counts.orphaned} removed=${counts.removed} failed=${counts.failed}`,
  );
  process.exitCode = counts.failed ? 1 : 0;
} finally {
  await store.close();
}

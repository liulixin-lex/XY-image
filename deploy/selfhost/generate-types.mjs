import { spawnSync } from "node:child_process";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const dir = process.env.XY_DEPLOY_DIR;
if (!dir || !path.isAbsolute(dir))
  throw new Error("Set absolute XY_DEPLOY_DIR");
await readFile(path.join(dir, "deployment.json"));
// Use the pinned postgres-meta image already running on the private network.
// This generates from the real database and never invents schema definitions.
const code = `fetch('http://127.0.0.1:8080/generators/typescript?included_schemas=public,langgraph&detect_one_to_one_relationships=true',{signal:AbortSignal.timeout(30000)}).then(async r=>{if(!r.ok)throw new Error();const s=await r.text();process.stdout.write(s)}).catch(()=>process.exit(1))`;
const result = spawnSync(
  "docker",
  [
    "compose",
    "--project-directory",
    dir,
    "--env-file",
    path.join(dir, ".env"),
    "-f",
    path.join(dir, "compose.json"),
    "exec",
    "-T",
    "meta",
    "node",
    "-e",
    code,
  ],
  { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
);
if (result.status !== 0)
  throw new Error("Type generation failed; existing types preserved");
let text = result.stdout;
try {
  const parsed = JSON.parse(text);
  if (typeof parsed === "string") text = parsed;
} catch {}
if (
  !text.includes("export type Database") ||
  !text.includes("langgraph:") ||
  !text.includes("user_chat_providers:")
)
  throw new Error(
    "Generated types missing required schemas; existing types preserved",
  );
const target = fileURLToPath(
  new URL("../../packages/shared/src/supabase/database.ts", import.meta.url),
);
const temp = `${target}.generated`;
await writeFile(temp, text, { flag: "wx" });
await rename(temp, target);
console.log(
  "[types] Generated public,langgraph from the deployed database. Run shared tests and full typecheck before committing.",
);

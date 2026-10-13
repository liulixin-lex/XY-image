// The official skill lives twice: skills/json-image-prompt/SKILL.md in the
// repo (what /opt/loomic/skills carries) and public.skills.skill_content,
// which is what the agent actually reads (agent/workspace-skills.ts). The
// column is set by migrations, so the latest migration that sets it must
// carry exactly the repo file. Edit both together: change SKILL.md, then add
// a migration like 20261013000002 with the new text (第 58 条).
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));

describe("official skill text", () => {
  it("the latest migration that sets it equals skills/json-image-prompt/SKILL.md", async () => {
    const file = await readFile(repo("skills/json-image-prompt/SKILL.md"), "utf8");
    const dir = repo("supabase/migrations");
    const names = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
    let latest: { name: string; text: string } | null = null;
    for (const name of names) {
      const sql = await readFile(`${dir}/${name}`, "utf8");
      if (!/slug\s*=\s*'json-image-prompt'/.test(sql)) continue;
      const set = /skill_content\s*=\s*\$([a-z_]*)\$([\s\S]*?)\$\1\$/.exec(sql);
      if (set) latest = { name, text: set[2] ?? "" };
    }
    expect(latest?.name).toBeDefined();
    expect(latest?.text, `${latest?.name} is out of date with SKILL.md: add a migration`).toBe(file);
  });
});

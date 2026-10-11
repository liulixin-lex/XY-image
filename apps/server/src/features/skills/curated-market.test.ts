import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { skillCategorySchema } from "@loomic/shared";
import { describe, expect, it } from "vitest";

// The curated 市场 skills live in a migration (source = 'community'). The
// agent follows them literally, so a renamed tool, parameter or button would
// quietly turn a skill into wrong advice. This reads the migration and checks
// every reference against the code it names.

const repo = (path: string) =>
  fileURLToPath(new URL(`../../../../../${path}`, import.meta.url));
const read = (path: string) => readFileSync(repo(path), "utf8");

const migration = read(
  "supabase/migrations/20261011000003_curated_skill_market.sql",
);
const rows = [
  ...migration.matchAll(
    /\(\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'GGUU AI', '([^']+)', '(\w+)', '([\w-]+)', 'community', (true|false),\s*'(\{[^']*\})'::jsonb,\s*\$skill\$([\s\S]*?)\$skill\$\s*\)/g,
  ),
].map((m) => ({
  name: m[1] ?? "",
  slug: m[2] ?? "",
  description: m[3] ?? "",
  category: m[5] ?? "",
  featured: m[7] === "true",
  metadata: JSON.parse(m[8] ?? "{}") as { market?: string; tags?: string[] },
  content: m[9] ?? "",
}));

const toolSources = readdirSync(repo("apps/server/src/agent/tools"))
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .map((f) => read(`apps/server/src/agent/tools/${f}`))
  .join("\n");
const imageTool = read("apps/server/src/agent/tools/image-generate.ts");
const webSources = (
  readdirSync(repo("apps/web/src"), { recursive: true }) as string[]
)
  .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))
  .map((f) => read(`apps/web/src/${f}`))
  .join("\n");

describe("curated skill market migration", () => {
  it("parses every curated skill", () => {
    // One INSERT row per skill; a row the pattern misses would escape the
    // checks below.
    expect(rows.length).toBe(migration.match(/\$skill\$---/g)?.length);
    expect(rows.length).toBeGreaterThanOrEqual(8);
    expect(new Set(rows.map((r) => r.slug)).size).toBe(rows.length);
    expect(rows.filter((r) => r.featured).length).toBeGreaterThan(0);
  });

  it.each(rows.map((r) => [r.slug, r] as const))(
    "%s is a well-formed SKILL.md",
    (slug, row) => {
      expect(slug).toMatch(/^xy-[a-z0-9-]+$/);
      expect(skillCategorySchema.options).toContain(row.category);
      expect(row.metadata.market).toBe("curated");
      expect(row.metadata.tags?.length).toBeGreaterThan(0);
      expect(/[一-鿿]/.test(row.name)).toBe(true);
      // The agent reads the frontmatter; the 市场 card shows the column.
      const front = /^---\nname: (.+)\ndescription: (.+)\n---\n/.exec(
        row.content,
      );
      expect(front?.[1]).toBe(slug);
      expect(front?.[2]).toBe(row.description);
      expect(row.content).toContain(`# ${row.name}`);
    },
  );

  it.each(rows.map((r) => [r.slug, r.content] as const))(
    "%s names only real tools, parameters and buttons",
    (_slug, content) => {
      // snake_case: tool names (generate_image) and manipulate_canvas
      // actions (add_text) must exist as string literals in the tools.
      for (const token of new Set(content.match(/\b[a-z]+(?:_[a-z]+)+\b/g)))
        expect(toolSources, token).toContain(`"${token}"`);
      // camelCase: generate_image parameters.
      for (const token of new Set(content.match(/\b[a-z]+[A-Z]\w*\b/g)))
        expect(imageTool, token).toMatch(new RegExp(`\\b${token}: z`));
      // 「…」: buttons and page names the user is sent to, and skill names.
      for (const [, label] of content.matchAll(/「([^「」[]+)」/g)) {
        const known =
          webSources.includes(label ?? "") ||
          rows.some((r) => r.name === label) ||
          migration.includes(`'${label}'`) ||
          read(
            "supabase/migrations/20261011000001_retire_canvas_design_skill.sql",
          ).includes(`'${label}'`);
        expect(known, label).toBe(true);
      }
    },
  );
});

import type { SkillCategory, SkillDetail, SkillListItem } from "@loomic/shared";

import { SKILL_CATEGORY_OPTIONS } from "./categories";

/**
 * Curated 市场 skills are source = 'community' rows seeded by migration
 * 20261011000003 with metadata.market = 'curated'. Every user can read them;
 * a workspace installs one like the official skill.
 */
export function isCurated(skill: SkillListItem): boolean {
  return skill.source === "community" && skill.metadata?.market === "curated";
}

export function curatedTags(skill: SkillListItem): string[] {
  const tags = skill.metadata?.tags;
  return Array.isArray(tags)
    ? tags.filter((t): t is string => typeof t === "string")
    : [];
}

/**
 * 已安装 lists the catalogue (official and own skills, each with its switch);
 * a community skill belongs there only once this workspace installed it.
 */
export function installedTabSkills(skills: SkillListItem[]): SkillListItem[] {
  return skills.filter((s) => s.source !== "community" || s.installed);
}

/** Categories that have at least one curated skill, in the usual order. */
export function curatedCategories(skills: SkillListItem[]) {
  const present = new Set(skills.filter(isCurated).map((s) => s.category));
  return SKILL_CATEGORY_OPTIONS.filter((c) => present.has(c.value));
}

/**
 * Curated skills for the grid: featured first, then by name. `query` matches
 * the name, description and tags ("小红书" finds 社媒封面).
 */
export function filterCurated(
  skills: SkillListItem[],
  { query, category }: { query: string; category: SkillCategory | null },
): SkillListItem[] {
  const q = query.trim().toLowerCase();
  return skills
    .filter(isCurated)
    .filter((s) => !category || s.category === category)
    .filter(
      (s) =>
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        curatedTags(s).some((t) => t.toLowerCase().includes(q)),
    )
    .sort(
      (a, b) =>
        Number(b.isFeatured) - Number(a.isFeatured) ||
        a.name.localeCompare(b.name, "zh-CN"),
    );
}

/**
 * GET /api/skills/:id reads the skills table only, so the detail has no
 * install state and its button always said 安装, even for an installed
 * skill. Take the state from the list item the user clicked.
 */
export function withInstallState(
  detail: SkillDetail,
  item: Pick<SkillListItem, "installed" | "enabled">,
): SkillDetail {
  return {
    ...detail,
    installed: item.installed ?? false,
    enabled: item.enabled ?? false,
  };
}

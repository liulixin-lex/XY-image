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
 * 用途 (第 64 条): the jobs people come for, matched against a skill's name
 * and tags. The four skill categories (设计 / 生成 / 写作 …) are too coarse
 * to find 二次元 or 梗图 with.
 */
export const CURATED_DOMAINS: ReadonlyArray<{ label: string; match: readonly string[] }> = [
  { label: "电商", match: ["电商", "主图", "商品"] },
  { label: "海报", match: ["海报"] },
  { label: "社媒", match: ["小红书", "封面", "社媒"] },
  { label: "品牌", match: ["品牌", "标志", "logo"] },
  { label: "设计排版", match: ["PPT", "菜单", "排版", "界面", "邀请函"] },
  { label: "摄影", match: ["摄影", "人像", "写实"] },
  { label: "影视", match: ["电影", "剧照", "电视剧", "分镜"] },
  { label: "二次元", match: ["二次元", "动漫"] },
  { label: "漫画", match: ["漫画", "四格", "条漫"] },
  { label: "梗图", match: ["梗图", "表情包"] },
  { label: "超现实", match: ["超现实", "梦境", "概念设计"] },
  { label: "3D", match: ["3D", "手办", "黏土", "等距"] },
  { label: "艺术风格", match: ["国风", "水墨", "油画", "水彩", "像素"] },
  { label: "图解", match: ["信息图", "图解", "爆炸图", "示意图"] },
  { label: "改图", match: ["改图", "修图", "换背景", "翻译", "反推"] },
];

function haystack(skill: SkillListItem) {
  return [skill.name, ...curatedTags(skill)].join(" ").toLowerCase();
}

export function inDomain(skill: SkillListItem, domain: string) {
  const found = CURATED_DOMAINS.find((d) => d.label === domain);
  const text = haystack(skill);
  return Boolean(found?.match.some((word) => text.includes(word.toLowerCase())));
}

/** 用途 chips that have at least one curated skill, in the usual order. */
export function curatedDomains(skills: SkillListItem[]) {
  const curated = skills.filter(isCurated);
  return CURATED_DOMAINS.filter((d) => curated.some((s) => inDomain(s, d.label))).map((d) => d.label);
}

/** 新上架: metadata.added within the last 30 days. */
export function isNewSkill(skill: SkillListItem, now = Date.now()) {
  const added = skill.metadata?.added;
  if (typeof added !== "string") return false;
  const at = Date.parse(added);
  return Number.isFinite(at) && now - at < 30 * 24 * 3600 * 1000 && now >= at;
}

/** How many 生图模板 the skill links to (metadata.templates). */
export function templateCount(skill: SkillListItem) {
  const list = skill.metadata?.templates;
  return Array.isArray(list) ? list.filter((t) => typeof t === "string").length : 0;
}

/**
 * Curated skills for the grid: featured first, then new, then by name.
 * `query` matches the name, description, tags and example requests
 * ("小红书" finds 社媒封面, "反推" finds 看图反推提示词).
 */
export function filterCurated(
  skills: SkillListItem[],
  { query, category, domain = null }: { query: string; category: SkillCategory | null; domain?: string | null },
): SkillListItem[] {
  const q = query.trim().toLowerCase();
  const examples = (s: SkillListItem) => {
    const list = s.metadata?.examples;
    return Array.isArray(list) ? list.filter((e): e is string => typeof e === "string") : [];
  };
  return skills
    .filter(isCurated)
    .filter((s) => !category || s.category === category)
    .filter((s) => !domain || inDomain(s, domain))
    .filter(
      (s) =>
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        curatedTags(s).some((t) => t.toLowerCase().includes(q)) ||
        examples(s).some((e) => e.toLowerCase().includes(q)),
    )
    .sort(
      (a, b) =>
        Number(b.isFeatured) - Number(a.isFeatured) ||
        Number(isNewSkill(b)) - Number(isNewSkill(a)) ||
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

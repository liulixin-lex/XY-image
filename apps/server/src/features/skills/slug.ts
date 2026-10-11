import { randomBytes } from "node:crypto";

import type { SkillImportError } from "./skill-import-service.js";

/**
 * Slug for a skill a user creates, imports or installs from the community
 * search. skills.slug is unique across every user and is the agent's path
 * (/workspace-skills/<slug>/SKILL.md), so it must be ASCII and must not
 * collide. The old slug was the name alone: a Chinese name gave "", which
 * failed the list schema (slug min 1) and blanked that user's 技能 page, and
 * one user's "poster" skill refused everyone else's. The readable head keeps
 * paths recognisable in logs; the random tail keeps them unique.
 *
 * The slug is fixed at creation: renaming a skill keeps its path.
 */
export function skillSlug(name: string): string {
  const head = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 60)
    .replace(/^-+|-+$/g, "");
  return `${head || "skill"}-${randomBytes(3).toString("hex")}`;
}

/** What the import and community-install routes tell the user. */
export const SKILL_IMPORT_MESSAGES: Record<SkillImportError["code"], string> = {
  manifest_not_found: "这个地址里没有找到 SKILL.md",
  manifest_parse_error:
    "SKILL.md 的格式不对：开头要有 --- 包起来的 name 和 description",
  manifest_validation_error: "SKILL.md 开头缺少 name 或 description",
  github_fetch_error: "没有从 GitHub 读到这个技能，检查地址后再试，或稍后再试",
  tarball_extract_error: "安装包下载或解压失败，换一个地址再试",
  unsupported_source: "只支持 GitHub 仓库地址和 npm 安装包（.tgz）地址",
};

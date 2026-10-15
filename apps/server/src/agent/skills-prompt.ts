import type { WorkspaceSkillEntry } from "./workspace-skills.js";

/**
 * 第 69 条: enabled skills go into the system prompt in full, not as a list
 * of files to read. Before, nearly every run began with read_file on a
 * skill (old production 10-11..10-14: the first step of most runs), one
 * more model round trip and a few seconds before anything happened. Skills
 * are short (the official 生图提示词规范 is ~3.3k characters, community ones
 * 0.4–1k), the system prompt is cached per conversation, so they are
 * written out up to SKILLS_INLINE_BUDGET characters; anything past that is
 * listed with its path as before. Bundled files (references/, assets/) are
 * still read on demand.
 */
export const SKILLS_INLINE_BUDGET = 14_000;

/** The skill text without its YAML front matter. */
export function skillBody(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
}

export function skillsSection(
  skills: readonly WorkspaceSkillEntry[],
): string | null {
  if (!skills.length) return null;
  let used = 0;
  const inline: string[] = [];
  const listed: string[] = [];
  for (const skill of skills) {
    const body = skillBody(skill.content);
    const files = skill.files.length
      ? `\n附带文件（需要时用 read_file 读）：${skill.files
          .slice(0, 12)
          .map((f) => `${skill.path.replace(/SKILL\.md$/, "")}${f.path}`)
          .join("、")}`
      : "";
    if (body && used + body.length <= SKILLS_INLINE_BUDGET) {
      used += body.length;
      inline.push(`### ${skill.name}\n${skill.description}\n\n${body}${files}`);
    } else {
      listed.push(
        `- **${skill.name}**：${skill.description}（需要时 read_file \`${skill.path}\`）${files}`,
      );
    }
  }
  return [
    "## 技能",
    "下面是这个工作区启用的技能，内容已经写在这里，直接照做，不用再去读文件。和当前需求无关的技能不用理会。",
    ...inline,
    ...(listed.length ? ["其他技能（内容较长，用到时再读）：", ...listed] : []),
  ].join("\n\n");
}

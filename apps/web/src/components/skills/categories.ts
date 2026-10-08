import type { SkillCategory } from "@loomic/shared";

/** Display names for skill categories; the API keeps the English keys. */
export const SKILL_CATEGORY_LABELS: Record<SkillCategory, string> = {
  design: "设计",
  generation: "生成",
  code: "代码",
  data: "数据",
  writing: "写作",
  custom: "自定义",
};

export const SKILL_CATEGORY_OPTIONS = (
  Object.keys(SKILL_CATEGORY_LABELS) as SkillCategory[]
).map((value) => ({ value, label: SKILL_CATEGORY_LABELS[value] }));

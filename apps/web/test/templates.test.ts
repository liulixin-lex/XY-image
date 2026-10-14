import { IMAGE_ASPECT_RATIOS } from "@loomic/shared";
import { describe, expect, it } from "vitest";

import { blanksOf, customTemplate, fillBlanks } from "../src/lib/my-templates";
import {
  TEMPLATE_CATEGORIES,
  TEMPLATES,
  buildTemplatePrompt,
  canPickStyle,
  defaultSettings,
  exampleRounds,
  exampleValues,
  filterTemplates,
  initialValues,
  missingFields,
} from "../src/lib/templates";

describe("生图模板 (第 58 条)", () => {
  it("has unique ids and a template in every category", () => {
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
    for (const category of TEMPLATE_CATEGORIES)
      expect(TEMPLATES.some((t) => t.category === category.value), category.label).toBe(true);
  });

  it("builds every template from its examples into a usable prompt", () => {
    for (const template of TEMPLATES) {
      const values = exampleValues(template);
      expect(missingFields(template, values), template.id).toEqual([]);
      const prompt = buildTemplatePrompt(template, values);
      expect(prompt.length, template.id).toBeGreaterThan(30);
      expect(prompt.length, template.id).toBeLessThanOrEqual(4000);
      expect(prompt, template.id).not.toMatch(/undefined|null|\[object/);
      // Every example value the user typed ends up in the prompt.
      for (const field of template.fields) {
        if (field.kind === "textarea" || field.control) continue;
        expect(prompt, `${template.id}.${field.key}`).toContain(field.example.replace(/["“”]/g, ""));
      }
      if (template.aspectRatio) expect(IMAGE_ASPECT_RATIOS).toContain(template.aspectRatio);
      for (const field of template.fields) {
        const examples = [field.example, ...(field.examples ?? [])];
        if (field.kind === "choice")
          for (const example of examples) expect(field.options, `${template.id}.${field.key}`).toContain(example);
        if (field.kind === "multi")
          for (const part of field.example.split("、")) expect(field.options, `${template.id}.${field.key}`).toContain(part);
      }
      // Every example set builds too (换一组示例).
      for (let round = 1; round < exampleRounds(template); round++) {
        const other = buildTemplatePrompt(template, exampleValues(template, round));
        expect(missingFields(template, exampleValues(template, round)), `${template.id} round ${round}`).toEqual([]);
        expect(other, `${template.id} round ${round}`).not.toMatch(/undefined|null|\[object/);
      }
    }
  });

  it("covers the domains of 第 64 条 with several templates each", () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(69);
    for (const category of ["anime", "comic", "film", "meme", "surreal", "design", "render3d", "art", "game"])
      expect(TEMPLATES.filter((t) => t.category === category).length, category).toBeGreaterThanOrEqual(2);
  });

  it("adds the style, 补充 and 避免 extras after the template's own text", () => {
    const still = TEMPLATES.find((t) => t.id === "surreal-giant")!;
    const prompt = buildTemplatePrompt(still, exampleValues(still), { style: "水彩", detail: "画面偏暖", avoid: "人群" });
    expect(prompt).toContain("整体风格：水彩。");
    expect(prompt).toContain("补充要求：画面偏暖。");
    expect(prompt).toContain("避免出现：人群。");
    // A template that chooses its own style ignores the extra style.
    const anime = TEMPLATES.find((t) => t.id === "anime-character")!;
    expect(canPickStyle(anime)).toBe(false);
    expect(buildTemplatePrompt(anime, exampleValues(anime), { style: "油画" })).not.toContain("整体风格");
    expect(defaultSettings(anime)).toEqual({ aspectRatio: "2:3", resolution: "2K", quality: "high" });
  });

  it("reads {blanks} in the user's own templates", () => {
    const body = "{主体}站在{场景}里，{光线:黄昏逆光}，{主体}回头。";
    expect(blanksOf(body)).toEqual([
      { name: "主体", fallback: "" },
      { name: "场景", fallback: "" },
      { name: "光线", fallback: "黄昏逆光" },
    ]);
    expect(fillBlanks(body, { 主体: "一只猫", 场景: "雨巷" })).toBe("一只猫站在雨巷里，黄昏逆光，一只猫回头。");
    const template = customTemplate({ id: "my-1", name: "测试", kind: "custom", createdAt: 1, body, settings: { resolution: "1K", quality: "low" } });
    expect(template.fields.map((f) => [f.key, Boolean(f.optional)])).toEqual([
      ["主体", false],
      ["场景", false],
      ["光线", true],
    ]);
    expect(missingFields(template, { 主体: "猫" }).map((f) => f.key)).toEqual(["场景"]);
    expect(buildTemplatePrompt(template, { 主体: "猫", 场景: "屋顶", 光线: "" })).toBe("猫站在屋顶里，黄昏逆光，猫回头。");
  });

  it("quotes text that must appear, and edits say what stays", () => {
    const poster = TEMPLATES.find((t) => t.id === "poster-event")!;
    expect(buildTemplatePrompt(poster, { ...exampleValues(poster), title: "夏日“市集”" })).toContain('"夏日市集"');
    for (const edit of TEMPLATES.filter((t) => t.category === "edit")) {
      expect(edit.reference?.need, edit.id).toBe("required");
      expect(edit.aspectRatio, edit.id).toBeUndefined();
      expect(buildTemplatePrompt(edit, exampleValues(edit)), edit.id).toMatch(/不变/);
    }
  });

  it("starts choices on their first option and reports empty required fields", () => {
    const logo = TEMPLATES.find((t) => t.id === "brand-logo")!;
    const values = initialValues(logo);
    expect(values.form).toBe("图形 + 文字");
    expect(missingFields(logo, values).map((f) => f.key)).toEqual(["name", "industry", "traits"]);
  });

  it("searches names, summaries and categories", () => {
    expect(filterTemplates("小红书", null).map((t) => t.id)).toContain("social-xhs");
    expect(filterTemplates("", "edit").every((t) => t.category === "edit")).toBe(true);
    expect(filterTemplates("电商", null).length).toBeGreaterThan(2);
    // Category hints are searched too: 电影 finds the 影视 templates.
    expect(filterTemplates("电影", null).some((t) => t.category === "film")).toBe(true);
    expect(filterTemplates("二次元", null).every((t) => t.category === "anime")).toBe(true);
  });
});

import { IMAGE_ASPECT_RATIOS } from "@loomic/shared";
import { describe, expect, it } from "vitest";

import {
  TEMPLATE_CATEGORIES,
  TEMPLATES,
  buildTemplatePrompt,
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
      for (const field of template.fields)
        if (field.kind === "choice") expect(field.options, `${template.id}.${field.key}`).toContain(field.example);
    }
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
  });
});

import { describe, expect, it } from "vitest";

import { skillSlug } from "./slug.js";

describe("skillSlug", () => {
  it("gives a Chinese name a non-empty, path-safe slug", () => {
    // The old slug was "" here, which failed the list schema and blanked
    // the 技能 page for that user.
    expect(skillSlug("我的海报模板")).toMatch(/^skill-[0-9a-f]{6}$/);
  });

  it("keeps the ASCII part of the name readable", () => {
    expect(skillSlug("Poster Design 海报 v2")).toMatch(
      /^poster-design-v2-[0-9a-f]{6}$/,
    );
  });

  it("does not collide when two users pick the same name", () => {
    const slugs = new Set(
      Array.from({ length: 50 }, () => skillSlug("poster")),
    );
    expect(slugs.size).toBe(50);
  });

  it("bounds the length and never ends the head with a dash", () => {
    const slug = skillSlug(`${"a".repeat(59)} b ${"c".repeat(80)}`);
    expect(slug.length).toBeLessThanOrEqual(67);
    expect(slug).toMatch(/^a{59}-[0-9a-f]{6}$/);
  });
});

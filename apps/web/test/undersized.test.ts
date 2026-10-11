import { describe, expect, it } from "vitest";

import { undersized } from "../src/lib/image-jobs";

describe("undersized", () => {
  it("flags a picture that came back a 画质 tier below what was asked", () => {
    // Pre-launch site: main-site group gpt answered 4K with 1085×1450.
    expect(undersized({ resolution: "4K", width: 1085, height: 1450, edit: null })).toBe(true);
    expect(undersized({ resolution: "2K", width: 768, height: 1024, edit: null })).toBe(true);
  });

  it("leaves real sizes, capped 4K, missing pixels and edits alone", () => {
    // gpt-4k group: 4K under OpenAI's pixel cap for 3:4.
    expect(undersized({ resolution: "4K", width: 2480, height: 3312, edit: null })).toBe(false);
    expect(undersized({ resolution: "1K", width: 896, height: 1200, edit: null })).toBe(false);
    expect(undersized({ resolution: "2K", width: 2048, height: 880, edit: null })).toBe(false);
    expect(undersized({ resolution: "4K", width: null, height: null, edit: null })).toBe(false);
    expect(undersized({ resolution: "4K", width: 1024, height: 1024, edit: "inpaint" })).toBe(false);
  });
});

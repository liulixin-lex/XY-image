import { afterEach, describe, expect, it, vi } from "vitest";

import { isImageUrl } from "../src/components/chat/utils";

describe("isImageUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("recognises extension-less objects on a self-hosted Supabase domain", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://db.example.test");
    expect(
      isImageUrl(
        "https://db.example.test/storage/v1/object/public/project-assets/u/1/out",
      ),
    ).toBe(true);
    expect(
      isImageUrl(
        "https://db.example.test/storage/v1/object/sign/project-assets/u/1/out?token=t",
      ),
    ).toBe(true);
    expect(
      isImageUrl(
        "https://db.example.test/storage/v1/render/image/public/project-assets/u/1/out",
      ),
    ).toBe(true);
  });

  it("ignores other hosts and non-storage paths", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://db.example.test");
    expect(
      isImageUrl("https://other.supabase.co/storage/v1/object/public/a/b"),
    ).toBe(false);
    expect(isImageUrl("https://db.example.test/rest/v1/projects")).toBe(false);
    expect(isImageUrl("not a url")).toBe(false);
  });

  it("still matches image extensions without a configured Supabase URL", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(isImageUrl("https://cdn.example.test/a.webp?x=1")).toBe(true);
    expect(
      isImageUrl("https://db.example.test/storage/v1/object/public/a/b"),
    ).toBe(false);
  });
});

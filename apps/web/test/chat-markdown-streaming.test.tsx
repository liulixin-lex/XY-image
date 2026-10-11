import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MarkdownRenderer } from "../src/components/chat/markdown-renderer";

// Production 10-11: an agent reply streamed a bare image URL one delta at a
// time, and every prefix (…/project-assets/62b, …/62bcd, …) was requested.
const BASE = "https://site.example.test/supabase";
const URL_FULL = `${BASE}/storage/v1/object/public/project-assets/62bcdca6-40f1-4100-ab63-14fca67032dd/generated/250700b1.png`;

function images(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("img")).map((img) => img.getAttribute("src") ?? "");
}

describe("MarkdownRenderer while streaming", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not load an image link that ends where the streamed text ends", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", BASE);
    for (const cut of [70, 90, URL_FULL.length]) {
      const { container, unmount } = render(
        <MarkdownRenderer text={`图在这里：${URL_FULL.slice(0, cut)}`} showCursor />,
      );
      expect(images(container)).toEqual([]);
      expect(container.textContent).toContain("图片加载中…");
      unmount();
    }
  });

  it("loads it once more text follows, or once the block is complete", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", BASE);
    const followed = render(
      <MarkdownRenderer text={`图在这里：${URL_FULL} 需要改的话告诉我`} showCursor />,
    );
    expect(images(followed.container)).toEqual([URL_FULL]);
    followed.unmount();

    const done = render(<MarkdownRenderer text={`图在这里：${URL_FULL}`} />);
    expect(images(done.container)).toEqual([URL_FULL]);
  });

  it("renders markdown images and ordinary links as before", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", BASE);
    const { container } = render(
      <MarkdownRenderer text={`![海报](${URL_FULL})\n\n[主站](https://gguuai.com/usage)`} showCursor />,
    );
    expect(images(container)).toEqual([URL_FULL]);
    expect(container.querySelector("a")?.getAttribute("href")).toBe("https://gguuai.com/usage");
  });
});

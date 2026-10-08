// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * lib/font-api keeps per-page state (which stylesheets were requested,
 * whether the proxy works), so every test imports a fresh copy.
 */
async function freshFontApi() {
  vi.resetModules();
  return import("../src/lib/font-api");
}

const links = () => [...document.head.querySelectorAll<HTMLLinkElement>("link[data-font]")];
const query = (link: HTMLLinkElement) => new URL(link.href).searchParams;

describe("loadFontStylesheet", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SERVER_BASE_URL", "http://api.test");
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    for (const link of links()) link.remove();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("loads a deduplicated subset through the API proxy, once", async () => {
    const { loadFontStylesheet } = await freshFontApi();
    loadFontStylesheet("Noto Serif SC", { text: "思源宋体 思源" });
    loadFontStylesheet("Noto Serif SC", { text: "思源宋体 思源" });

    expect(links()).toHaveLength(1);
    const [link] = links();
    expect(link?.href.startsWith("http://api.test/api/fonts/css2?")).toBe(true);
    expect(query(link as HTMLLinkElement).get("family")).toBe("Noto Serif SC");
    expect(query(link as HTMLLinkElement).get("text")).toBe("思源宋体 ");
  });

  it("falls back to Google directly when the proxy fails, and skips the proxy afterwards", async () => {
    const { loadFontStylesheet } = await freshFontApi();
    loadFontStylesheet("Inter", { text: "Inter" });
    const [first] = links();
    first?.dispatchEvent(new Event("error"));

    expect(first?.href.startsWith("https://fonts.googleapis.com/css2?")).toBe(true);
    expect(query(first as HTMLLinkElement).get("family")).toBe("Inter");
    expect(query(first as HTMLLinkElement).get("text")).toBe("Inter");
    expect(query(first as HTMLLinkElement).get("display")).toBe("swap");

    loadFontStylesheet("Lora");
    const second = links()[1];
    expect(second?.href.startsWith("https://fonts.googleapis.com/css2?")).toBe(true);
  });

  it("keeps using the proxy after it has worked once, even if one font fails", async () => {
    const { loadFontStylesheet } = await freshFontApi();
    loadFontStylesheet("Inter");
    links()[0]?.dispatchEvent(new Event("load"));
    loadFontStylesheet("Lora");
    links()[1]?.dispatchEvent(new Event("error"));
    loadFontStylesheet("Roboto");

    expect(links()[1]?.href.startsWith("https://fonts.googleapis.com/")).toBe(true);
    expect(links()[2]?.href.startsWith("http://api.test/api/fonts/css2?")).toBe(true);
  });

  it("adds no subset after a family is loaded in full (it would shadow the full font)", async () => {
    const { loadFontStylesheet } = await freshFontApi();
    loadFontStylesheet("Lora", { text: "Lora" });
    loadFontStylesheet("Lora");
    loadFontStylesheet("Lora", { text: "其他文字" });

    expect(links().map((link) => query(link).get("text"))).toEqual(["Lora", null]);
  });
});

describe("fetchGoogleFonts", () => {
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_SERVER_BASE_URL", "http://api.test"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("throws when the list request fails, so the picker can say it did not load", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 502 })));
    const { fetchGoogleFonts } = await freshFontApi();
    await expect(fetchGoogleFonts()).rejects.toThrow("502");
  });

  it("passes search and category, and treats a missing list as empty", async () => {
    const fetchMock = vi.fn(async () => Response.json({}));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchGoogleFonts } = await freshFontApi();

    await expect(fetchGoogleFonts("Noto", "serif")).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith("http://api.test/api/fonts?search=Noto&category=serif");
  });
});

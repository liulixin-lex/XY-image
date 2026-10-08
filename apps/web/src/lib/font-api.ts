import { getServerBaseUrl } from "./env";

export type GoogleFontItem = {
  family: string;
  category: string;
  variants: string[];
};

/**
 * Font library list (the API asks Google Fonts server-side). Throws when the
 * request fails, so callers can tell "didn't load" apart from "empty".
 */
export async function fetchGoogleFonts(
  search?: string,
  category?: string,
): Promise<GoogleFontItem[]> {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (category) params.set("category", category);

  const url = `${getServerBaseUrl()}/api/fonts?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`font list request failed: ${res.status}`);
  const data = (await res.json()) as { fonts?: GoogleFontItem[] };
  return data.fonts ?? [];
}

/*
 * Font stylesheets. fonts.googleapis.com / fonts.gstatic.com are often
 * unreachable from mainland networks, so stylesheets come through our API
 * first (`/api/fonts/css2`, which also serves the font files) and fall back
 * to Google directly when that fails, e.g. before the proxy is deployed.
 *
 * `text` asks for a subset with only those characters: a few KB instead of a
 * whole font, which is what previews need. A subset @font-face has no
 * unicode-range and would shadow a full one defined before it, so once a
 * family is loaded in full no subset is added after it. The other order is
 * fine: the full stylesheet comes later and wins.
 */
const MAX_SUBSET_CHARS = 200;

type ProxyState = "unknown" | "ok" | "down";
let proxyState: ProxyState = "unknown";
const requested = new Set<string>();
const fullFamilies = new Set<string>();

function cssQuery(family: string, text: string | undefined) {
  const params = new URLSearchParams({ family });
  if (text) params.set("text", text);
  return params;
}

export function proxyFontCssUrl(family: string, text?: string) {
  return `${getServerBaseUrl()}/api/fonts/css2?${cssQuery(family, text)}`;
}

export function googleFontCssUrl(family: string, text?: string) {
  const params = cssQuery(family, text);
  params.set("display", "swap");
  return `https://fonts.googleapis.com/css2?${params}`;
}

/** Unique characters of `text`, capped, so the subset request stays small. */
function subsetText(text: string | undefined) {
  if (!text) return undefined;
  const chars = [...new Set(Array.from(text))].slice(0, MAX_SUBSET_CHARS).join("");
  return chars.trim() ? chars : undefined;
}

export function loadFontStylesheet(family: string, options: { text?: string } = {}) {
  const name = family.trim();
  if (!name || typeof document === "undefined") return;
  if (fullFamilies.has(name)) return;
  const text = subsetText(options.text);
  const key = `${name}\n${text ?? ""}`;
  if (requested.has(key)) return;
  requested.add(key);
  if (!text) fullFamilies.add(name);

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.dataset.font = name;
  if (proxyState === "down") {
    link.href = googleFontCssUrl(name, text);
  } else {
    link.href = proxyFontCssUrl(name, text);
    link.addEventListener(
      "load",
      () => {
        proxyState = "ok";
      },
      { once: true },
    );
    link.addEventListener(
      "error",
      () => {
        // Until the proxy has worked once, treat a failure as "not deployed"
        // and skip it for the rest of the page instead of failing every font.
        if (proxyState !== "ok") proxyState = "down";
        console.warn(`[fonts] proxy stylesheet failed for "${name}", loading from Google directly`);
        link.href = googleFontCssUrl(name, text);
      },
      { once: true },
    );
  }
  document.head.appendChild(link);
}

/**
 * Small HTML helpers for the web search tools (第 68 条): search result pages
 * and the pages the assistant reads. No DOM: the pages are only mined for
 * text, and a regex pass over a few MB is fast enough.
 */

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  middot: "·",
  bull: "•",
  copy: "©",
  reg: "®",
  trade: "™",
  laquo: "«",
  raquo: "»",
  yen: "¥",
  times: "×",
};

export function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (match, code: string) => {
      if (code.startsWith("#")) {
        const n =
          code[1]?.toLowerCase() === "x"
            ? Number.parseInt(code.slice(2), 16)
            : Number.parseInt(code.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n <= 0x10ffff
          ? String.fromCodePoint(n)
          : match;
      }
      return NAMED[code.toLowerCase()] ?? match;
    },
  );
}

/** Text of an HTML fragment on one line. */
export function stripTags(html: string): string {
  return decodeEntities(
    html.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]*>/g, ""),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function metaContent(html: string, name: string): string {
  const tag = new RegExp(
    `<meta\\b[^>]*(?:name|property)=["']${name}["'][^>]*>`,
    "i",
  ).exec(html)?.[0];
  const content = tag ? /content=["']([^"']*)["']/i.exec(tag)?.[1] : undefined;
  return content ? stripTags(content) : "";
}

/**
 * Readable text of a page: its title, description and body text with
 * headings, list items and paragraphs on their own lines. Scripts, styles
 * and (when the page has no <article>/<main>) navigation and footers go.
 */
export function htmlToText(html: string): {
  title: string;
  description: string;
  text: string;
} {
  const title = stripTags(
    /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "",
  );
  const description =
    metaContent(html, "description") || metaContent(html, "og:description");
  let body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<nav\b[\s\S]*?<\/nav\s*>/gi, " ")
    .replace(
      /<(script|style|noscript|svg|template|iframe|head|canvas|select|button)\b[\s\S]*?<\/\1\s*>/gi,
      " ",
    );
  // MediaWiki pages (Wikipedia, a frequent source): the article body
  // starts here; before it are the language list and page tools.
  const wiki = body.indexOf('id="mw-content-text"');
  if (wiki > 0) body = body.slice(body.lastIndexOf("<", wiki));
  const main = /<(article|main)\b[^>]*>([\s\S]*?)<\/\1\s*>/i.exec(body)?.[2];
  if (main && stripTags(main).length > 400) body = main;
  else
    body = body.replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1\s*>/gi, " ");
  const text = decodeEntities(
    body
      .replace(/<(br|hr)\b[^>]*>/gi, "\n")
      .replace(
        /<\/(p|div|section|article|li|ul|ol|h[1-6]|tr|table|blockquote|pre|dd|dt|figcaption)\s*>/gi,
        "\n",
      )
      .replace(/<li\b[^>]*>/gi, "\n- ")
      .replace(
        /<h([1-6])\b[^>]*>/gi,
        (_m, n: string) => `\n${"#".repeat(Number(n))} `,
      )
      .replace(/<(td|th)\b[^>]*>/gi, " | ")
      .replace(/<[^>]*>/g, ""),
  )
    .replace(/[ \t\f\v 　]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title, description, text };
}

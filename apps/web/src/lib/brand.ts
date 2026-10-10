/**
 * Brand constants for the image site.
 *
 * Every user-visible product name reads from here so a rename touches one file.
 * The upstream Loomic brand must not appear in the UI (product decision,
 * 2026-10-07). Package names such as `@loomic/*` stay untouched on purpose.
 */
export const BRAND = {
  /** Product name used in titles, nav and copy (product decision, 2026-10-08). */
  name: "GGUU AI IMAGE",
  /** The bold half of the wordmark; also used where space is tight. */
  short: "GGUU",
  /** The outlined tag that follows `short` in the wordmark. */
  tag: "AI IMAGE",
  /** One-line description for metadata and the landing page. */
  tagline: "想到什么，就生成什么。主站账号直接登录。",
  /** Name of the design agent inside the canvas. */
  agentName: "设计助手",
} as const;

/** Format a document title consistently. */
export function pageTitle(section?: string) {
  return section ? `${section} · ${BRAND.name}` : BRAND.name;
}

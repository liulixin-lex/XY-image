/**
 * 品牌套件 in the studio (第 58 条): the chosen kit's colours, fonts and
 * guidance become one paragraph appended to the prompt that is sent. The
 * user's own words go along as the picture's title, so lists still show them.
 *
 * The paragraph starts with BRAND_MARK so a prompt that already carries one
 * (再来一次 on a branded picture) is not branded twice.
 *
 * The kit's first logo can go along as the last reference image (a switch
 * in the 品牌 menu); `logoIndex` then tells the model which one it is. Its
 * URL is a one-hour signed brand-kit-assets URL, which the reference fetcher
 * accepts like any storage object URL.
 */
import type { BrandKitDetail } from "@loomic/shared";

export const BRAND_MARK = "【品牌规范";
/** Longest paragraph appended; the kit's guidance is cut to fit. */
export const BRAND_BLOCK_MAX = 600;
const PROMPT_MAX = 4000;

const HEX = /^#?[0-9a-f]{6}$/i;

export function brandBlock(kit: Pick<BrandKitDetail, "name" | "guidance_text" | "assets">): string | null {
  const colors = kit.assets
    .filter((a) => a.asset_type === "color" && a.text_content && HEX.test(a.text_content.trim()))
    .slice(0, 6)
    .map((a) => {
      const hex = (a.text_content as string).trim().toUpperCase();
      return `${a.display_name} ${hex.startsWith("#") ? hex : `#${hex}`}`;
    });
  const fonts = kit.assets
    .filter((a) => a.asset_type === "font" && a.display_name.trim())
    .slice(0, 3)
    .map((a) => `${a.role ? `${a.role}：` : ""}「${a.display_name.trim()}」`);
  const guidance = (kit.guidance_text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    // The paragraph ends with its own 。
    .replace(/[。．.!！？?；;，,、\s]+$/u, "");

  const parts = [
    colors.length ? `配色以 ${colors.join("、")} 为主，不引入别的强烈颜色` : "",
    fonts.length ? `画面里的文字参考这些字体的气质 ${fonts.join("、")}` : "",
    guidance ? `品牌调性：${guidance}` : "",
  ].filter(Boolean);
  if (!parts.length) return null;
  const block = `${BRAND_MARK}·${kit.name.trim() || "品牌"}】${parts.join("；")}。`;
  return block.length > BRAND_BLOCK_MAX ? `${block.slice(0, BRAND_BLOCK_MAX - 1)}…` : block;
}

/**
 * The prompt to send: the user's words, a blank line, the brand paragraph.
 * Unchanged when there is no paragraph or the prompt already has one; the
 * paragraph is cut so the whole stays within the 4000-character limit.
 */
export function withBrand(
  prompt: string,
  block: string | null,
  options: { logoIndex?: number | null; name?: string } = {},
): string {
  if (prompt.includes(BRAND_MARK)) return prompt;
  const logo = options.logoIndex
    ? `第 ${options.logoIndex} 张参考图是品牌标志：画面需要出现标志时照它画，形状、颜色和文字不变。`
    : "";
  // A kit with only a logo has no paragraph of its own; the logo still needs saying.
  const full = block
    ? `${block}${logo}`
    : logo
      ? `${BRAND_MARK}·${options.name?.trim() || "品牌"}】${logo}`
      : "";
  if (!full) return prompt;
  const room = PROMPT_MAX - prompt.length - 2;
  if (room < 40) return prompt;
  return `${prompt}\n\n${full.length > room ? `${full.slice(0, room - 1)}…` : full}`;
}

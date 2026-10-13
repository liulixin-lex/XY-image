/**
 * 品牌套件 in the studio (第 58 条): the chosen kit's colours, fonts and
 * guidance become one paragraph appended to the prompt that is sent. The
 * user's own words go along as the picture's title, so lists still show them.
 *
 * The paragraph starts with BRAND_MARK so a prompt that already carries one
 * (再来一次 on a branded picture) is not branded twice.
 *
 * TODO(第 58 条): the kit's logo could go along as a reference image; its
 * files live in the private brand-kit-assets bucket (signed URLs), which the
 * image runner does not fetch from yet.
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
export function withBrand(prompt: string, block: string | null): string {
  if (!block || prompt.includes(BRAND_MARK)) return prompt;
  const room = PROMPT_MAX - prompt.length - 2;
  if (room < 40) return prompt;
  return `${prompt}\n\n${block.length > room ? `${block.slice(0, room - 1)}…` : block}`;
}

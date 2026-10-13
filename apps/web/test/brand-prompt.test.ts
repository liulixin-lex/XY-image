import type { BrandKitAsset } from "@loomic/shared";
import { describe, expect, it } from "vitest";

import { BRAND_BLOCK_MAX, BRAND_MARK, brandBlock, withBrand } from "../src/lib/brand-prompt";

const at = "2026-10-12T00:00:00Z";
function asset(asset_type: BrandKitAsset["asset_type"], display_name: string, text_content: string | null, role: string | null = null): BrandKitAsset {
  return { id: display_name, asset_type, display_name, role, sort_order: 0, text_content, file_url: null, metadata: {}, created_at: at, updated_at: at };
}

const kit = {
  name: "咖啡店品牌",
  guidance_text: "克制、温暖，留白多；\n避免卡通感。",
  assets: [
    asset("color", "朱红", "#d42a29"),
    asset("color", "炭黑", "15171B"),
    asset("color", "坏颜色", "red"),
    asset("font", "思源宋体", null, "标题"),
    asset("logo", "主标志", null),
  ],
};

describe("brand kit in the studio (第 58 条)", () => {
  it("turns colours, fonts and guidance into one paragraph", () => {
    const block = brandBlock(kit)!;
    expect(block.startsWith(`${BRAND_MARK}·咖啡店品牌】`)).toBe(true);
    expect(block).toContain("朱红 #D42A29");
    expect(block).toContain("炭黑 #15171B");
    expect(block).not.toContain("坏颜色");
    expect(block).toContain("标题：「思源宋体」");
    expect(block).toContain("品牌调性：克制、温暖，留白多； 避免卡通感。");
    expect(block).not.toContain("。。");
    expect(brandBlock({ name: "空", guidance_text: null, assets: [] })).toBeNull();
    const long = brandBlock({ ...kit, guidance_text: "很长".repeat(500) })!;
    expect(long.length).toBeLessThanOrEqual(BRAND_BLOCK_MAX);
  });

  it("appends once and stays within the prompt limit", () => {
    const block = brandBlock(kit);
    const sent = withBrand("秋季新品海报", block);
    expect(sent).toBe(`秋季新品海报\n\n${block}`);
    // 再来一次 on a branded picture: not branded twice.
    expect(withBrand(sent, block)).toBe(sent);
    expect(withBrand("海报", null)).toBe("海报");
    const near = "字".repeat(3800);
    expect(withBrand(near, block).length).toBeLessThanOrEqual(4000);
    expect(withBrand("字".repeat(3990), block)).toBe("字".repeat(3990));
  });

  it("says which reference is the logo when it goes along", () => {
    const block = brandBlock(kit);
    const sent = withBrand("秋季新品海报", block, { logoIndex: 3 });
    expect(sent).toContain("第 3 张参考图是品牌标志");
    expect(sent.endsWith("形状、颜色和文字不变。")).toBe(true);
    expect(withBrand("秋季新品海报", block, { logoIndex: null })).not.toContain("参考图");
    // A kit with only a logo: the note still goes along, under the kit's name.
    expect(withBrand("杯子", null, { logoIndex: 1, name: "演练品牌" })).toBe(
      `杯子\n\n${BRAND_MARK}·演练品牌】第 1 张参考图是品牌标志：画面需要出现标志时照它画，形状、颜色和文字不变。`,
    );
    expect(withBrand("杯子", null, { name: "演练品牌" })).toBe("杯子");
  });
});

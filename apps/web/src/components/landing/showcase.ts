/**
 * Sample images shown on public pages, with the description shown next to
 * each one ("做同款" copies it into the prompt box).
 *
 * Provenance (always labelled 示例作品 in the UI; the captions describe the
 * picture and are not claims about how it was made):
 * - showcase-3, 8, 9, 12: Unsplash photos under the Unsplash License (free
 *   commercial use, attribution not required, recorded here anyway):
 *   - 3: Christian Boragine (@aimha), unsplash.com/photos/h1QDGo4ORsk
 *   - 8: Pavlo Talpa (@pavlo_talpa), unsplash.com/photos/M7MxQliYNEs
 *   - 9: Jonatan Pie (@r3dmax), unsplash.com/photos/fwzQrNqoTd8
 *   - 12: Darien Attridge (@dariendesigns), unsplash.com/photos/Y8r-9RMmhl0
 * - the rest: inherited from the upstream repository's showcase folder,
 *   rights not yet verified.
 * TODO(owner): replace the inherited ones with images generated on this site
 * (or licensed) before launch.
 *
 * `amb`/`amb2` are the glow colours the runtime sampler would pick, computed
 * ahead of time by scripts/prepare-showcase.mjs so the first paint is
 * already lit correctly. Re-run that script if an image changes.
 */
export type ShowcaseItem = {
  id: string;
  /** 540px WebP, for thumbnails and cards. */
  src: string;
  /** 900px WebP, for the big screen. */
  large: string;
  prompt: string;
  ratio: "3:4" | "4:3";
  /** object-position for landscape crops of portrait images. */
  focus: string;
  amb: string;
  amb2: string;
};

const item = (
  n: number,
  prompt: string,
  amb: string,
  amb2: string,
  focus = "50% 35%",
  ratio: ShowcaseItem["ratio"] = "3:4",
): ShowcaseItem => ({
  id: `showcase-${n}`,
  src: `/images/showcase/web/showcase-${n}.webp`,
  large: `/images/showcase/lg/showcase-${n}.webp`,
  prompt,
  ratio,
  focus,
  amb,
  amb2,
});

export const SHOWCASE_ITEMS: ShowcaseItem[] = [
  item(5, "跑道上的三个女孩，复古运动风，正午硬光", "188 88 78", "184 61 119", "50% 30%"),
  item(1, "水母造型的台灯，玻璃丝透出青蓝的光，桌面杂物虚化", "50 198 215", "40 95 205", "50% 40%"),
  item(7, "戴柠檬黄毛线帽的少年用蓝色马克杯喝水，街角，午后自然光", "69 132 196", "99 92 193", "50% 30%"),
  item(6, "银色金属造型的模特站在海边礁石上，身后是巨浪，冷色调", "150 172 214", "92 112 176", "50% 50%", "4:3"),
  item(10, "牛仔胸衣配毛绒外套的女生站在斑驳的墙前，大圈耳环，直闪", "193 108 91", "184 61 110", "50% 30%"),
  item(9, "积雪的湖岸和小山，夜空里是绿色极光和一轮明月", "76 137 190", "59 155 136", "50% 50%", "4:3"),
  item(11, "两个女孩坐在白色木屋前，夏日柔光，淡色调", "199 123 107", "139 92 193", "50% 35%"),
  item(2, "穿毛绒外套的女人躺在旧地毯上，长发散开，俯拍，复古杂志感", "192 106 89", "184 61 110", "50% 30%"),
  item(4, "打开的心形银盒，里面放着浮雕吊坠和水晶耳环，暗红丝绒衬底", "188 96 78", "184 61 110", "50% 55%"),
  item(8, "粉色竖纹玻璃杯立在米白台面上，硬光投下长长的影子，极简产品图", "227 116 100", "207 38 112", "50% 10%"),
  item(3, "扭转的透明玻璃环，边缘折出彩虹色，纯黑背景", "78 131 188", "71 61 184", "50% 50%"),
  item(12, "雨夜的商业街，霓虹招牌倒映在湿漉漉的地砖上，行人撑着伞", "188 96 78", "184 61 110", "50% 55%"),
];

/** Plain list of thumbnail URLs, for places that only need pictures. */
export const SHOWCASE = SHOWCASE_ITEMS.map((entry) => entry.src);

export const SAMPLE_ALT = "示例作品";

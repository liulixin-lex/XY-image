/**
 * 生图模板 (第 58 条): fill-in prompts for the jobs people come here for —
 * 主图、海报、封面、标志、写实照片、插画、信息图、改图. A template is a
 * few short fields; `buildTemplatePrompt` turns them into one prompt and the
 * template suggests 比例 / 画质 / 质量. Using one only fills the studio
 * composer: the user sees the prompt, can edit it, and generates as usual.
 *
 * How the prompts are written (sources: OpenAI's GPT Image prompting guide,
 * 2026-04; Google's Gemini image generation docs and Nano Banana Pro tips):
 *   - say what the picture is for first (主图、海报), then scene → subject →
 *     details → constraints, as short sentences, not a tag list;
 *   - text that must appear goes in quotes, once, with its font, colour and
 *     place; long or exact text (dates, prices) is better as canvas text;
 *   - edits name what changes and repeat what must stay the same;
 *   - photos ask for real textures and light; graphics ask for flat, clean
 *     shapes and no extra text.
 *
 * Templates live in code (versioned with the app, no table): add one by
 * appending to TEMPLATES; test/templates.test.ts checks every template
 * builds from its examples.
 *
 * 第 64 条: 69 templates in 17 categories (二次元, 漫画, 影视, 梗图, 超现实,
 * 商业设计, 3D 潮玩, 艺术风格, 游戏 added, after the category atlas of
 * wuyoscar/GPT-Image2-Skill and the big Nano Banana prompt libraries), and
 * more control in the form: multi-choice fields, choices with the user's
 * own words, several example sets, a style / 补充 / 避免 extra, the output
 * settings, and the user's own saved templates (lib/my-templates.ts).
 */
import type { ImageQuality, ImageResolution } from "@loomic/shared";

import type { AspectRatio } from "./image-model-meta";

export type TemplateCategory =
  | "ecommerce"
  | "poster"
  | "social"
  | "brand"
  | "design"
  | "photo"
  | "film"
  | "anime"
  | "comic"
  | "illustration"
  | "render3d"
  | "art"
  | "surreal"
  | "meme"
  | "game"
  | "infographic"
  | "edit"
  /** The user's own templates and saved fill-ins (lib/my-templates.ts); not a gallery category. */
  | "mine";

/** Gallery categories in display order (第 64 条 added 商业设计 … 游戏). */
export const TEMPLATE_CATEGORIES: ReadonlyArray<{ value: Exclude<TemplateCategory, "mine">; label: string; hint: string }> = [
  { value: "ecommerce", label: "电商", hint: "主图、场景图、卖点图" },
  { value: "poster", label: "海报", hint: "活动、节日、大字报" },
  { value: "social", label: "社媒封面", hint: "小红书、视频、公众号" },
  { value: "brand", label: "品牌", hint: "标志、物料、包装" },
  { value: "design", label: "商业设计", hint: "PPT、菜单、邀请函、横幅、界面" },
  { value: "photo", label: "写实摄影", hint: "人像、形象照、时尚、街拍、风光、美食" },
  { value: "film", label: "影视", hint: "电影剧照、电影海报、电视剧海报、分镜、定妆照" },
  { value: "anime", label: "二次元", hint: "动漫立绘、动画场景、Q 版、头像、照片转动漫" },
  { value: "comic", label: "漫画", hint: "四格、分镜页、美漫封面" },
  { value: "illustration", label: "插画", hint: "角色、贴纸、绘本、图标" },
  { value: "render3d", label: "3D 潮玩", hint: "盲盒手办、黏土、等距场景、3D 图标" },
  { value: "art", label: "艺术风格", hint: "国风水墨、油画、水彩、像素" },
  { value: "surreal", label: "超现实", hint: "梦境、微缩世界、双重曝光、巨物" },
  { value: "meme", label: "梗图", hint: "网络梗图、对比图、反应图、萌宠拟人" },
  { value: "game", label: "游戏", hint: "卡牌插画、场景概念图" },
  { value: "infographic", label: "信息图", hint: "流程、知识卡片" },
  { value: "edit", label: "改图", hint: "换背景、去杂物、翻译文字" },
];

export type TemplateField = {
  key: string;
  label: string;
  placeholder: string;
  /** Filled in by 「用示例填」 and used by the tests. */
  example: string;
  /** More examples: 「换一组示例」 steps through example, examples[0], … (第 64 条). */
  examples?: readonly string[];
  /**
   * text / textarea: typed. choice: one of `options`, or the user's own
   * words (「自定义」, unless `control`). multi: any of `options`, stored
   * joined with 、 (第 64 条).
   */
  kind?: "text" | "textarea" | "choice" | "multi";
  options?: readonly string[];
  optional?: boolean;
  /** Characters; the composer allows 4000 for the whole prompt. */
  max?: number;
  /** A switch that changes the wording, not text copied into the prompt. */
  control?: boolean;
};

export type ImageTemplate = {
  id: string;
  name: string;
  category: TemplateCategory;
  /** One line on the card. */
  summary: string;
  fields: readonly TemplateField[];
  build: (v: Readonly<Record<string, string>>) => string;
  /** 比例 to switch to; absent keeps the current one (edits keep the photo's). */
  aspectRatio?: AspectRatio;
  resolution: ImageResolution;
  quality: ImageQuality;
  /** The picture to work from: required for 改图, recommended for 主图 with a real product. */
  reference?: { need: "required" | "recommended"; hint: string };
  /** Words in the picture: say so, so the user picks a model that writes well. */
  textHeavy?: boolean;
  tips?: readonly string[];
};

/** Joins sentences, skipping empty ones, each ending in 。 */
function lines(...parts: Array<string | false | null | undefined>) {
  return parts
    .map((part) => (part || "").trim())
    .filter(Boolean)
    .map((part) => (/[。！？.!?]$/.test(part) ? part : `${part}。`))
    .join("");
}

/** Text to draw exactly: in quotes, once, nothing else written. */
function exactText(label: string, text: string, style: string) {
  const clean = text.replace(/["“”]/g, "").trim();
  return clean ? `${label}文字 "${clean}"，${style}，字形准确，只出现一次` : "";
}

const NO_EXTRA_TEXT = "画面里不要出现其他文字、水印和标志";
const KEEP_REST = "除此之外的人物、物体、构图、颜色和光线都保持不变";

export const TEMPLATES: readonly ImageTemplate[] = [
  // ── 电商 ──────────────────────────────────────────────────────────
  {
    id: "ecom-white",
    name: "白底主图",
    category: "ecommerce",
    summary: "纯白背景、商品居中，平台首图标准样式",
    fields: [
      { key: "product", label: "商品", placeholder: "名称和外观，如：哑光白陶瓷马克杯，木质把手", example: "哑光白陶瓷马克杯，原木把手" },
      { key: "angle", label: "角度", placeholder: "", example: "45° 侧前方", kind: "choice", options: ["正面", "45° 侧前方", "俯拍", "平放俯视"] },
      { key: "photo", label: "商品照片", placeholder: "", example: "已加到参考图", kind: "choice", options: ["已加到参考图", "没有，按描述画"], control: true },
    ],
    build: (v) =>
      lines(
        "电商白底主图，用作商品详情页首图",
        `纯白背景（#FFFFFF），${v.product}居中，约占画面 75%，${v.angle}拍摄`,
        "柔和均匀的棚拍光，底部一点自然投影，边缘干净利落，材质和颜色真实",
        v.photo === "已加到参考图" && "商品以参考图为准：外形、颜色、logo 和包装上的文字保持完全一致，只换成白底和重新布光",
        NO_EXTRA_TEXT,
      ),
    aspectRatio: "1:1",
    resolution: "2K",
    quality: "high",
    reference: { need: "recommended", hint: "把商品照片加到参考图，出来的才是你的商品" },
  },
  {
    id: "ecom-scene",
    name: "商品场景图",
    category: "ecommerce",
    summary: "把商品放进真实使用场景，道具不抢主体",
    fields: [
      { key: "product", label: "商品", placeholder: "如：玻璃冷萃咖啡瓶", example: "透明玻璃冷萃咖啡瓶，黑色瓶盖" },
      { key: "scene", label: "场景", placeholder: "在哪里、和什么在一起", example: "清晨厨房的木质台面，旁边有一盘可颂" },
      { key: "light", label: "光线", placeholder: "", example: "清晨窗边自然光", kind: "choice", options: ["清晨窗边自然光", "午后暖阳", "夜晚氛围灯", "户外阳光", "影棚柔光"] },
    ],
    build: (v) =>
      lines(
        "电商场景图，展示商品的使用场景",
        `${v.scene}，${v.product}是画面主体，放在视觉中心偏前的位置，清晰对焦`,
        `${v.light}，浅景深，背景自然虚化`,
        "道具颜色比商品弱，不抢主体；商品的外形、颜色、标签保持与参考图一致（如有）",
        "写实摄影质感",
        NO_EXTRA_TEXT,
      ),
    aspectRatio: "1:1",
    resolution: "2K",
    quality: "high",
    reference: { need: "recommended", hint: "有商品照片就加到参考图" },
  },
  {
    id: "ecom-selling-point",
    name: "详情页卖点图",
    category: "ecommerce",
    summary: "一屏讲一个卖点，大标题配商品特写",
    fields: [
      { key: "product", label: "商品", placeholder: "如：降噪无线耳机", example: "白色降噪无线耳机" },
      { key: "title", label: "卖点标题", placeholder: "10 个字以内", example: "一键安静", max: 16 },
      { key: "detail", label: "画面表现", placeholder: "怎样把卖点画出来", example: "耳机悬浮，周围的声波线条在靠近时消散", kind: "textarea" },
      { key: "style", label: "风格", placeholder: "", example: "简约科技", kind: "choice", options: ["简约科技", "自然清新", "高级质感", "活力撞色"] },
    ],
    build: (v) =>
      lines(
        "电商详情页卖点图，竖版一屏，只讲一个卖点",
        `${v.style}风格。${v.product}的特写占画面下方 60%，${v.detail}`,
        "上方留出干净的区域放标题",
        exactText("标题", v.title ?? "", "粗体无衬线字，深色，居中在画面上方"),
        "除标题外不要其他文字和水印",
      ),
    aspectRatio: "3:4",
    resolution: "2K",
    quality: "high",
    textHeavy: true,
    tips: ["价格、规格、促销信息别让模型画，出图后用画布文字叠加，改起来方便"],
  },
  {
    id: "ecom-model",
    name: "模特上身图",
    category: "ecommerce",
    summary: "服饰、配饰穿戴在模特身上，真实街拍或棚拍",
    fields: [
      { key: "item", label: "商品", placeholder: "如：燕麦色羊毛开衫", example: "燕麦色粗针羊毛开衫" },
      { key: "model", label: "模特", placeholder: "年龄感、气质、发型", example: "二十多岁的亚洲女性，短发，气质干净" },
      { key: "scene", label: "场景", placeholder: "", example: "秋天城市街角", kind: "choice", options: ["纯色影棚", "秋天城市街角", "咖啡馆窗边", "海边", "公园草地"] },
    ],
    build: (v) =>
      lines(
        "服装电商模特图，全身或七分身构图",
        `${v.model}穿着${v.item}，站在${v.scene}，姿态自然放松，看向镜头外`,
        "衣服的版型、颜色、面料纹理和细节以参考图为准，合身、褶皱自然",
        "写实摄影，真实皮肤质感，不要过度磨皮，光线与场景一致",
        NO_EXTRA_TEXT,
      ),
    aspectRatio: "3:4",
    resolution: "2K",
    quality: "high",
    reference: { need: "recommended", hint: "把商品平铺图或挂拍图加到参考图" },
  },

  // ── 海报 ──────────────────────────────────────────────────────────
  {
    id: "poster-event",
    name: "活动海报",
    category: "poster",
    summary: "主标题 + 一个视觉焦点，信息层级清楚",
    fields: [
      { key: "theme", label: "活动", placeholder: "什么活动、给谁看", example: "周末城市市集，面向年轻家庭" },
      { key: "title", label: "主标题", placeholder: "10 个字以内", example: "夏日市集", max: 16 },
      { key: "visual", label: "主视觉", placeholder: "画面中心画什么", example: "一辆装满水果和鲜花的复古小推车" },
      { key: "style", label: "风格", placeholder: "", example: "复古丝网印刷", kind: "choice", options: ["复古丝网印刷", "日式极简", "扁平插画", "孟菲斯撞色", "电影感摄影"] },
    ],
    build: (v) =>
      lines(
        `${v.theme}的活动海报，竖版`,
        `${v.style}风格，只有一个视觉焦点：${v.visual}，位于画面下半部分`,
        "上方约三分之一是干净的背景，留给标题，四周留白充足",
        exactText("主标题", v.title ?? "", "醒目的粗体，占画面宽度约一半，居中在上方"),
        "除主标题外不要其他文字",
      ),
    aspectRatio: "3:4",
    resolution: "2K",
    quality: "high",
    textHeavy: true,
    tips: ["日期、地址、二维码说明这类必须一字不差的内容，出图后用画布文字加"],
  },
  {
    id: "poster-festival",
    name: "节日海报",
    category: "poster",
    summary: "节日元素 + 祝福语，适合朋友圈和门店屏",
    fields: [
      { key: "festival", label: "节日", placeholder: "如：中秋", example: "中秋" },
      { key: "greeting", label: "祝福语", placeholder: "8 个字以内", example: "月圆人团圆", max: 12 },
      { key: "elements", label: "画面元素", placeholder: "可选，如：月亮、玉兔、灯笼", example: "圆月、桂花枝、远处的灯笼", optional: true },
      { key: "tone", label: "色调", placeholder: "", example: "深蓝夜色配暖金", kind: "choice", options: ["深蓝夜色配暖金", "中国红", "清雅浅色", "复古暖调"] },
    ],
    build: (v) =>
      lines(
        `${v.festival}节日海报，竖版，用于手机分享`,
        `${v.tone}色调，${v.elements || `${v.festival}的代表元素`}，构图简洁有层次，有东方韵味`,
        exactText("祝福语", v.greeting ?? "", "书法感或优雅的衬线字，放在画面上方留白处"),
        "除祝福语外不要其他文字",
      ),
    aspectRatio: "9:16",
    resolution: "2K",
    quality: "high",
    textHeavy: true,
  },
  {
    id: "poster-type",
    name: "大字报",
    category: "poster",
    summary: "几个大字撑满画面，字就是主视觉",
    fields: [
      { key: "words", label: "大字", placeholder: "2–6 个字", example: "慢一点", max: 10 },
      { key: "palette", label: "配色", placeholder: "", example: "米白底、墨黑字、一点朱红", kind: "choice", options: ["米白底、墨黑字、一点朱红", "纯黑底、荧光绿字", "克莱因蓝底、白字", "渐变暖橙底、深棕字"] },
      { key: "small", label: "小字", placeholder: "可选，一行英文或说明", example: "SLOW DOWN", optional: true, max: 30 },
    ],
    build: (v) =>
      lines(
        "极简字体海报，竖版，字体就是主视觉",
        `${v.palette}，大面积纯色背景，可以有细微的纸张纹理`,
        exactText("大字", v.words ?? "", "超大粗体，撑满画面宽度，排版有张力"),
        v.small ? exactText("小字", v.small, "很小的细体，放在右下角") : "除大字外不要其他文字",
      ),
    aspectRatio: "3:4",
    resolution: "2K",
    quality: "high",
    textHeavy: true,
  },

  // ── 社媒封面 ──────────────────────────────────────────────────────
  {
    id: "social-xhs",
    name: "小红书封面",
    category: "social",
    summary: "3:4 竖版，大标题缩小后也一眼看清",
    fields: [
      { key: "topic", label: "主题", placeholder: "这篇笔记讲什么", example: "周末露营装备清单" },
      { key: "title", label: "标题", placeholder: "12 个字以内", example: "新手露营照抄就行", max: 16 },
      { key: "subject", label: "画面主体", placeholder: "", example: "草地上搭好的帐篷和摆开的露营桌椅" },
      { key: "style", label: "风格", placeholder: "", example: "清新胶片", kind: "choice", options: ["清新胶片", "高级极简", "多巴胺撞色", "手账拼贴"] },
    ],
    build: (v) =>
      lines(
        `小红书笔记封面，主题是${v.topic}，竖版 3:4`,
        `${v.style}风格，${v.subject}，主体清楚、背景不杂乱`,
        exactText("标题", v.title ?? "", "大号粗体，带描边或色块衬底，占画面宽度的 70% 以上，放在上半部分"),
        "缩小到手机信息流里也能看清标题；除标题外不要其他文字",
      ),
    aspectRatio: "3:4",
    resolution: "2K",
    quality: "high",
    textHeavy: true,
  },
  {
    id: "social-video",
    name: "视频封面",
    category: "social",
    summary: "16:9 横版，人物情绪 + 大字标题",
    fields: [
      { key: "title", label: "标题", placeholder: "8 个字以内", example: "一周只花 300", max: 12 },
      { key: "subject", label: "人物或主体", placeholder: "", example: "一位惊讶的年轻男生举着购物小票" },
      { key: "bg", label: "背景", placeholder: "", example: "明亮的超市货架，略微虚化" },
    ],
    build: (v) =>
      lines(
        "视频封面，横版 16:9，用于 B 站和视频号",
        `${v.subject}，位于画面右侧，表情和动作夸张清楚；${v.bg}`,
        "左侧留出位置放标题，高对比度，色彩饱和",
        exactText("标题", v.title ?? "", "超大粗体，白字黑描边，放在画面左侧"),
        "除标题外不要其他文字",
      ),
    aspectRatio: "16:9",
    resolution: "2K",
    quality: "high",
    textHeavy: true,
  },
  {
    id: "social-header",
    name: "公众号头图",
    category: "social",
    summary: "超宽横幅，主体居中，两边可裁",
    fields: [
      { key: "topic", label: "文章主题", placeholder: "", example: "城市里的第一场秋雨" },
      { key: "style", label: "风格", placeholder: "", example: "电影感摄影", kind: "choice", options: ["电影感摄影", "水彩插画", "扁平插画", "极简几何"] },
    ],
    build: (v) =>
      lines(
        `公众号文章头图，超宽横幅，主题是${v.topic}`,
        `${v.style}风格，主体放在画面中间三分之一，两侧是可以被裁掉的延伸背景`,
        "氛围统一，色调克制",
        NO_EXTRA_TEXT,
      ),
    aspectRatio: "21:9",
    resolution: "2K",
    quality: "medium",
  },

  // ── 品牌 ──────────────────────────────────────────────────────────
  {
    id: "brand-logo",
    name: "标志草案",
    category: "brand",
    summary: "简洁可缩放的平面标志，先出方向再细化",
    fields: [
      { key: "name", label: "品牌名", placeholder: "要出现在标志里的字", example: "山野咖啡", max: 16 },
      { key: "industry", label: "行业", placeholder: "", example: "精品咖啡店" },
      { key: "traits", label: "性格", placeholder: "2–3 个词", example: "温暖、自然、有手作感" },
      { key: "form", label: "形式", placeholder: "", example: "图形 + 文字", kind: "choice", options: ["图形 + 文字", "纯文字字标", "首字母图形", "圆形徽章"] },
    ],
    build: (v) =>
      lines(
        `${v.industry}的品牌标志设计草案，形式是${v.form}，品牌性格：${v.traits}`,
        "简洁的平面矢量风格，线条和形状干净，缩小到图标大小也能认出",
        exactText("品牌名", v.name ?? "", "字体与图形风格统一"),
        "纯色浅背景，标志居中；不要立体效果、渐变阴影、样机和多余装饰",
      ),
    aspectRatio: "1:1",
    resolution: "2K",
    quality: "high",
    textHeavy: true,
    tips: ["AI 出的标志是方向稿，正式使用前要找设计师矢量化并做商标检索"],
  },
  {
    id: "brand-mockup",
    name: "物料样机",
    category: "brand",
    summary: "把标志放到名片、纸袋、杯子上看效果",
    fields: [
      { key: "brand", label: "品牌", placeholder: "品牌名和调性", example: "山野咖啡，温暖自然" },
      { key: "item", label: "物料", placeholder: "", example: "外带纸杯和牛皮纸袋", kind: "choice", options: ["外带纸杯和牛皮纸袋", "名片和信封", "帆布袋", "门头招牌", "T 恤"] },
      { key: "palette", label: "配色", placeholder: "", example: "奶咖色、深棕、一点橄榄绿" },
    ],
    build: (v) =>
      lines(
        `品牌物料样机：${v.item}，品牌是${v.brand}`,
        `把参考图里的标志印在物料上，位置和比例合适，标志的形状、文字和颜色保持不变`,
        `整体配色${v.palette}，放在干净的桌面上，柔和自然光，写实摄影质感`,
        "除标志外不要其他文字",
      ),
    aspectRatio: "4:3",
    resolution: "2K",
    quality: "high",
    reference: { need: "required", hint: "把标志图片加到参考图" },
  },
  {
    id: "brand-packaging",
    name: "包装设计",
    category: "brand",
    summary: "盒、瓶、袋、罐的包装正视效果",
    fields: [
      { key: "product", label: "产品", placeholder: "", example: "冻干花茶" },
      { key: "form", label: "包装", placeholder: "", example: "铁罐", kind: "choice", options: ["纸盒", "玻璃瓶", "铝箔袋", "铁罐", "礼盒"] },
      { key: "name", label: "品牌名", placeholder: "印在包装上的字", example: "花间", max: 12 },
      { key: "style", label: "风格", placeholder: "", example: "新中式插画", kind: "choice", options: ["新中式插画", "极简留白", "复古手绘", "潮流撞色"] },
    ],
    build: (v) =>
      lines(
        `${v.product}的${v.form}包装设计，正面视角的产品渲染图`,
        `${v.style}风格，图案围绕产品特点展开，正面主视觉清晰`,
        exactText("品牌名", v.name ?? "", "放在包装正面上部，字体与风格统一"),
        "浅色无缝背景，柔和棚拍光，真实印刷和材质质感；除品牌名外不要其他文字",
      ),
    aspectRatio: "4:5",
    resolution: "2K",
    quality: "high",
    textHeavy: true,
  },

  // ── 写实摄影 ──────────────────────────────────────────────────────
  {
    id: "photo-portrait",
    name: "写实人像",
    category: "photo",
    summary: "像真实照片的人像，光线和镜头感可选",
    fields: [
      { key: "person", label: "人物", placeholder: "年龄感、样貌、穿着、动作", example: "三十岁左右的男性，灰色毛衣，正低头看书" },
      { key: "place", label: "场景", placeholder: "", example: "老式书店的窗边" },
      { key: "light", label: "光线", placeholder: "", example: "窗边自然光", kind: "choice", options: ["窗边自然光", "黄金时刻逆光", "棚拍柔光", "霓虹夜景"] },
      { key: "lens", label: "镜头感", placeholder: "", example: "85mm 人像", kind: "choice", options: ["35mm 纪实", "85mm 人像", "广角环境人像"] },
    ],
    build: (v) =>
      lines(
        `写实人像照片：${v.person}，在${v.place}`,
        `${v.light}，${v.lens}的视角和景深，构图自然`,
        "真实皮肤纹理和毛发细节，不要过度磨皮、不要摆拍感，像一张真实拍到的照片",
        NO_EXTRA_TEXT,
      ),
    aspectRatio: "3:4",
    resolution: "2K",
    quality: "high",
  },
  {
    id: "photo-food",
    name: "美食摄影",
    category: "photo",
    summary: "菜单、外卖平台、探店都能用",
    fields: [
      { key: "dish", label: "菜品", placeholder: "", example: "一碗红烧牛肉面，汤色红亮，撒了葱花" },
      { key: "table", label: "器皿与桌面", placeholder: "", example: "粗陶碗，深色木桌" },
      { key: "angle", label: "角度", placeholder: "", example: "45° 斜拍", kind: "choice", options: ["俯拍", "45° 斜拍", "平视特写"] },
    ],
    build: (v) =>
      lines(
        `美食摄影：${v.dish}，${v.table}`,
        `${v.angle}，侧逆光勾出热气和油光，浅景深，配菜和餐具点到为止`,
        "色彩诱人但真实，食材质感清楚",
        NO_EXTRA_TEXT,
      ),
    aspectRatio: "4:5",
    resolution: "2K",
    quality: "high",
  },
  {
    id: "photo-interior",
    name: "室内空间",
    category: "photo",
    summary: "家装、民宿、门店的空间效果",
    fields: [
      { key: "space", label: "空间", placeholder: "", example: "20 平米的客厅，朝南大窗" },
      { key: "style", label: "风格", placeholder: "", example: "日式原木", kind: "choice", options: ["日式原木", "北欧简约", "法式复古", "现代极简", "中古风"] },
      { key: "time", label: "时间光线", placeholder: "", example: "午后阳光斜射进来", kind: "choice", options: ["午后阳光斜射进来", "清晨柔光", "傍晚暖灯", "阴天漫射光"] },
    ],
    build: (v) =>
      lines(
        `室内空间摄影：${v.space}，${v.style}风格`,
        `${v.time}，人眼高度的广角视角，透视端正，家具比例真实`,
        "材质（木、布、石材）质感清楚，干净整洁但有生活气息",
        NO_EXTRA_TEXT,
      ),
    aspectRatio: "3:2",
    resolution: "2K",
    quality: "high",
  },

  // ── 插画 ──────────────────────────────────────────────────────────
  {
    id: "illus-character",
    name: "角色设定图",
    category: "illustration",
    summary: "同一角色的正面、侧面、背面，后续出图拿它做参考",
    fields: [
      { key: "character", label: "角色", placeholder: "外形、服装、标志性特征", example: "戴黄色雨帽的小狐狸，背着绿色小书包" },
      { key: "style", label: "画风", placeholder: "", example: "温暖的水彩绘本", kind: "choice", options: ["温暖的水彩绘本", "日系动画", "3D 黏土", "扁平矢量"] },
    ],
    build: (v) =>
      lines(
        `角色设定图：${v.character}`,
        `${v.style}风格，同一个角色的正面、侧面、背面三个视角并排，全身，比例一致`,
        "纯白背景，角色之间留出间距，服装和配色在三个视角里完全一致",
        NO_EXTRA_TEXT,
      ),
    aspectRatio: "16:9",
    resolution: "2K",
    quality: "high",
    tips: ["满意后，把这张设定图作为参考图去画后续场景，角色就不会变样"],
  },
  {
    id: "illus-sticker",
    name: "表情贴纸",
    category: "illustration",
    summary: "一个角色四种表情，2×2 排好",
    fields: [
      { key: "character", label: "角色", placeholder: "", example: "圆滚滚的橘猫" },
      { key: "moods", label: "四个表情", placeholder: "用顿号隔开", example: "开心、委屈、比心、困了" },
      { key: "style", label: "画风", placeholder: "", example: "粗描边卡通", kind: "choice", options: ["粗描边卡通", "软萌 Q 版", "像素风", "手绘蜡笔"] },
    ],
    build: (v) =>
      lines(
        `一组表情贴纸：${v.character}的四个表情——${v.moods}`,
        `${v.style}风格，四张排成 2×2 网格，每张角色居中、有白色贴纸描边`,
        "同一个角色，外形和配色一致，表情和动作夸张易懂",
        "纯色浅背景，不要文字",
      ),
    aspectRatio: "1:1",
    resolution: "2K",
    quality: "medium",
  },
  {
    id: "illus-picturebook",
    name: "绘本插画",
    category: "illustration",
    summary: "一页绘本的画面，留出放文字的位置",
    fields: [
      { key: "scene", label: "这一页的情节", placeholder: "", example: "小狐狸在雨夜的森林里找到一座亮着灯的灯塔", kind: "textarea" },
      { key: "style", label: "画风", placeholder: "", example: "水彩", kind: "choice", options: ["水彩", "彩铅", "剪纸拼贴", "扁平插画", "油画棒"] },
    ],
    build: (v) =>
      lines(
        `儿童绘本内页插画：${v.scene}`,
        `${v.style}风格，温暖柔和，有故事感，角色表情清楚`,
        "画面上方或下方留出一块安静的区域，后期放文字",
        NO_EXTRA_TEXT,
      ),
    aspectRatio: "4:3",
    resolution: "2K",
    quality: "medium",
    tips: ["一本书里的角色要一致：先用「角色设定图」出设定，再把它作为参考图"],
  },
  {
    id: "illus-icons",
    name: "图标组",
    category: "illustration",
    summary: "一组风格统一的图标，适合 App 和 PPT",
    fields: [
      { key: "theme", label: "主题", placeholder: "", example: "智能家居" },
      { key: "items", label: "图标", placeholder: "用顿号隔开，4–9 个", example: "灯泡、空调、门锁、摄像头、音箱、窗帘" },
      { key: "style", label: "风格", placeholder: "", example: "3D 黏土", kind: "choice", options: ["3D 黏土", "玻璃拟态", "线性描边", "扁平填色"] },
    ],
    build: (v) =>
      lines(
        `${v.theme}主题的一组图标：${v.items}`,
        `${v.style}风格，统一的视角、光线、圆角和配色，网格整齐排列，每个图标间距相同`,
        "纯色浅背景，不要文字和标签",
      ),
    aspectRatio: "1:1",
    resolution: "2K",
    quality: "high",
  },

  // ── 信息图 ────────────────────────────────────────────────────────
  {
    id: "info-process",
    name: "流程图解",
    category: "infographic",
    summary: "把几个步骤画成一张能看懂的图",
    fields: [
      { key: "topic", label: "主题", placeholder: "", example: "手冲咖啡的步骤" },
      { key: "steps", label: "步骤", placeholder: "每行一步，3–6 步，每步几个字", example: "磨豆\n温杯\n闷蒸 30 秒\n分段注水\n享用", kind: "textarea" },
      { key: "audience", label: "给谁看", placeholder: "", example: "第一次手冲的新手" },
    ],
    build: (v) => {
      const steps = (v.steps ?? "")
        .split(/\n+/)
        .map((s) => s.trim())
        .filter(Boolean);
      return lines(
        `信息图：${v.topic}，给${v.audience}看`,
        `从上到下 ${steps.length} 个步骤，每步一个简洁的插图配一个编号和短标签`,
        `步骤标签依次是：${steps.map((s, i) => `${i + 1}. "${s}"`).join("，")}，每个标签字形准确、只出现一次`,
        "扁平插画风格，配色统一，箭头或连线表示顺序，留白充足；除步骤标签外不要其他文字",
      );
    },
    aspectRatio: "3:4",
    resolution: "2K",
    quality: "high",
    textHeavy: true,
    tips: ["文字越少越准；步骤多时分成两张图"],
  },
  {
    id: "info-card",
    name: "知识卡片",
    category: "infographic",
    summary: "一个标题、三个要点，适合分享",
    fields: [
      { key: "title", label: "标题", placeholder: "10 个字以内", example: "睡前三不要", max: 16 },
      { key: "points", label: "三个要点", placeholder: "每行一个，每个 6 个字以内", example: "不刷手机\n不喝咖啡\n不吃夜宵", kind: "textarea" },
      { key: "palette", label: "配色", placeholder: "", example: "深蓝底、米白字、暖黄点缀", kind: "choice", options: ["深蓝底、米白字、暖黄点缀", "米白底、墨绿字", "浅粉底、深棕字", "黑底、荧光绿字"] },
    ],
    build: (v) => {
      const points = (v.points ?? "")
        .split(/\n+/)
        .map((s) => s.trim())
        .filter(Boolean);
      return lines(
        "知识分享卡片，竖版",
        `${v.palette}，版式简洁，每个要点配一个小图标`,
        exactText("标题", v.title ?? "", "大号粗体，放在顶部"),
        `要点文字依次是 ${points.map((p) => `"${p}"`).join("、")}，竖向排列，字形准确，每条只出现一次`,
        "除标题和要点外不要其他文字",
      );
    },
    aspectRatio: "3:4",
    resolution: "2K",
    quality: "high",
    textHeavy: true,
  },

  // ── 改图（需要参考图）─────────────────────────────────────────────
  {
    id: "edit-background",
    name: "换背景",
    category: "edit",
    summary: "主体不动，只换背景和环境光",
    fields: [
      { key: "keep", label: "保留的主体", placeholder: "", example: "画面中的人物" },
      { key: "bg", label: "新背景", placeholder: "", example: "黄昏的海边，远处有灯塔" },
    ],
    build: (v) =>
      lines(
        `把参考图的背景换成${v.bg}`,
        `${v.keep}的外形、面部、服装、姿势和位置保持完全不变`,
        "调整主体边缘的光线和投影，让它自然融入新背景",
        "不要添加新的文字",
      ),
    resolution: "2K",
    quality: "high",
    reference: { need: "required", hint: "把要改的图片加到参考图" },
  },
  {
    id: "edit-remove",
    name: "去掉杂物",
    category: "edit",
    summary: "去路人、去电线、去多余物体",
    fields: [{ key: "target", label: "要去掉的", placeholder: "", example: "背景里的路人和电线" }],
    build: (v) =>
      lines(`去掉参考图中的${v.target}，用周围的环境自然补全`, KEEP_REST, "不要留下痕迹或模糊块"),
    resolution: "2K",
    quality: "high",
    reference: { need: "required", hint: "把要改的图片加到参考图" },
    tips: ["只改一小块时，用结果卡片上的「局部重绘」涂出区域更稳"],
  },
  {
    id: "edit-relight",
    name: "换光线天气",
    category: "edit",
    summary: "同一画面变成黄昏、雪天、夜景",
    fields: [
      { key: "condition", label: "变成", placeholder: "", example: "下雪的傍晚，路灯亮起", kind: "choice", options: ["下雪的傍晚，路灯亮起", "雨后的夜晚，地面有倒影", "黄金时刻的暖光", "清晨的薄雾"] },
    ],
    build: (v) =>
      lines(
        `把参考图的时间和天气改成${v.condition}`,
        "只改变光线、阴影、天空和天气效果（雪、雨、雾、地面湿润）",
        "建筑、人物、物体、构图和视角保持完全不变",
      ),
    resolution: "2K",
    quality: "high",
    reference: { need: "required", hint: "把要改的图片加到参考图" },
  },
  {
    id: "edit-translate",
    name: "图中文字翻译",
    category: "edit",
    summary: "海报、菜单、截图上的文字换成另一种语言",
    fields: [
      { key: "lang", label: "翻译成", placeholder: "", example: "英文", kind: "choice", options: ["英文", "简体中文", "日文", "韩文"] },
    ],
    build: (v) =>
      lines(
        `把参考图中的所有文字翻译成${v.lang}`,
        "每段译文放在原文的位置，字号、颜色、字重和排版方向与原文一致",
        "图片的其他部分、配色和布局完全不变；不要增加原图没有的文字",
      ),
    resolution: "2K",
    quality: "high",
    textHeavy: true,
    reference: { need: "required", hint: "把带文字的图片加到参考图" },
  },
  {
    id: "edit-sketch",
    name: "草图成图",
    category: "edit",
    summary: "手绘草图、线稿变成完整效果图",
    fields: [
      { key: "result", label: "做成", placeholder: "材质、配色、风格", example: "写实的产品渲染，哑光白塑料和浅木色" },
    ],
    build: (v) =>
      lines(
        `把参考图里的草图做成${v.result}`,
        "草图的构图、透视、比例和每个元素的位置保持不变",
        "补上材质、光影和细节，不要添加草图里没有的元素和文字",
      ),
    resolution: "2K",
    quality: "high",
    reference: { need: "required", hint: "把草图或线稿加到参考图" },
  },
  {
    id: "edit-style",
    name: "风格转换",
    category: "edit",
    summary: "内容不变，换成另一种画风",
    fields: [
      { key: "style", label: "目标风格", placeholder: "", example: "吉卜力式水彩动画", kind: "choice", options: ["吉卜力式水彩动画", "复古胶片照片", "像素艺术", "浮世绘版画", "3D 黏土"] },
    ],
    build: (v) =>
      lines(
        `把参考图转换成${v.style}风格`,
        "画面内容、人物和物体的位置、构图保持不变，只改变笔触、色彩处理和质感",
        "不要添加文字",
      ),
    resolution: "2K",
    quality: "medium",
    reference: { need: "required", hint: "把要转换的图片加到参考图" },
  },
  // ── 二次元（第 64 条）────────────────────────────────────────────
  {
    id: "anime-character",
    name: "二次元角色立绘",
    category: "anime",
    summary: "日系动画风格的角色立绘，发型、服装、姿势都能定",
    fields: [
      { key: "character", label: "角色", placeholder: "性别年龄感、发型发色、眼睛、服装", example: "银色长发的少女，蓝色眼睛，白色水手服配红色领巾", examples: ["黑色短发的少年剑士，金色眼睛，深蓝立领长外套", "粉色双马尾的魔法少女，紫色眼睛，星星图案的短斗篷"] },
      { key: "pose", label: "姿势与表情", placeholder: "", example: "回头微笑，一手拨开被风吹起的头发", examples: ["单手持剑，眼神坚定地看向前方", "双手捧着发光的星星，开心地眨眼"] },
      { key: "style", label: "画风", placeholder: "", example: "赛璐璐上色", kind: "choice", options: ["赛璐璐上色", "厚涂", "水彩柔和", "90 年代复古动画"] },
      { key: "frame", label: "构图", placeholder: "", example: "全身立绘", kind: "choice", options: ["全身立绘", "半身像", "腰部以上特写"] },
      { key: "bg", label: "背景", placeholder: "", example: "纯白背景", kind: "choice", options: ["纯白背景", "淡色渐变背景", "简单的场景背景"] },
      { key: "extras", label: "配饰", placeholder: "", example: "耳机、发带", kind: "multi", options: ["猫耳", "眼镜", "耳机", "发带", "围巾", "长剑", "法杖"], optional: true },
    ],
    build: (v) =>
      lines(
        `二次元角色立绘，${v.frame}`,
        `角色：${v.character}`,
        v.extras && `配饰：${v.extras}`,
        `姿势与表情：${v.pose}`,
        `日系动画风格，${v.style}，线条干净利落，五官比例统一，手部结构正确`,
        `${v.bg}，角色完整、不被裁切`,
        NO_EXTRA_TEXT,
      ),
    aspectRatio: "2:3",
    resolution: "2K",
    quality: "high",
    tips: ["满意后可以把这张作为参考图，再出同一角色的其他姿势或场景"],
  },
  {
    id: "anime-scene",
    name: "动画电影场景",
    category: "anime",
    summary: "像动画电影里的一帧背景：光影、天空、城市细节",
    fields: [
      { key: "place", label: "地点", placeholder: "", example: "海边小镇的电车站台", examples: ["放学后的天台", "雨后的城市十字路口", "山间的神社石阶"] },
      { key: "time", label: "时间与天气", placeholder: "", example: "夏日傍晚，积雨云被夕阳染成橙粉色", kind: "choice", options: ["夏日傍晚，积雨云被夕阳染成橙粉色", "雨后初晴，地面积水倒映天空", "深夜，星空和城市灯火", "清晨薄雾，阳光穿过树梢"] },
      { key: "people", label: "人物", placeholder: "可不写", example: "一个女孩背对镜头站在站台边", optional: true },
    ],
    build: (v) =>
      lines(
        `日本动画电影风格的场景画面：${v.place}，${v.time}`,
        v.people && `画面里有：${v.people}，人物很小，景是主角`,
        "背景美术极其细致：电线、招牌、植物、云层都有层次，光线有丁达尔效应和镜头光晕，色彩通透饱和",
        "宽画幅电影构图，前景、中景、远景分明",
        NO_EXTRA_TEXT,
      ),
    aspectRatio: "16:9",
    resolution: "2K",
    quality: "high",
  },
  {
    id: "anime-chibi",
    name: "Q 版小人",
    category: "anime",
    summary: "二头身的可爱小人，适合头像、周边、贴纸",
    fields: [
      { key: "character", label: "角色", placeholder: "", example: "戴圆框眼镜、抱着一摞书的女孩", examples: ["穿宇航服的小猫", "拿着奶茶的程序员男孩"] },
      { key: "action", label: "动作", placeholder: "", example: "踮着脚努力往上看", examples: ["开心地挥手", "趴在桌上睡着了"] },
      { key: "style", label: "质感", placeholder: "", example: "软萌平涂", kind: "choice", options: ["软萌平涂", "3D 软胶", "毛绒玩偶", "手绘蜡笔"] },
    ],
    build: (v) =>
      lines(
        `Q 版二头身小人：${v.character}，${v.action}`,
        `${v.style}风格，大头小身，圆润的轮廓，表情生动`,
        "角色居中，四周留白，纯色浅背景，适合做头像或贴纸",
        NO_EXTRA_TEXT,
      ),
    aspectRatio: "1:1",
    resolution: "2K",
    quality: "medium",
  },
  {
    id: "anime-avatar",
    name: "动漫头像",
    category: "anime",
    summary: "正方形头像，人物居中、背景简洁，社交平台直接用",
    fields: [
      { key: "look", label: "长相与发型", placeholder: "", example: "黑色齐肩发的女生，戴白色耳机", examples: ["棕色卷发的男生，戴黑框眼镜", "金发的狐耳少女"] },
      { key: "mood", label: "表情", placeholder: "", example: "安静地微笑", kind: "choice", options: ["安静地微笑", "眨眼比耶", "认真看向镜头", "害羞脸红"] },
      { key: "bg", label: "背景色", placeholder: "", example: "浅薄荷绿", examples: ["奶油黄", "雾霾蓝"] },
    ],
    build: (v) =>
      lines(
        `动漫风格头像，正方形构图，胸部以上`,
        `${v.look}，${v.mood}，看向镜头`,
        `${v.bg}的纯色背景，人物居中，头顶和两侧留出余量，圆形裁切后也完整`,
        "日系动画上色，线条干净，眼睛有高光",
        NO_EXTRA_TEXT,
      ),
    aspectRatio: "1:1",
    resolution: "1K",
    quality: "medium",
  },
  {
    id: "anime-from-photo",
    name: "照片转动漫",
    category: "anime",
    summary: "把参考图里的人和场景画成动画风格，构图不变",
    fields: [
      { key: "style", label: "动画风格", placeholder: "", example: "日系动画电影", kind: "choice", options: ["日系动画电影", "美式卡通", "吉卜力式手绘", "赛博朋克动画"] },
      { key: "keep", label: "一定要保留", placeholder: "", example: "人物的发型、衣服颜色和手里的花", optional: true },
    ],
    build: (v) =>
      lines(
        `把参考图画成${v.style}风格的插画`,
        "人物的姿势、表情、衣着、构图和背景布局都和原图一致，只改变画法",
        v.keep && `特别保留：${v.keep}`,
        "线条和上色统一成动画风格，不保留照片质感",
        "其余内容保持不变",
        NO_EXTRA_TEXT,
      ),
    resolution: "2K",
    quality: "high",
    reference: { need: "required", hint: "把要转换的照片加到参考图" },
  },

  // ── 漫画 ──────────────────────────────────────────────────────────
  {
    id: "comic-4koma",
    name: "四格漫画",
    category: "comic",
    summary: "起承转合四格，竖排，可带简短对白",
    fields: [
      { key: "character", label: "主角", placeholder: "", example: "一只想减肥的胖橘猫" },
      { key: "panel1", label: "第 1 格", placeholder: "", example: "橘猫站上体重秤，一脸震惊" },
      { key: "panel2", label: "第 2 格", placeholder: "", example: "橘猫下定决心在跑步机上跑步" },
      { key: "panel3", label: "第 3 格", placeholder: "", example: "主人拿出小鱼干，橘猫停下脚步" },
      { key: "panel4", label: "第 4 格", placeholder: "", example: "橘猫抱着小鱼干满足地躺平" },
      { key: "speech", label: "对白", placeholder: "", example: "只画画面，不要对白", kind: "choice", options: ["只画画面，不要对白", "每格一句短对白"], control: true },
    ],
    build: (v) =>
      lines(
        `一页竖排的四格漫画，四个格子从上到下，大小一致，格子之间有白色间隔`,
        `主角：${v.character}，四格里外形、配色完全一致`,
        `第 1 格：${v.panel1}`,
        `第 2 格：${v.panel2}`,
        `第 3 格：${v.panel3}`,
        `第 4 格：${v.panel4}`,
        "日式漫画线稿加浅色上色，表情夸张、动作清楚",
        v.speech === "每格一句短对白"
          ? "每格最多一个对话气泡，句子短，中文字形准确"
          : "不画对话气泡，也不写任何文字",
      ),
    aspectRatio: "9:16",
    resolution: "2K",
    quality: "high",
    textHeavy: true,
    tips: ["要对白时，在生成后检查错字；对白长的话，建议出图后在画布上加文字"],
  },
  {
    id: "comic-page",
    name: "漫画分镜页",
    category: "comic",
    summary: "一页漫画，多个格子讲一段情节，有远近景变化",
    fields: [
      { key: "story", label: "这一页的情节", placeholder: "按顺序写几个画面", example: "少年在雨夜的巷子里被人跟踪，他回头，发现是一只浑身湿透的黑猫，最后他把猫抱进外套里", kind: "textarea" },
      { key: "panels", label: "格数", placeholder: "", example: "5 格", kind: "choice", options: ["4 格", "5 格", "6 格"] },
      { key: "tone", label: "风格", placeholder: "", example: "黑白网点日漫", kind: "choice", options: ["黑白网点日漫", "彩色韩漫条漫", "美漫粗线条"] },
    ],
    build: (v) =>
      lines(
        `一整页漫画，${v.panels}，格子大小有变化，阅读顺序清楚`,
        `情节：${v.story}`,
        `${v.tone}风格，每格一个镜头：有远景交代环境，有特写表现情绪，有动作的速度线`,
        "同一角色在每格里样貌一致，不写对白和拟声字",
      ),
    aspectRatio: "2:3",
    resolution: "2K",
    quality: "high",
  },
  {
    id: "comic-cover",
    name: "美漫封面",
    category: "comic",
    summary: "超级英雄漫画封面：大标题、强透视、高饱和",
    fields: [
      { key: "hero", label: "主角", placeholder: "", example: "穿红色机甲战衣的女英雄" },
      { key: "action", label: "动作", placeholder: "", example: "从摩天楼顶跃下，身后是爆炸的火光" },
      { key: "title", label: "刊名", placeholder: "", example: "RED NOVA" },
    ],
    build: (v) =>
      lines(
        `美式漫画杂志封面，竖版`,
        `${v.hero}，${v.action}，强烈的仰视透视，动作张力十足`,
        "粗黑描边、网点阴影、高饱和配色，背景有放射状速度线",
        exactText("顶部刊名", v.title ?? "", "粗壮的漫画标题字体，带立体描边"),
        "除刊名外不加其他文字",
      ),
    aspectRatio: "2:3",
    resolution: "2K",
    quality: "high",
    textHeavy: true,
  },

  // ── 影视 ──────────────────────────────────────────────────────────
  {
    id: "film-still",
    name: "电影剧照",
    category: "film",
    summary: "像电影里截下的一帧：类型、镜头、胶片质感都能选",
    fields: [
      { key: "genre", label: "类型", placeholder: "", example: "悬疑", kind: "choice", options: ["悬疑", "科幻", "文艺", "武侠", "西部", "灾难", "爱情"] },
      { key: "scene", label: "画面", placeholder: "地点、人物、正在发生什么", example: "深夜的旧火车站候车厅，一个穿风衣的女人独自坐着，手里攥着一张车票", kind: "textarea" },
      { key: "lens", label: "镜头", placeholder: "", example: "35mm 中景", kind: "choice", options: ["35mm 中景", "85mm 特写", "广角大远景", "低机位仰拍"] },
      { key: "film", label: "影调", placeholder: "", example: "冷青色调，低饱和", kind: "choice", options: ["冷青色调，低饱和", "暖橙与青色对比", "黑白胶片", "复古柯达胶片"] },
    ],
    build: (v) =>
      lines(
        `一帧${v.genre}电影的剧照，宽银幕构图`,
        v.scene,
        `${v.lens}，电影级布光，有明确的主光方向和环境光，${v.film}`,
        "真实的服装、道具和皮肤质感，轻微胶片颗粒，像实拍而不是渲染",
        "画面中没有字幕、片名和水印",
      ),
    aspectRatio: "21:9",
    resolution: "2K",
    quality: "high",
  },
  {
    id: "film-poster",
    name: "电影海报",
    category: "film",
    summary: "主视觉 + 片名 + 一行宣传语，院线海报的版式",
    fields: [
      { key: "title", label: "片名", placeholder: "", example: "长夜将明" },
      { key: "visual", label: "主视觉", placeholder: "", example: "暴雨中的城市天际线，一个举着手电的人站在楼顶边缘", kind: "textarea" },
      { key: "tagline", label: "宣传语", placeholder: "可不写", example: "有些真相，只在天亮前出现", optional: true },
      { key: "mood", label: "气质", placeholder: "", example: "冷峻悬疑", kind: "choice", options: ["冷峻悬疑", "热血动作", "温情文艺", "史诗科幻", "古装武侠"] },
    ],
    build: (v) =>
      lines(
        `${v.mood}风格的院线电影海报，竖版`,
        `主视觉：${v.visual}`,
        exactText("片名", v.title ?? "", "放在画面下三分之一处，大号字体，与主视觉风格统一"),
        v.tagline && exactText("宣传语", v.tagline, "小号字，在片名上方"),
        "版式有电影感：主体与留白分明，色调统一，底部可以有一行细小的装饰线",
        "除片名和宣传语外不出现其他文字",
      ),
    aspectRatio: "2:3",
    resolution: "2K",
    quality: "high",
    textHeavy: true,
  },
  {
    id: "film-tv-poster",
    name: "电视剧海报",
    category: "film",
    summary: "群像排布的剧集海报：古装、都市、悬疑都行",
    fields: [
      { key: "title", label: "剧名", placeholder: "", example: "山河长明" },
      { key: "genre", label: "类型", placeholder: "", example: "古装", kind: "choice", options: ["古装", "都市", "悬疑", "年代", "青春"] },
      { key: "cast", label: "人物", placeholder: "几个主要角色", example: "一位白衣女侠居中，左边是持扇的书生，右边是披甲的将军", kind: "textarea" },
    ],
    build: (v) =>
      lines(
        `${v.genre}电视剧的宣传海报，竖版群像`,
        `人物：${v.cast}，主角最大、居中，其他角色按主次排列，服化道符合${v.genre}题材`,
        "背景是与剧情相关的场景，色调统一，光线有层次",
        exactText("剧名", v.title ?? "", "书法或标题字体，放在画面上方或中下部"),
        "除剧名外不出现其他文字",
      ),
    aspectRatio: "2:3",
    resolution: "2K",
    quality: "high",
    textHeavy: true,
  },
  {
    id: "film-storyboard",
    name: "分镜脚本",
    category: "film",
    summary: "六格分镜，一格一个镜头，拍片前对画面用",
    fields: [
      { key: "story", label: "情节", placeholder: "按顺序写六个镜头", example: "1 清晨城市远景 2 女孩推开窗 3 手捧咖啡特写 4 她看到楼下的猫 5 她冲下楼 6 女孩抱起猫的背影", kind: "textarea" },
      { key: "style", label: "画法", placeholder: "", example: "铅笔素描分镜", kind: "choice", options: ["铅笔素描分镜", "黑白马克笔", "彩色概念分镜"] },
    ],
    build: (v) =>
      lines(
        `一张电影分镜表：六个格子排成 3 列 × 2 行，从左到右、从上到下阅读，每格左上角标数字 1 到 6`,
        `镜头内容：${v.story}`,
        `${v.style}风格，每格标明景别（远景、中景、特写）的变化，人物在各格里一致`,
        "除格子编号外不写其他文字",
      ),
    aspectRatio: "3:2",
    resolution: "2K",
    quality: "high",
  },
  {
    id: "film-costume",
    name: "角色定妆照",
    category: "film",
    summary: "影视角色的定妆照：服装、妆发、道具一张看清",
    fields: [
      { key: "role", label: "角色", placeholder: "", example: "唐代女捕快，英气，二十岁出头" },
      { key: "costume", label: "服装与道具", placeholder: "", example: "绛红色圆领袍，黑色革带，腰间挂铜牌和短刀" },
      { key: "bg", label: "背景", placeholder: "", example: "灰色影棚背景", kind: "choice", options: ["灰色影棚背景", "取景地实景", "黑色背景"] },
    ],
    build: (v) =>
      lines(
        `影视剧的角色定妆照，全身站姿，正面略侧`,
        `角色：${v.role}`,
        `服装与道具：${v.costume}，面料、刺绣和金属件的质感真实`,
        `${v.bg}，棚拍柔光加轮廓光，妆发精致自然`,
        "真实照片质感，像剧组拍的定妆照",
        NO_EXTRA_TEXT,
      ),
    aspectRatio: "2:3",
    resolution: "2K",
    quality: "high",
  },

  // ── 梗图 ──────────────────────────────────────────────────────────
  {
    id: "meme-classic",
    name: "上下文字梗图",
    category: "meme",
    summary: "经典梗图格式：一张图，上面一句、下面一句",
    fields: [
      { key: "image", label: "画面", placeholder: "", example: "一只柴犬坐在办公桌前，表情生无可恋地看着电脑", examples: ["一只猫站在打翻的花瓶旁，一脸无辜"] },
      { key: "top", label: "上方文字", placeholder: "", example: "周一早上九点" },
      { key: "bottom", label: "下方文字", placeholder: "", example: "我人在工位，魂在被窝" },
    ],
    build: (v) =>
      lines(
        `网络梗图，方形`,
        `画面：${v.image}，表情夸张、一眼能看懂情绪`,
        exactText("画面上方", v.top ?? "", "白色粗体字加黑色描边，居中"),
        exactText("画面下方", v.bottom ?? "", "白色粗体字加黑色描边，居中"),
        "两行文字不遮挡主体的脸，除这两行外不出现其他文字",
      ),
    aspectRatio: "1:1",
    resolution: "1K",
    quality: "medium",
    textHeavy: true,
  },
  {
    id: "meme-compare",
    name: "对比梗图",
    category: "meme",
    summary: "左右两格对比：理想与现实、买家秀与卖家秀",
    fields: [
      { key: "left", label: "左格：理想", placeholder: "", example: "健身博主在海边轻松做出完美的平板支撑" },
      { key: "right", label: "右格：现实", placeholder: "", example: "我趴在客厅瑜伽垫上，满头大汗、手臂发抖" },
      { key: "labels", label: "标签", placeholder: "", example: "理想、现实", kind: "choice", options: ["理想、现实", "买家秀、卖家秀", "别人家的、我家的", "周五、周一"], control: true },
    ],
    build: (v) => {
      const [a, b] = (v.labels ?? "").split("、");
      return lines(
        `对比梗图：左右两格并排，中间一条竖线分隔`,
        `左格：${v.left}`,
        `右格：${v.right}`,
        "两格人物或主体对应，反差越大越好笑，写实照片风格",
        a && b ? `左格顶部写 "${a}"，右格顶部写 "${b}"，白底黑字粗体，字形准确，各只出现一次` : "",
        "除这两个标签外不出现其他文字",
      );
    },
    aspectRatio: "16:9",
    resolution: "1K",
    quality: "medium",
    textHeavy: true,
  },
  {
    id: "meme-reaction",
    name: "反应图",
    category: "meme",
    summary: "一张夸张表情配一句话，聊天里发出去就懂",
    fields: [
      { key: "who", label: "主角", placeholder: "", example: "一只戴墨镜的仓鼠", examples: ["一个穿西装的柯基", "一只握着奶茶的熊猫"] },
      { key: "emotion", label: "情绪", placeholder: "", example: "震惊", kind: "choice", options: ["震惊", "无语", "得意", "崩溃", "委屈", "躺平"] },
      { key: "line", label: "配字", placeholder: "可不写", example: "真的假的？", optional: true },
    ],
    build: (v) =>
      lines(
        `聊天用的反应图：${v.who}，表情极度${v.emotion}，夸张而好认`,
        "近景，主角占画面大半，背景简单，写实摄影质感带一点喜剧感",
        v.line ? exactText("画面底部", v.line, "白色粗体字加黑色描边") : "画面中不写文字",
      ),
    aspectRatio: "1:1",
    resolution: "1K",
    quality: "medium",
    textHeavy: true,
  },
  {
    id: "meme-pet",
    name: "萌宠拟人",
    category: "meme",
    summary: "让猫狗做人类的事：上班、开会、做饭",
    fields: [
      { key: "pet", label: "宠物", placeholder: "", example: "一只英短蓝猫" },
      { key: "scene", label: "在做什么", placeholder: "", example: "戴着老花镜坐在办公桌前看报表，旁边放着一杯咖啡" },
      { key: "look", label: "画面风格", placeholder: "", example: "写实摄影", kind: "choice", options: ["写实摄影", "3D 动画电影", "水彩绘本"] },
    ],
    build: (v) =>
      lines(
        `${v.look}风格的萌宠拟人画面：${v.pet}${v.scene}`,
        "动物保持真实的身体结构，只是动作和道具像人，神态认真反而好笑",
        "光线自然，主体清晰，背景细节符合场景",
        NO_EXTRA_TEXT,
      ),
    aspectRatio: "4:5",
    resolution: "2K",
    quality: "medium",
  },

  // ── 超现实 ────────────────────────────────────────────────────────
  {
    id: "surreal-dream",
    name: "超现实梦境",
    category: "surreal",
    summary: "把不可能的事拍成真的：违反常理但细节可信",
    fields: [
      { key: "idea", label: "超现实点子", placeholder: "什么东西出现在不该出现的地方", example: "一条鲸鱼在麦田上空缓缓游过", examples: ["城市街道变成了一条安静的河，行人划着小船", "一扇门立在沙漠中央，门里是下雪的森林"] },
      { key: "light", label: "光线", placeholder: "", example: "黄昏的金色逆光", kind: "choice", options: ["黄昏的金色逆光", "阴天的柔和漫射光", "月光与雾气", "正午强烈的阳光"] },
      { key: "tone", label: "质感", placeholder: "", example: "写实摄影", kind: "choice", options: ["写实摄影", "超现实主义油画", "电影剧照"] },
    ],
    build: (v) =>
      lines(
        `超现实主义画面：${v.idea}`,
        `${v.light}，${v.tone}质感，光影、倒影、尺度和透视都真实可信，让不可能的场景看起来像真的`,
        "构图简洁，主体突出，留出呼吸感的空间",
        NO_EXTRA_TEXT,
      ),
    aspectRatio: "3:2",
    resolution: "2K",
    quality: "high",
  },
  {
    id: "surreal-miniature",
    name: "微缩世界",
    category: "surreal",
    summary: "日常物件里藏着一个微缩小世界，移轴摄影感",
    fields: [
      { key: "container", label: "容器", placeholder: "", example: "一只咖啡杯", examples: ["一本打开的书", "一个玻璃灯泡"] },
      { key: "world", label: "里面的小世界", placeholder: "", example: "一座有温泉和樱花的小镇，冒着热气" },
    ],
    build: (v) =>
      lines(
        `微缩模型摄影：${v.container}里藏着${v.world}`,
        "小房子、小人和树都像精致的手工模型，比例统一",
        "移轴镜头效果，中间清晰、上下虚化，暖色窗灯和柔和的环境光",
        "桌面背景简单，突出容器和里面的小世界",
        NO_EXTRA_TEXT,
      ),
    aspectRatio: "1:1",
    resolution: "2K",
    quality: "high",
  },
  {
    id: "surreal-double-exposure",
    name: "双重曝光",
    category: "surreal",
    summary: "人像轮廓里叠着一片风景，海报感很强",
    fields: [
      { key: "subject", label: "轮廓", placeholder: "", example: "一位女性的侧脸", examples: ["一头雄鹿的侧影", "一个男人的背影"] },
      { key: "inside", label: "轮廓里的画面", placeholder: "", example: "雾气中的松林和远山" },
      { key: "bg", label: "底色", placeholder: "", example: "纯白", kind: "choice", options: ["纯白", "纯黑", "暖米色"] },
    ],
    build: (v) =>
      lines(
        `双重曝光艺术照：${v.subject}的剪影轮廓里，融合着${v.inside}`,
        "边缘过渡自然，风景顺着轮廓的形状分布，局部保留五官或主体的细节",
        `${v.bg}背景，配色克制，构图居中`,
        NO_EXTRA_TEXT,
      ),
    aspectRatio: "3:4",
    resolution: "2K",
    quality: "high",
  },
  {
    id: "surreal-giant",
    name: "巨物尺度",
    category: "surreal",
    summary: "巨大的东西出现在日常场景里，强烈的尺度反差",
    fields: [
      { key: "giant", label: "巨物", placeholder: "", example: "一只比楼还高的橘猫", examples: ["一颗巨大的月亮贴着海面", "一只巨型水母飘在城市上空"] },
      { key: "place", label: "场景", placeholder: "", example: "清晨的老城区街道，行人抬头张望" },
    ],
    build: (v) =>
      lines(
        `尺度反差强烈的超现实摄影：${v.giant}出现在${v.place}`,
        "用人、车、建筑做参照，巨物的光影、阴影和地面接触真实，空气透视自然",
        "广角低机位，电影剧照质感",
        NO_EXTRA_TEXT,
      ),
    aspectRatio: "16:9",
    resolution: "2K",
    quality: "high",
  },

  // ── 写实摄影（续）────────────────────────────────────────────────
  {
    id: "photo-headshot",
    name: "职业形象照",
    category: "photo",
    summary: "简历、领英、团队页用的形象照，干净专业",
    fields: [
      { key: "person", label: "人物", placeholder: "", example: "三十岁出头的女性，齐肩短发，深蓝色西装外套" },
      { key: "bg", label: "背景", placeholder: "", example: "浅灰纯色背景", kind: "choice", options: ["浅灰纯色背景", "虚化的办公室", "白色背景", "暖色木纹墙"] },
      { key: "vibe", label: "气质", placeholder: "", example: "亲和自信", kind: "choice", options: ["亲和自信", "严谨专业", "轻松有创意"] },
    ],
    build: (v) =>
      lines(
        `职业形象照，胸部以上，正面略侧，看向镜头`,
        `${v.person}，${v.vibe}，自然微笑`,
        `${v.bg}，影棚柔光加发丝轮廓光，85mm 镜头`,
        "肤色自然，保留真实皮肤质感，不过度磨皮",
        NO_EXTRA_TEXT,
      ),
    aspectRatio: "4:5",
    resolution: "2K",
    quality: "high",
    tips: ["用自己的照片做参考图，并在描述里写「保持参考图人物的五官和发型」"],
  },
  {
    id: "photo-fashion",
    name: "时尚大片",
    category: "photo",
    summary: "杂志感的服装大片：模特、造型、场景、光线",
    fields: [
      { key: "model", label: "模特与造型", placeholder: "", example: "高个子女模特，酒红色丝绒长裙，银色耳饰" },
      { key: "place", label: "场景", placeholder: "", example: "空旷的盐湖，远处是雪山" },
      { key: "light", label: "光线", placeholder: "", example: "硬朗的直射阳光", kind: "choice", options: ["硬朗的直射阳光", "柔和的阴天光", "闪光灯直打", "黄昏逆光"] },
    ],
    build: (v) =>
      lines(
        `时尚杂志大片：${v.model}`,
        `场景：${v.place}，${v.light}`,
        "姿态有张力，构图大胆，面料的光泽和垂坠感真实",
        "中画幅相机质感，色彩有调性但不过度修饰",
        NO_EXTRA_TEXT,
      ),
    aspectRatio: "4:5",
    resolution: "2K",
    quality: "high",
  },
  {
    id: "photo-street",
    name: "街头纪实",
    category: "photo",
    summary: "抓拍感的街头摄影，城市、人物和瞬间",
    fields: [
      { key: "city", label: "城市与地点", placeholder: "", example: "香港深水埗的街口" },
      { key: "moment", label: "瞬间", placeholder: "", example: "下雨天，一个撑红伞的人正穿过斑马线" },
      { key: "film", label: "影调", placeholder: "", example: "彩色胶片", kind: "choice", options: ["彩色胶片", "高反差黑白", "夜晚霓虹"] },
    ],
    build: (v) =>
      lines(
        `街头纪实摄影，${v.city}`,
        `瞬间：${v.moment}`,
        `${v.film}，35mm 镜头抓拍，构图有几何感和层次，不摆拍`,
        "真实的环境细节和人群，轻微颗粒",
        "招牌上的字不需要清晰可读",
      ),
    aspectRatio: "3:2",
    resolution: "2K",
    quality: "high",
  },
  {
    id: "photo-landscape",
    name: "风光摄影",
    category: "photo",
    summary: "山川湖海、星空云海，壁纸级风景",
    fields: [
      { key: "scene", label: "风景", placeholder: "", example: "冰岛黑沙滩上的玄武岩柱，海浪拍岸" },
      { key: "time", label: "时刻", placeholder: "", example: "日出前的蓝调时刻", kind: "choice", options: ["日出前的蓝调时刻", "金色日落", "银河星空", "雨后云雾"] },
      { key: "lens", label: "镜头", placeholder: "", example: "超广角，前景有岩石", kind: "choice", options: ["超广角，前景有岩石", "长焦压缩远山", "无人机俯瞰"] },
    ],
    build: (v) =>
      lines(
        `风光摄影：${v.scene}`,
        `${v.time}，${v.lens}`,
        "长曝光让水面柔滑，动态范围大，暗部和高光都有细节，色彩自然",
        NO_EXTRA_TEXT,
      ),
    aspectRatio: "16:9",
    resolution: "4K",
    quality: "high",
  },
  {
    id: "photo-pet",
    name: "宠物写真",
    category: "photo",
    summary: "毛发清晰的宠物照，棚拍或户外",
    fields: [
      { key: "pet", label: "宠物", placeholder: "", example: "一只金毛幼犬，脖子上系着蓝色领巾" },
      { key: "place", label: "场景", placeholder: "", example: "秋天铺满落叶的草地", kind: "choice", options: ["秋天铺满落叶的草地", "纯色影棚", "窗边沙发", "海边沙滩"] },
      { key: "action", label: "神态动作", placeholder: "", example: "歪着头看镜头" },
    ],
    build: (v) =>
      lines(
        `宠物写真：${v.pet}，${v.action}`,
        `${v.place}，眼神光明亮，与宠物视线齐平的低机位`,
        "毛发根根分明，浅景深，色彩温暖自然",
        NO_EXTRA_TEXT,
      ),
    aspectRatio: "4:5",
    resolution: "2K",
    quality: "high",
  },

  // ── 商业设计 ──────────────────────────────────────────────────────
  {
    id: "design-slide",
    name: "PPT 封面页",
    category: "design",
    summary: "演示文稿的封面或章节页：标题、配图、留白",
    fields: [
      { key: "title", label: "标题", placeholder: "", example: "2027 品牌增长计划" },
      { key: "subtitle", label: "副标题", placeholder: "可不写", example: "市场部 · 年度规划", optional: true },
      { key: "theme", label: "视觉主题", placeholder: "", example: "抽象的上升曲线和光带", examples: ["航拍的城市夜景", "极简几何色块"] },
      { key: "style", label: "风格", placeholder: "", example: "简洁商务", kind: "choice", options: ["简洁商务", "科技深色", "清新明亮", "杂志感"] },
    ],
    build: (v) =>
      lines(
        `16:9 演示文稿封面页，${v.style}风格`,
        `左侧放文字，右侧是视觉主题：${v.theme}`,
        exactText("主标题", v.title ?? "", "大号无衬线粗体，左对齐"),
        v.subtitle && exactText("副标题", v.subtitle, "小号字，在主标题下方"),
        "留白充足，层级清楚，配色不超过三种",
        "除这些文字外不出现其他文字",
      ),
    aspectRatio: "16:9",
    resolution: "2K",
    quality: "high",
    textHeavy: true,
  },
  {
    id: "design-menu",
    name: "菜单",
    category: "design",
    summary: "咖啡店、餐厅的菜单版式，菜名和价格逐字写准",
    fields: [
      { key: "shop", label: "店名", placeholder: "", example: "山野咖啡" },
      { key: "items", label: "菜单内容", placeholder: "每行一项：名称 价格", example: "美式 22\n拿铁 28\n燕麦拿铁 32\n手冲 38", kind: "textarea" },
      { key: "style", label: "风格", placeholder: "", example: "复古手绘", kind: "choice", options: ["复古手绘", "极简黑白", "自然森系", "日式杂志"] },
    ],
    build: (v) =>
      lines(
        `${v.style}风格的店铺菜单，竖版`,
        exactText("顶部店名", v.shop ?? "", "标题字体"),
        `菜单条目逐行排列，名称左对齐、价格右对齐，内容逐字照抄：${(v.items ?? "").split("\n").map((s) => s.trim()).filter(Boolean).join(" / ")}`,
        "四周有与风格相符的小插画装饰，文字清晰可读、没有错字",
      ),
    aspectRatio: "3:4",
    resolution: "2K",
    quality: "high",
    textHeavy: true,
    tips: ["菜单条目多时，建议出图后在画布上核对或替换文字"],
  },
  {
    id: "design-invitation",
    name: "邀请函",
    category: "design",
    summary: "婚礼、发布会、生日会的邀请卡",
    fields: [
      { key: "event", label: "活动", placeholder: "", example: "林晓 & 陈默 的婚礼" },
      { key: "when", label: "时间地点", placeholder: "", example: "2027.05.20 · 杭州西湖国宾馆" },
      { key: "style", label: "风格", placeholder: "", example: "花卉水彩", kind: "choice", options: ["花卉水彩", "烫金极简", "复古中式", "现代撞色"] },
    ],
    build: (v) =>
      lines(
        `${v.style}风格的邀请函卡片，竖版，正面平拍`,
        exactText("主标题", v.event ?? "", "优雅的标题字体，居中"),
        exactText("时间地点", v.when ?? "", "小号字，在主标题下方"),
        "边框和装饰元素围绕文字，留白均衡，有纸张质感",
        "除这两段文字外不出现其他文字",
      ),
    aspectRatio: "3:4",
    resolution: "2K",
    quality: "high",
    textHeavy: true,
  },
  {
    id: "design-banner",
    name: "网站横幅",
    category: "design",
    summary: "官网首屏、活动页的宽幅横幅",
    fields: [
      { key: "product", label: "产品或主题", placeholder: "", example: "一款降噪耳机" },
      { key: "headline", label: "主文案", placeholder: "", example: "把世界调成静音" },
      { key: "visual", label: "画面", placeholder: "", example: "耳机悬浮在深蓝色渐变中，周围是柔和的声波光环" },
    ],
    build: (v) =>
      lines(
        `网站首屏横幅，宽幅：${v.product}`,
        `画面：${v.visual}，主体放右侧`,
        exactText("左侧主文案", v.headline ?? "", "大号粗体，左对齐，下方留出按钮位置"),
        "现代、干净的商业设计，光影高级，配色统一",
        "除主文案外不出现其他文字",
      ),
    aspectRatio: "21:9",
    resolution: "2K",
    quality: "high",
    textHeavy: true,
  },
  {
    id: "design-ui",
    name: "App 界面样机",
    category: "design",
    summary: "手机或网页界面的效果图，像已经上线的产品",
    fields: [
      { key: "app", label: "应用", placeholder: "", example: "一款记账 App 的首页" },
      { key: "content", label: "界面内容", placeholder: "从上到下", example: "顶部本月支出总额，中间是分类环形图，下面是最近五笔账单列表", kind: "textarea" },
      { key: "device", label: "设备", placeholder: "", example: "手机竖屏", kind: "choice", options: ["手机竖屏", "网页桌面端", "平板横屏"] },
      { key: "style", label: "视觉风格", placeholder: "", example: "浅色极简", kind: "choice", options: ["浅色极简", "深色科技", "活泼多彩"] },
    ],
    build: (v) =>
      lines(
        `${v.device}的界面设计稿：${v.app}，像已经上线的真实产品截图`,
        `布局：${v.content}`,
        `${v.style}风格，层级清楚，间距统一，图标风格一致，文字短且可读`,
        "只出界面本身，不要设备外壳以外的背景",
      ),
    aspectRatio: "9:16",
    resolution: "2K",
    quality: "high",
    textHeavy: true,
  },

  // ── 3D 与潮玩 ──────────────────────────────────────────────────────
  {
    id: "render-toy",
    name: "盲盒手办",
    category: "render3d",
    summary: "潮玩手办渲染：PVC 质感、可爱比例，可带包装盒",
    fields: [
      { key: "character", label: "角色", placeholder: "", example: "戴恐龙头套的小女孩，抱着一颗星星" },
      { key: "material", label: "材质", placeholder: "", example: "哑光 PVC", kind: "choice", options: ["哑光 PVC", "半透明树脂", "毛绒", "陶瓷釉面"] },
      { key: "box", label: "包装盒", placeholder: "", example: "只要手办", kind: "choice", options: ["只要手办", "旁边放包装盒"], control: true },
    ],
    build: (v) =>
      lines(
        `潮玩盲盒手办的产品渲染：${v.character}`,
        `${v.material}材质，大头身比例，表面有细腻的涂装和高光`,
        v.box === "旁边放包装盒" ? "手办旁边放一个配套的彩色包装盒，盒面只有图案，不写文字" : "手办单独摆放",
        "纯色柔和背景，影棚三点布光，底部有柔和投影",
        NO_EXTRA_TEXT,
      ),
    aspectRatio: "1:1",
    resolution: "2K",
    quality: "high",
  },
  {
    id: "render-clay",
    name: "黏土风场景",
    category: "render3d",
    summary: "手捏黏土质感的小场景，温暖可爱",
    fields: [
      { key: "scene", label: "场景", placeholder: "", example: "森林里的小面包店，门口排着小动物" },
      { key: "time", label: "氛围", placeholder: "", example: "暖黄的灯光", kind: "choice", options: ["暖黄的灯光", "清晨阳光", "下雪的夜晚"] },
    ],
    build: (v) =>
      lines(
        `定格动画式的黏土风场景：${v.scene}`,
        `${v.time}，所有物体都是手捏黏土做的，能看到指纹和捏痕，边缘圆润`,
        "微距镜头，浅景深，色彩柔和温暖",
        NO_EXTRA_TEXT,
      ),
    aspectRatio: "4:3",
    resolution: "2K",
    quality: "high",
  },
  {
    id: "render-isometric",
    name: "等距小场景",
    category: "render3d",
    summary: "45° 等距视角的小房间、小店铺、城市一角",
    fields: [
      { key: "scene", label: "场景", placeholder: "", example: "一间堆满绿植和唱片的复古咖啡馆，二楼是小阁楼" },
      { key: "look", label: "质感", placeholder: "", example: "低多边形", kind: "choice", options: ["低多边形", "精致 3D 渲染", "扁平插画"] },
      { key: "props", label: "加点元素", placeholder: "", example: "绿植、猫", kind: "multi", options: ["绿植", "猫", "书架", "霓虹灯", "楼梯", "吧台", "窗外的雨"], optional: true },
    ],
    build: (v) =>
      lines(
        `等距视角（45°）的 3D 小场景：${v.scene}`,
        v.props && `场景里还有：${v.props}`,
        `${v.look}风格，场景像一块漂浮的立方体切片，前面两面墙打开，内部细节丰富`,
        "柔和的全局光照，配色和谐，纯色背景",
        NO_EXTRA_TEXT,
      ),
    aspectRatio: "1:1",
    resolution: "2K",
    quality: "high",
  },
  {
    id: "render-icon3d",
    name: "3D 图标",
    category: "render3d",
    summary: "光滑立体的 App 图标或功能图标",
    fields: [
      { key: "subject", label: "图标主体", placeholder: "", example: "一个带对勾的日历" },
      { key: "color", label: "主色", placeholder: "", example: "珊瑚橙" },
      { key: "material", label: "材质", placeholder: "", example: "磨砂玻璃", kind: "choice", options: ["磨砂玻璃", "光滑塑料", "金属", "软胶"] },
    ],
    build: (v) =>
      lines(
        `3D 图标：${v.subject}`,
        `${v.color}为主色，${v.material}材质，圆角造型，轻微的俯视角度`,
        "柔和的棚拍光和高光，纯色背景，图标居中、四周留白",
        NO_EXTRA_TEXT,
      ),
    aspectRatio: "1:1",
    resolution: "1K",
    quality: "high",
  },

  // ── 艺术风格 ──────────────────────────────────────────────────────
  {
    id: "art-ink",
    name: "国风水墨",
    category: "art",
    summary: "宣纸、墨色、留白，传统中国画的意境",
    fields: [
      { key: "subject", label: "画面", placeholder: "", example: "孤舟蓑笠翁，独钓寒江雪", examples: ["竹林里抚琴的隐士", "云雾缭绕的黄山松"] },
      { key: "style", label: "画法", placeholder: "", example: "写意泼墨", kind: "choice", options: ["写意泼墨", "工笔重彩", "青绿山水", "白描"] },
    ],
    build: (v) =>
      lines(
        `中国画：${v.subject}`,
        `${v.style}的画法，墨分五色，笔触有浓淡干湿的变化，大面积留白`,
        "宣纸纹理清晰，可以有一方红色印章，但不写诗文和落款",
      ),
    aspectRatio: "2:3",
    resolution: "2K",
    quality: "high",
  },
  {
    id: "art-oil",
    name: "油画",
    category: "art",
    summary: "厚涂笔触的油画，风景、静物、人物都可以",
    fields: [
      { key: "subject", label: "画面", placeholder: "", example: "黄昏时分的海边小屋，窗户亮着灯" },
      { key: "school", label: "风格", placeholder: "", example: "印象派", kind: "choice", options: ["印象派", "古典写实", "后印象派厚涂", "表现主义"] },
    ],
    build: (v) =>
      lines(
        `一幅${v.school}油画：${v.subject}`,
        "笔触清晰可见，颜料有厚度，色彩丰富而统一，光线有温度",
        "像对着真实画布拍的照片，能看到画布纹理，不出现画框和签名",
      ),
    aspectRatio: "4:3",
    resolution: "2K",
    quality: "high",
  },
  {
    id: "art-watercolor",
    name: "水彩",
    category: "art",
    summary: "通透的水彩画，晕染、留白、纸张纹理",
    fields: [
      { key: "subject", label: "画面", placeholder: "", example: "雨后巷口的小花店，门前摆满鲜花" },
      { key: "palette", label: "色调", placeholder: "", example: "清新淡雅", kind: "choice", options: ["清新淡雅", "浓郁温暖", "冷调蓝紫"] },
    ],
    build: (v) =>
      lines(
        `水彩画：${v.subject}`,
        `${v.palette}的配色，水色自然晕染、边缘有水渍，局部留白透出纸色`,
        "冷压水彩纸的颗粒纹理清晰，线条轻松",
        NO_EXTRA_TEXT,
      ),
    aspectRatio: "3:4",
    resolution: "2K",
    quality: "medium",
  },
  {
    id: "art-pixel",
    name: "像素画",
    category: "art",
    summary: "复古游戏感的像素画，场景或角色",
    fields: [
      { key: "subject", label: "画面", placeholder: "", example: "夜晚的赛博朋克小吃街，霓虹招牌和冒着热气的面摊" },
      { key: "grid", label: "精度", placeholder: "", example: "16 位主机风格", kind: "choice", options: ["8 位红白机风格", "16 位主机风格", "高精度像素插画"] },
    ],
    build: (v) =>
      lines(
        `像素画：${v.subject}`,
        `${v.grid}，像素格清晰锐利，没有模糊和抗锯齿，调色板有限而统一`,
        "构图像游戏里的一个场景，细节丰富",
        "招牌和画面里不出现可读的文字",
      ),
    aspectRatio: "16:9",
    resolution: "1K",
    quality: "medium",
  },

  // ── 游戏 ──────────────────────────────────────────────────────────
  {
    id: "game-card",
    name: "卡牌插画",
    category: "game",
    summary: "卡牌游戏的角色或法术插画，竖版",
    fields: [
      { key: "subject", label: "卡面内容", placeholder: "", example: "召唤火焰凤凰的女巫，长袍在热浪中翻飞" },
      { key: "style", label: "风格", placeholder: "", example: "欧美奇幻厚涂", kind: "choice", options: ["欧美奇幻厚涂", "国风仙侠", "日系二次元", "暗黑哥特"] },
    ],
    build: (v) =>
      lines(
        `卡牌游戏的卡面插画，竖版：${v.subject}`,
        `${v.style}风格，主体充满画面、动态强烈，特效光影华丽`,
        "画面四周留出卡框的位置，主体不被裁切",
        "不画卡框、数值和文字",
      ),
    aspectRatio: "2:3",
    resolution: "2K",
    quality: "high",
  },
  {
    id: "game-scene",
    name: "游戏场景概念图",
    category: "game",
    summary: "开放世界、关卡的场景设定，交代氛围和尺度",
    fields: [
      { key: "world", label: "场景", placeholder: "", example: "浮在云海上的古代空中城市，石桥连接着几座岛屿" },
      { key: "mood", label: "氛围", placeholder: "", example: "史诗、明亮", kind: "choice", options: ["史诗、明亮", "神秘、幽暗", "废土、荒凉", "温馨、治愈"] },
    ],
    build: (v) =>
      lines(
        `游戏场景概念图：${v.world}`,
        `氛围${v.mood}，画面里有一个小小的角色用来衬托尺度，有清楚的前景、中景、远景`,
        "数字绘画质感，光影有引导性，材质和建筑细节可信",
        NO_EXTRA_TEXT,
      ),
    aspectRatio: "16:9",
    resolution: "2K",
    quality: "high",
  },
];

export function findTemplate(id: string | null | undefined): ImageTemplate | null {
  return TEMPLATES.find((t) => t.id === id) ?? null;
}

/**
 * Extras every template form offers (第 64 条), added after the template's
 * own sentences: a style to apply to the whole picture (only for templates
 * without their own style choice, see canPickStyle), more requirements in
 * the user's words, and things to keep out of the picture.
 */
export type TemplateExtras = { style?: string; detail?: string; avoid?: string };

/** The output settings a use applies; the form starts from the template's suggestion. */
export type TemplateSettings = { aspectRatio?: AspectRatio; resolution: ImageResolution; quality: ImageQuality };

export const STYLE_PRESETS = [
  "写实摄影",
  "电影剧照",
  "胶片质感",
  "日系动画",
  "美式漫画",
  "3D 渲染",
  "黏土",
  "水彩",
  "油画",
  "国风水墨",
  "像素画",
  "赛博朋克",
  "极简扁平",
  "复古海报",
] as const;

/** Field keys that already choose the look; such templates get no extra style picker. */
const STYLE_KEYS = new Set(["style", "look", "tone", "school", "grid", "film", "material"]);

export function canPickStyle(template: ImageTemplate) {
  return template.category !== "edit" && !template.fields.some((field) => STYLE_KEYS.has(field.key));
}

export function defaultSettings(template: ImageTemplate): TemplateSettings {
  return {
    ...(template.aspectRatio ? { aspectRatio: template.aspectRatio } : {}),
    resolution: template.resolution,
    quality: template.quality,
  };
}

/** Required fields still empty. */
export function missingFields(template: ImageTemplate, values: Readonly<Record<string, string>>) {
  return template.fields.filter((field) => !field.optional && !(values[field.key] ?? "").trim());
}

/**
 * The fields' examples. `round` steps through each field's example set
 * (example, then examples[…]), so 「换一组示例」 shows a different fill-in.
 */
export function exampleValues(template: ImageTemplate, round = 0): Record<string, string> {
  return Object.fromEntries(
    template.fields.map((field) => {
      const pool = [field.example, ...(field.examples ?? [])];
      return [field.key, pool[round % pool.length] ?? field.example];
    }),
  );
}

/** How many different fill-ins 「换一组示例」 can show. */
export function exampleRounds(template: ImageTemplate) {
  return Math.max(1, ...template.fields.map((field) => 1 + (field.examples?.length ?? 0)));
}

/** Initial values: choices start on their first option, text and multi start empty. */
export function initialValues(template: ImageTemplate): Record<string, string> {
  return Object.fromEntries(
    template.fields.map((field) => [field.key, field.kind === "choice" ? (field.options?.[0] ?? "") : ""]),
  );
}

export function buildTemplatePrompt(
  template: ImageTemplate,
  values: Readonly<Record<string, string>>,
  extras: TemplateExtras = {},
) {
  const clean = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, value.trim().slice(0, 600)]),
  );
  const style = canPickStyle(template) ? extras.style?.trim() : "";
  const more = lines(
    style && `整体风格：${style}`,
    extras.detail?.trim() && `补充要求：${extras.detail.trim().slice(0, 600)}`,
    extras.avoid?.trim() && `避免出现：${extras.avoid.trim().slice(0, 300)}`,
  );
  return (template.build(clean) + more).slice(0, 4000);
}

/**
 * Search over name, summary, the category's label and hint ("电影" finds the
 * 影视 templates, "小红书" finds 封面) and field labels.
 */
export function filterTemplates(query: string, category: TemplateCategory | null) {
  const q = query.trim().toLowerCase();
  const meta = (c: TemplateCategory) => {
    const found = TEMPLATE_CATEGORIES.find((x) => x.value === c);
    return found ? `${found.label} ${found.hint}` : "";
  };
  return TEMPLATES.filter((t) => !category || t.category === category).filter(
    (t) =>
      !q ||
      t.name.toLowerCase().includes(q) ||
      t.summary.toLowerCase().includes(q) ||
      meta(t.category).toLowerCase().includes(q) ||
      t.fields.some((field) => field.label.includes(q)),
  );
}

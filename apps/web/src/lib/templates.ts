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
 */
import type { ImageQuality, ImageResolution } from "@loomic/shared";

import type { AspectRatio } from "./image-model-meta";

export type TemplateCategory =
  | "ecommerce"
  | "poster"
  | "social"
  | "brand"
  | "photo"
  | "illustration"
  | "infographic"
  | "edit";

export const TEMPLATE_CATEGORIES: ReadonlyArray<{ value: TemplateCategory; label: string; hint: string }> = [
  { value: "ecommerce", label: "电商", hint: "主图、场景图、卖点图" },
  { value: "poster", label: "海报", hint: "活动、节日、大字报" },
  { value: "social", label: "社媒封面", hint: "小红书、视频、公众号" },
  { value: "brand", label: "品牌", hint: "标志、物料、包装" },
  { value: "photo", label: "写实摄影", hint: "人像、美食、空间" },
  { value: "illustration", label: "插画", hint: "角色、贴纸、绘本、图标" },
  { value: "infographic", label: "信息图", hint: "流程、知识卡片" },
  { value: "edit", label: "改图", hint: "换背景、去杂物、翻译文字" },
];

export type TemplateField = {
  key: string;
  label: string;
  placeholder: string;
  /** Filled in by 「用示例填」 and used by the tests. */
  example: string;
  kind?: "text" | "textarea" | "choice";
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
];

export function findTemplate(id: string | null | undefined): ImageTemplate | null {
  return TEMPLATES.find((t) => t.id === id) ?? null;
}

/** Required fields still empty. */
export function missingFields(template: ImageTemplate, values: Readonly<Record<string, string>>) {
  return template.fields.filter((field) => !field.optional && !(values[field.key] ?? "").trim());
}

/** The fields' examples, or each choice's first option. */
export function exampleValues(template: ImageTemplate): Record<string, string> {
  return Object.fromEntries(template.fields.map((field) => [field.key, field.example]));
}

/** Initial values: choices start on their first option, text starts empty. */
export function initialValues(template: ImageTemplate): Record<string, string> {
  return Object.fromEntries(
    template.fields.map((field) => [field.key, field.kind === "choice" ? (field.options?.[0] ?? "") : ""]),
  );
}

export function buildTemplatePrompt(template: ImageTemplate, values: Readonly<Record<string, string>>) {
  const clean = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, value.trim().slice(0, 600)]),
  );
  return template.build(clean).slice(0, 4000);
}

/** Search over name, summary, category and field examples ("小红书" finds 封面). */
export function filterTemplates(query: string, category: TemplateCategory | null) {
  const q = query.trim().toLowerCase();
  const label = (c: TemplateCategory) => TEMPLATE_CATEGORIES.find((x) => x.value === c)?.label ?? "";
  return TEMPLATES.filter((t) => !category || t.category === category).filter(
    (t) =>
      !q ||
      t.name.toLowerCase().includes(q) ||
      t.summary.toLowerCase().includes(q) ||
      label(t.category).includes(q),
  );
}

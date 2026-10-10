---
name: GGUU AI IMAGE
description: 用主站账号与余额生成图片的夜色光场工作台
colors:
  ground-deep: "#060912"
  ground: "#0a0f1e"
  panel: "#131b31"
  well: "#0e1528"
  fg: "#eef2fa"
  fg-soft: "#b0b9ce"
  fg-muted: "#8590a8"
  line: "rgb(255 255 255 / 0.1)"
  line-strong: "rgb(255 255 255 / 0.18)"
  amb-default: "rgb(72 214 204)"
  amb-2-default: "rgb(70 120 255)"
  alert: "#ff8a80"
  alert-wash: "rgb(255 138 128 / 0.12)"
  ok: "#5ee0b4"
  glass: "rgb(18 25 44 / 0.55)"
  glass-strong: "rgb(15 21 38 / 0.86)"
typography:
  display:
    fontFamily: "GGUU Display, Noto Sans SC, PingFang SC, system-ui, sans-serif"
    fontSize: "clamp(52px, 7.8vw, 128px)"
    fontWeight: 400
    lineHeight: 0.98
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "GGUU Display, Noto Sans SC, PingFang SC, system-ui, sans-serif"
    fontSize: "clamp(36px, 4.2vw, 56px)"
    fontWeight: 400
    lineHeight: 1.02
  title:
    fontFamily: "Geist, Noto Sans SC, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Geist, Noto Sans SC, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.75
  body-sm:
    fontFamily: "Geist, Noto Sans SC, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Geist, Noto Sans SC, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.4
  caption:
    fontFamily: "Geist, Noto Sans SC, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
  data:
    fontFamily: "Geist Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: "0.01em"
    fontFeature: "tnum"
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
  frame: "14px"
  xl: "18px"
  2xl: "22px"
  pill: "999px"
spacing:
  gutter-mobile: "16px"
  gutter-tablet: "32px"
  gutter-desktop: "48px"
  container: "1600px"
components:
  button-primary:
    backgroundColor: "{colors.fg}"
    textColor: "{colors.ground}"
    rounded: "{rounded.md}"
    padding: "0 20px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "#ffffff"
  button-outline:
    backgroundColor: "rgb(255 255 255 / 0.04)"
    textColor: "{colors.fg}"
    rounded: "{rounded.md}"
    height: "36px"
  button-ghost:
    textColor: "{colors.fg-soft}"
    rounded: "{rounded.md}"
    height: "36px"
  chip:
    backgroundColor: "{colors.glass}"
    textColor: "{colors.fg}"
    rounded: "{rounded.pill}"
    padding: "6px 14px"
  nav-pill:
    backgroundColor: "{colors.glass}"
    rounded: "{rounded.lg}"
    padding: "5px"
  nav-item-active:
    backgroundColor: "rgb(255 255 255 / 0.1)"
    textColor: "{colors.fg}"
    rounded: "{rounded.md}"
    padding: "8px 14px"
  composer:
    backgroundColor: "{colors.glass}"
    textColor: "{colors.fg}"
    rounded: "{rounded.2xl}"
    padding: "16px"
  info-card:
    backgroundColor: "{colors.glass-strong}"
    textColor: "{colors.fg}"
    rounded: "{rounded.xl}"
    padding: "16px"
---

# Design System: GGUU AI IMAGE

<!-- 2026-10-08 由 agent02 按 impeccable documenter 流程，从已上线代码（apps/web/src/app/globals.css、components/ambient、components/landing、components/studio、components/ui/button.tsx）反推写成。改 token 时同步本文件和 .impeccable/design.json。 -->

## Overview

**Creative North Star: "夜色光场：页面的光来自正在看的那张图"**

GGUU AI IMAGE 是一间深墨蓝的夜色房间，房间里唯一的光源是正在看的那张图。图本身被放大、高斯模糊后铺成整页环境光；从图里取出的两种主色写进 `--amb` / `--amb-2`，主按钮的光晕、焦点环、品牌图标、状态点都跟着它变色。换一张图，房间的颜色就跟着换。生成的结果也挂到同一块倾斜的「氛围屏」上，地面有一条淡光带和屏幕倒影，空间感来自光和倒影，不靠装饰。

密度上，落地页（Persuade）让作品占满首屏；工作台（Operate：生图、画布、设置）把同一种光收敛成安静的底色，控件只在图片上方漂浮时才用磨砂玻璃。文案直白亲切：说「生成」「图片」「余额」，不用暗房、冲印、显影一类行话。

用户明确否决过的方向：Loomic 品牌、琥珀 / 黄色铺色、纯黑白的「暗房接触印样」（太素、太黑话）。

**Key Characteristics:**
- 光来自图片：环境色在运行时从当前图片取样，GSAP 0.9s 补间到 `<html>` 上。
- 深墨蓝底（色相约 225–230），不用中性黑。
- 磨砂玻璃只给漂浮在图片上的控件：导航、输入框、信息卡、浮层。
- 近白主按钮带环境色光晕；危险和异常用珊瑚红，从不只靠颜色表达。
- 标题用得意黑（GGUU Display）的斜体气质，正文 Geist + 思源黑体，数据 Geist Mono。

## Colors

一间被图片照亮的墨蓝房间：底色冷而深，唯一的彩色来自当前图片。

### Primary
- **环境光 Ambient**（默认 rgb(72 214 204)，运行时取自图片）：主按钮光晕、焦点环、文本选区、输入框光标、运行中状态点、品牌图标里的光球。它不是固定的品牌色，是「当前这张图的颜色」。
- **环境光副色 Ambient 2**（默认 rgb(70 120 255)）：和主环境光一起构成渐变光球、头像底色和图表第二色。

### Neutral
- **夜底 Ground**（#0a0f1e）：页面底色，`<html>` 背景。
- **深夜 Ground Deep**（#060912）：最深一层：首屏暗角、头像上的文字色。
- **面板 Panel**（#131b31）：实色面板、浮层、侧栏；减少透明度偏好下玻璃退回这个颜色。
- **井 Well**（#0e1528）：凹陷区域和次级填充（shadcn `muted` / `secondary`）。
- **月光白 Fg**（#eef2fa）：正文主色，也是主按钮的底色。
- **雾 Fg Soft**（#b0b9ce）：副文、次级按钮文字。
- **远雾 Fg Muted**（#8590a8）：占位符、说明、时间戳；在 Ground 上对比度约 5.9:1。
- **细线 Line / Line Strong**（白 10% / 18%）：分隔线、玻璃描边、输入框边框。

### Status
- **珊瑚 Alert**（#ff8a80，底色 12% 的 Alert Wash）：失败、待核对、余额不足、断线重连。一定配文字说明，不单靠颜色。
- **青绿 Ok**（#5ee0b4）：就绪、已连接。

### Named Rules
**The Picture Is The Light Rule.** 页面上任何「发光」的东西都读 `--amb` / `--amb-2`，不写死颜色；没有图片时用默认青蓝光。

**The No Amber Rule.** 不用琥珀、黄色或米黄铺底（用户明确否决）；警示用珊瑚红。

**The Night Is Blue Rule.** 页面底色永远是墨蓝，不是中性黑。（第三版起画布跟随亮暗主题，这条例外已取消；本文件整体待按 F2 重写。）

## Typography

**Display Font:** GGUU Display（得意黑 Smiley Sans 的子集，按 unicode-range 分成 100 片，按需加载；OFL 1.1）
**Body Font:** Geist + Noto Sans SC（回退 PingFang SC / Microsoft YaHei）
**Label/Mono Font:** Geist Mono（只用于数据：模型、尺寸、请求 ID、计时）

**Character:** 得意黑的斜切笔画给标题一点向前的动势，和倾斜的氛围屏呼应；正文的 Geist + 思源黑体保持冷静清楚。

### Hierarchy
- **Display**（400，clamp(52px, 7.8vw, 128px)，行高 0.98，字距 -0.01em）：落地页首屏「想到什么，/就生成什么」；强调词用 `color-mix(in oklab, 环境光 42%, white)`，不用渐变文字。
- **Headline**（400，clamp(36px, 4.2vw, 56px)，行高 1.02）：工作台各页 H1（`components/page-header.tsx`）、生图页「今天想生成点什么？」、错误页标题。
- **Title**（600，15–17px）：卡片和区块标题、对话侧栏标题。
- **Body**（400，16px，行高 1.75；首屏副文 18px，宽度约 26em）：说明文字。
- **Body small**（400，14–15px，行高 1.6）：工作台里的密集正文：队列行、信息卡里的描述、设置项说明、导航项。
- **Label**（500，12.5–13px）：按钮、芯片、导航、表单标签。
- **Caption**（400–500，12px）：元信息和提示：规格行、时间、表单下方提示、「示例」角标。
- **Data**（Geist Mono 11px，等宽数字）：`data-label` 工具类，只放数据。

### Named Rules
**The Display Is Rare Rule.** GGUU Display 只用于页面级标题（每屏最多一处），从不用于按钮、标签和正文。

**The Mono Is Data Rule.** 等宽字只用于真实数据，不当成「科技感」装饰。

**The 11px Floor Rule.** 任何文字不小于 11px（中文在 10px 下笔画糊成一团）。2026-10-08 已把残留的 10px 标签（工具卡片、提及标签、「默认」「重试」角标等）统一提到 11px。

## Layout

- 已登录页面共用 `app/(workspace)/layout.tsx`：文档整体滚动，顶部吸顶导航（滚动后加 `bg-ground/70` 模糊底和细线），内容容器 `max-w-[1600px]`，左右留白 16 / 32 / 48px（`px-4 sm:px-8 lg:px-12`）。
- 落地页首屏 1440×900：左侧两行大标题、副文、760px 宽玻璃输入框压在大屏左缘；右侧从约 44% 处起一块 rotateY 约 -24° 的氛围屏，屏下是缩略图条。
- 生图页 `/studio`：`lg` 起左右两栏（`minmax(0,5fr)` / `minmax(0,6fr)`，`xl` 起左栏固定 600px），左边写描述和处理队列，右边是氛围屏和信息卡；下方是按天分组的全部作品网格（2–6 列，4:5 卡片）。
- 画布 `/canvas`：节点画布（React Flow）铺满，左上项目菜单、项目名、保存状态和品牌套件，右上余额和头像，左侧竖排工具栏，左下小地图和缩放条，右侧可拖宽的设计助手侧栏；手机端侧栏变成全屏覆盖层。
- 断点沿用 Tailwind：sm 640、md 768、lg 1024、xl 1280。手机端导航是底部浮动玻璃条，`main` 底部留出 112px。

## Elevation & Depth

深度来自光，不来自堆叠卡片：环境色场在最远层，氛围屏在中层，玻璃控件在最近层。阴影都带偏移和柔和模糊，颜色压向夜底（rgb(2 4 10)），不用零偏移的彩色光圈当装饰。唯一的彩色光是主按钮和受光图片的环境色溢光。

### Shadow Vocabulary
- **subtle**（`0 1px 2px rgb(2 4 10 / 0.35)`）：小按钮、标签。
- **card**（`0 1px 2px rgb(2 4 10 / 0.3), 0 12px 28px -14px rgb(2 4 10 / 0.6)`）：静止的卡片。
- **card-hover**（`0 2px 4px rgb(2 4 10 / 0.35), 0 24px 48px -18px rgb(2 4 10 / 0.75)`）：卡片悬停抬起。
- **float**（`0 6px 14px rgb(2 4 10 / 0.35), 0 30px 64px -20px rgb(2 4 10 / 0.8)`）：浮层、工具栏。
- **glow-amb**（`0 10px 30px -10px rgb(var(--amb) / 0.7), inset 0 -2px 0 rgb(10 15 30 / 0.12)`）：主按钮。
- **lit**（`0 0 0 1px rgb(255 255 255 / 0.14), 0 60px 120px -40px rgb(2 4 10 / 0.9), 0 0 140px -30px rgb(var(--amb) / 0.55)`）：被照亮的图片（大图、看大图）。

### Named Rules
**The Glass Floats Rule.** `glass`（55% 不透明的墨蓝 rgb(18 25 44)，模糊 26px、饱和 170%）只给漂浮在图片或画布上的控件；压在复杂图片上的信息卡、输入框和浮层用 `glass-strong`（86% 不透明）。不支持 backdrop-filter 或用户偏好减少透明度时，两者都退回实色 Panel。

## Shapes

- 胶囊（999px）：芯片、分段选择、状态标签、手机底部导航按钮。
- 10px（`rounded-md`）：按钮、输入框、菜单项。
- 14px（`rounded-lg` / `frame`）：导航胶囊外框、图片缩略图、卡片。
- 18–22px：玻璃面板、输入框（生图 Composer 22px）、信息卡、大面板。
- 品牌图标：深色方块里一颗悬在地平线上的光球和它的倒影，就是氛围屏房间的缩影。

## Components

### Buttons
近白、带光、直接。
- **Shape:** 10px 圆角（落地页首屏和 404 页的大号主按钮 18px）。
- **Primary（`glow`）:** Fg 底、Ground 字、600 字重、glow-amb 光晕；默认高 36px，`lg` 高 44px、左右 20px、15px 字。
- **Hover / Focus:** 悬停变纯白；按下下移 1px、缩放 0.99；焦点为 2px 环境色描边、偏移 2px；禁用时去掉光晕、透明度 50%。
- **Outline / Secondary / Ghost:** 白 4% 底加 Line Strong 边框 / 白 8% 底 / 透明底 Fg Soft 字，悬停加亮一级。
- 链接用按钮外观时调用 `buttonVariants()`，不要给 Base UI `Button` 传 `render={<a/>}`。

### Chips
- **Style:** 胶囊形玻璃（或白 6–8% 底），12.5–13px 字。
- **State:** 选中为白 10% 底加 Fg 字；分段选择（1K / 2K）是同一胶囊里的两段。

### Cards / Containers
- **Corner Style:** 14–22px。
- **Background:** 漂浮在图上的用 `glass` / `glass-strong`，普通内容区用 Panel 或白 4–6% 底。
- **Shadow Strategy:** card → card-hover；不嵌套卡片。
- **Border:** 1px Line。

### Inputs / Fields
- **Style:** 透明底、Line Strong 边框或放在玻璃面板里；光标颜色是环境光。
- **Focus:** 边框提到白 25%，外圈 1px 环境色 25% 加一层向下的环境色溢光（Composer）。
- **Error / Disabled:** 错误用珊瑚边框和 Alert Wash 底并配文字；禁用透明度 60%。

### Navigation
- **Style:** 居中的玻璃胶囊（14px 外框，5px 内边距），项目 10px 圆角、14px 字、500 字重。
- **States:** 默认 Fg Soft，悬停白 6–8% 底，当前页白 10% 底加 Fg。
- **Mobile:** 底部浮动 `glass-strong` 条，四个入口，当前项白 10% 底。

### 氛围屏 LightScreen（签名组件）
`components/ambient/light-screen.tsx`。一张大图斜挂在房间里（落地页 rotateY -24°、生图页 -14°、手机 -6°），带地面倒影；换图时新图先亮后落（GSAP 1.1s expo.out），旧图淡出；细指针设备上会轻微朝向光标。减少动态时直接显示最终状态，没有 JavaScript 时倾斜仍是纯 CSS。

### 环境光 AmbientField（签名组件）
`components/ambient/ambient-provider.tsx`。固定在视口后面的当前图片，模糊 110px、饱和 1.7；`useAmbientImage(src)` 换图换光，客户端跳转时保留最后一张图的光。

## Do's and Don'ts

### Do:
- **Do** 让发光的元素读 `rgb(var(--amb))`：主按钮光晕、焦点环、运行中状态点、选区。
- **Do** 只在控件漂浮于图片或画布之上时用 `glass`；信息卡、输入框、浮层压在复杂图片上用 `glass-strong`。
- **Do** 用珊瑚红（#ff8a80）表达失败、待核对和断线，并配一句说清问题和下一步的话。
- **Do** 每个动效都在 prefers-reduced-motion 下退化为直接切换（GSAP 用 `gsap.matchMedia`，CSS 动画在 globals.css 里统一关闭）。
- **Do** 文案直白：「开始生成」「做同款」「去主站核对」。

### Don't:
- **Don't** 用琥珀、黄色或米黄铺底，也不要回到纯黑白的暗房风格。
- **Don't** 用暗房、冲印、曝光、显影这类比喻当界面文案。
- **Don't** 用渐变文字、标题上方的小标签（eyebrow / kicker）、区块编号或 unicode 字符当图标。
- **Don't** 给画布叠加改变图片颜色的混合层：图片必须按原色显示。
- **Don't** 把 Loomic 品牌放回界面；包名 `@loomic/*` 不变只是为了构建。

## 位图来源（provenance）

- `public/images/showcase/showcase-3/8/9/12`：Unsplash 图片，Unsplash License（可免费商用，不强制署名），作者和原图链接记在 `components/landing/showcase.ts` 顶部注释里。
- `public/images/showcase/` 里其余 8 张：继承自上游，来源和版权未核实，上线前要换成本站生成或有授权的图（`showcase.ts` 有 TODO）。
- 换图流程：把裁好的 900×1200（竖）或 1200×900（横）JPG 放进 `public/images/showcase/`，运行 `scripts/prepare-showcase.mjs <编号…>` 生成 `web/`、`lg/` 两档 WebP 并打印光色，再把光色填进 `showcase.ts`。
- `public/favicon.svg`、`logo.svg`、`apple-touch-icon.png`、`og-image.png`：由 `scripts/generate-brand-assets.mjs` 生成（OG 背景用 showcase-5 模糊而成，字体为得意黑 / Geist / 思源黑体子集）。
- `public/fonts/display/*`：`scripts/split-display-font.py` 由得意黑（OFL 1.1）切分并改名生成，许可证在同目录 `OFL.txt`。

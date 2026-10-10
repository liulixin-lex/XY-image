---
name: GGUU AI IMAGE
description: 用主站账号与余额生成图片的柔和海报工作台
colors:
  wall: "#f5f2f3"
  wall-2: "#ede9eb"
  floor: "#e6e1e4"
  floor-2: "#dbd5d9"
  panel: "#fbfafb"
  well: "#f0ecee"
  fg: "#24212b"
  fg-soft: "#5c5766"
  fg-muted: "#6f6a78"
  line: "rgb(36 33 43 / 0.1)"
  line-strong: "rgb(36 33 43 / 0.18)"
  tint-wash: "rgb(36 33 43 / 0.06)"
  coral: "#e5533d"
  coral-hover: "#d6452f"
  coral-ink: "#ffffff"
  coral-text: "#bf3b2a"
  coral-soft: "rgb(229 83 61 / 0.11)"
  coral-on-ink: "#ff8068"
  alert: "#b4233f"
  alert-wash: "rgb(180 35 63 / 0.09)"
  warn: "#b9560f"
  warn-wash: "rgb(185 86 15 / 0.1)"
  ok: "#1f8a5b"
  amb-default: "rgb(224 122 102)"
  amb-2-default: "rgb(196 70 128)"
  glass: "rgb(255 255 255 / 0.62)"
  glass-strong: "rgb(255 255 255 / 0.86)"
  scrim: "rgb(28 25 34 / 0.72)"
  wall-dark: "#1c1a22"
  wall-2-dark: "#17151c"
  floor-dark: "#131118"
  panel-dark: "#25222c"
  fg-dark: "#f2eff4"
  fg-soft-dark: "#beb8c6"
  fg-muted-dark: "#a39dad"
  coral-dark: "#ff8068"
  coral-ink-dark: "#24141a"
  coral-text-dark: "#ff977f"
  alert-dark: "#ff7b93"
  warn-dark: "#ffa066"
  ok-dark: "#5fd3a1"
  glass-strong-dark: "rgb(37 34 44 / 0.9)"
typography:
  display:
    fontFamily: "GGUU Display, Noto Sans SC, PingFang SC, system-ui, sans-serif"
    fontSize: "clamp(88px, min(14vw, 19.5dvh), 212px)"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "GGUU Display, Noto Sans SC, PingFang SC, system-ui, sans-serif"
    fontSize: "clamp(36px, 4.2vw, 56px)"
    fontWeight: 400
    lineHeight: 1.02
  section-label:
    fontFamily: "GGUU Display, Noto Sans SC, PingFang SC, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "0.02em"
  numeral:
    fontFamily: "Big Shoulders Display, Geist, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 800
    lineHeight: 0.9
    letterSpacing: "0.005em"
    fontFeature: "tnum, lnum"
  title:
    fontFamily: "Geist, Noto Sans SC, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Geist, Noto Sans SC, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.8
  body-sm:
    fontFamily: "Geist, Noto Sans SC, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Geist, Noto Sans SC, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.4
  data:
    fontFamily: "Geist Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: "0.01em"
    fontFeature: "tnum"
rounded:
  sm: "6px"
  control: "10px"
  lg: "12px"
  frame: "14px"
  card: "16px"
  float: "20px"
  pill: "999px"
spacing:
  gutter-mobile: "16px"
  gutter-tablet: "32px"
  gutter-desktop: "clamp(20px, 2.4vw, 40px)"
  container: "1600px"
  studio-settings: "368px"
components:
  button-accent:
    backgroundColor: "{colors.coral}"
    textColor: "{colors.coral-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    height: "36px"
    padding: "0 14px"
  button-accent-hover:
    backgroundColor: "{colors.coral-hover}"
  button-poster:
    backgroundColor: "{colors.coral}"
    textColor: "{colors.coral-ink}"
    typography: "{typography.section-label}"
    rounded: "{rounded.frame}"
    height: "48px"
    padding: "0 24px"
  button-ink:
    backgroundColor: "{colors.fg}"
    textColor: "{colors.wall}"
    rounded: "{rounded.control}"
    height: "36px"
    padding: "0 14px"
  button-outline:
    textColor: "{colors.fg}"
    rounded: "{rounded.control}"
    height: "36px"
    padding: "0 14px"
  button-ghost:
    textColor: "{colors.fg-soft}"
    rounded: "{rounded.control}"
    height: "36px"
  nav-tab:
    textColor: "{colors.fg-soft}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    height: "34px"
    padding: "0 12px"
  nav-tab-active:
    backgroundColor: "{colors.fg}"
    textColor: "{colors.wall}"
  segmented-option:
    backgroundColor: "{colors.tint-wash}"
    textColor: "{colors.fg-soft}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    height: "36px"
  segmented-option-active:
    backgroundColor: "{colors.fg}"
    textColor: "{colors.wall}"
  input-field:
    backgroundColor: "{colors.tint-wash}"
    textColor: "{colors.fg}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.control}"
    height: "44px"
    padding: "0 14px"
  card:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.fg}"
    rounded: "{rounded.card}"
    padding: "20px"
  sticker:
    backgroundColor: "{colors.coral}"
    textColor: "{colors.coral-ink}"
    typography: "{typography.section-label}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
  dialog:
    backgroundColor: "{colors.glass-strong}"
    textColor: "{colors.fg}"
    rounded: "{rounded.float}"
    padding: "24px"
---

# Design System: GGUU AI IMAGE

<!-- 2026-10-10 agent01 按 impeccable document 流程，从 F2（海报 · 柔和版）已上线的代码重写：apps/web/src/app/globals.css、components/ui/{button-variants,select,poster-tabs,dialog}.tsx、components/app-sidebar.tsx、components/landing/*、components/studio/*、components/brand/brand-mark.tsx。替换 10-08 的「夜色光场」版本。改 token 时同步本文件，再跑 `node scripts/build-design-sidecar.mjs` 重新生成 .impeccable/design.json；方向合同在 .impeccable/surfaces/src-app-page-tsx.md。 -->

## Overview

**Creative North Star: "一张会换颜色的海报"**

GGUU AI IMAGE 是一间有光的房间，房间里挂着一张海报。粉调浅灰的墙往下过渡成稍深的地面，中间有一条地平线；正在看的那张图把整个房间淡淡地染成它的颜色（墙、地面、光晕、背后的色块），换一张图，房间跟着换色。海报的语法负责说话：超大的优设标题黑写主张，斜切的按钮和页签做选择，微微歪着的珊瑚贴纸做标记，Big Shoulders 大号数字报张数、余额和计时。

亮暗两套主题是同一张海报在不同光线下：亮色是午后的粉灰房间，石墨紫墨字；暗色是低光下的深紫黑房间，近白的字，珊瑚提亮一档。落地页（Persuade）让作品和标题占满首屏；工作台（Operate：生图、画布、设置、品牌套件、技能）把同一套语法收紧：斜切只给选项和主动作，面板是安静的 16px 圆角卡片，磨砂玻璃只给漂浮在房间或图片上的控件和弹窗。

用户明确否决过的方向：Loomic 品牌；琥珀 / 黄色铺色；纯黑白、硬黑边、零模糊投影的刺眼海报；暗房、冲印、显影一类行话。

**Key Characteristics:**
- 房间而不是平面：墙到地面的过渡、地平线、接触阴影和倒影给出空间感。
- 环境色来自图片：`--amb` / `--amb-2` 在运行时从当前图片取样，GSAP 补间写到 `<html>`。
- 一种强调色：珊瑚，只给每屏最要紧的那个动作和被选中的那张图。
- 斜切加小圆角（-10°）是选择和行动的形状；卡片和面板保持正放。
- 状态永远配文字，颜色只是辅助。

## Colors

一种石墨紫的中性色系，加一个珊瑚强调色和一组来自图片的环境色；暗色主题用同一套名字（frontmatter 里带 `-dark` 的值）。

### Primary
- **珊瑚 Coral**（亮 #e5533d / 暗 #ff8068）：每屏最要紧的那个动作（「生成 N 张」「开始生成」「登录」「重绘 N 张」）、选中图片的外圈（`ring-picked`：一圈墙色缝再一圈珊瑚）、分区名前的斜杠、生成中的状态点、品牌标。亮色上配白字，暗色上配深色字（#24141a）。写成文字时用 `coral-text`（亮 #bf3b2a / 暗 #ff977f）保证对比度；压在墨色底上的珊瑚字用 `coral-on-ink`。浅底 `coral-soft` 用在选中项的背景和扩图预览的条纹。

### Secondary
- **环境色 Ambient**（默认 rgb(224 122 102) 珊瑚肉色 / rgb(196 70 128) 莓果）：从当前图片取样，染房间的墙、地面光晕和大图背后的色块；暗色下也给大图投出同色的光（`shadow-lit`）。它是氛围，不是控件颜色：按钮、文字、边框都不用它。

### Neutral
- **墙 Wall**（#f5f2f3 → #ede9eb；暗 #1c1a22 → #17151c）：页面底色，从上往下过渡。
- **地面 Floor**（#e6e1e4 / #dbd5d9；暗 #131118 / #0f0e13）：地平线以下，以及弹窗和大图里放图的舞台。
- **面板 Panel**（#fbfafb；暗 #25222c）：卡片、设置分组、编辑器侧栏。
- **凹槽 Well**（#f0ecee；暗 #17151c）：提示词框这类往下凹的输入区。
- **墨 Ink**（#24212b；暗 #f2eff4）：正文和标题；也是「墨色」选中态（导航页签、分段选项、用户消息气泡）的底色。
- **次级字 / 弱字**（#5c5766 / #6f6a78；暗 #beb8c6 / #a39dad）：说明和辅助信息。
- **线 Line**（墨色 10% / 18%）：分隔和描边，只在需要分组时用。
- **叠加 Tint**：亮色是墨，暗色是近白，写成 `bg-tint/[0.06]` 这类，用于输入框底、未选中的分段选项、悬停。

### 状态色
- **待核对 Warn**（#b9560f；暗 #ffa066）配浅底：结果未知、图片可能已经生成。
- **失败 Alert**（#b4233f；暗 #ff7b93）配浅底：和珊瑚明显分开的深红。
- **成功 Ok**（#1f8a5b；暗 #5fd3a1）：只在设置里的 Key 状态这类地方用；生成成功的图不标状态。

### Named Rules
**The One Coral Rule.** 每屏只有一个珊瑚动作。第二个按钮用墨色、描边或幽灵样式；珊瑚铺成大面积底色就错了。

**The Words First Rule.** 状态颜色永远和文字一起出现（「待核对」「未发出」「没生成出来」）。去掉颜色后意思不变，才算合格。

**The No Amber Rule.** 不用琥珀或黄色铺色。橙色只出现在「待核对」的文字和浅底上。

## Typography

**Display Font:** GGUU Display（优设标题黑的子集，按 unicode-range 分片自托管；回退 Noto Sans SC、苹方）
**Numeral Font:** Big Shoulders Display（只用拉丁数字）
**Body Font:** Geist + Noto Sans SC（回退苹方、微软雅黑）
**Label/Mono Font:** Geist Mono

**Character:** 优设标题黑是海报上的大字，粗、略带倾斜感，说主张和名字；Big Shoulders 是海报上的大号数字，窄而高；Geist 和思源黑体负责安静、好读的正文。

### Hierarchy
- **Display**（400，clamp(88px, min(14vw, 19.5dvh), 212px)，行高 1）：只在落地页首屏，「一句话」；第二行「生成你想要的图」约 96px，「想要的图」用珊瑚。
- **Headline**（400，clamp(36px, 4.2vw, 56px)，行高 1.02）：工作台各页的页头（`PageHeader`）和落地页分区标题。
- **Section label**（400，17px，字距 0.02em）：分区名和字段名，前面带珊瑚斜杠「/ 提示词」（`poster-label`）；主按钮的标签也用这一档字体（`poster` 尺寸 19–21px）。
- **Numeral**（800，26px 起，行高 0.9）：张数步进器、画质 1K/2K/4K、余额、序号「01」、计时。
- **Title**（600，17px，行高 1.4）：卡片标题、弹窗标题。
- **Body**（400，16px，行高 1.8；工作台 14–15px，行高 1.6–1.7）：说明文字，最长约 34em。
- **Label**（600，13px）：分段选项、导航页签、按钮。
- **Data**（Geist Mono 11px，等宽数字）：请求 ID、比例、模型名这类数据。

### Named Rules
**The Display Is A Voice Rule.** 优设标题黑只用于标题、分区名、主按钮和贴纸，不用于段落、表单输入和长句。

**The Latin Digits Rule.** Big Shoulders 只排数字和 K、× 这类符号；中文单位（张、倍）用正文字体跟在后面。

## Layout

房间模型：页面上半是墙，下半是地面，落地页首屏的地平线大约在 y≈742（1440×900）；斜切大图立在地平线上，带接触阴影和倒影。工作台不画地平线，只保留墙到地面的渐变和环境色光晕。

- **容器**：内容最宽 1600px（生图页 1680px），左右边距手机 16px、平板 32px、桌面 clamp(20px, 2.4vw, 40px)。
- **顶部导航**：吸顶，高 64px（桌面 72px），滚动后加半透明墙色底和一条细线。手机上换成底部浮动栏（磨砂玻璃，18px 圆角，避开安全区）。
- **生图页**：桌面三栏，设置 368px、结果、记录栏 84px；平板两栏；手机单栏。结果按一次请求分组，每组一个标题行（提示词 + 说明行 + 时间贴纸）。
- **编辑器 / 大图弹窗**：左边是放图的舞台（地面色），右边 360–368px 的侧栏；手机上上下排列，舞台约占 46% 高度。
- **画布**：铺满视口，工具栏和设计助手侧栏漂浮在上面。
- **节奏**：字段之间 20px，分组之间 24–32px；落地页分区之间用大段留白而不是分隔线。

## Elevation & Depth

深度来自光：带偏移的柔和阴影，颜色压向房间的暖石墨色（亮色 rgb(84 52 60)，暗色用黑），从不用纯黑硬投影。面板静止时只有很轻的阴影，悬停时加深；漂浮的控件用磨砂玻璃，顶边一条高光代替描边。

### Shadow Vocabulary
- **Subtle**（`0 1px 2px var(--shadow)`）：小控件。
- **Card**（`0 1px 2px var(--shadow), 0 22px 40px -26px var(--shadow-2)`）：结果卡片和面板；悬停换成 **Card hover**（`0 2px 4px var(--shadow), 0 30px 50px -24px var(--shadow-2)`）。
- **Float**（`0 6px 14px var(--shadow), 0 30px 64px -20px var(--shadow-2)`）：漂浮的工具条和菜单。
- **Accent pool**（`0 14px 30px -12px var(--acc-glow)`）：珊瑚主按钮下面的一汪珊瑚光。
- **Picked**（`0 0 0 3px var(--ground), 0 0 0 5px var(--acc), 0 26px 46px -22px var(--acc-glow)`）：被选中的那张图。
- **Lit**（亮：接触阴影加长投影；暗：再加一圈环境色光晕 `0 0 140px -30px rgb(var(--amb) / 0.6)`）：立在房间里的大图和编辑中的原图。
- **Glass / Glass strong**（`blur(20–24px) saturate(125–140%)`，顶边 1px 高光）：导航、浮动工具条、菜单、弹窗；系统要求减少透明时退回实色面板。

### Named Rules
**The Lit Not Lined Rule.** 用光和阴影分层，不用硬描边。描边只在输入框、分段选项这类需要「边界可点」的地方出现，并且是墨色 10–18% 的细线。

**The Opaque Workbench Rule.** 要在上面精细操作的弹窗（局部重绘 / 扩图编辑器）用实色面板，不能让背后的结果列表透出来。

## Shapes

两种形状语言并存，各管各的：

- **斜切 Slant**（`skewX(-10deg)` 加 10–14px 小圆角，`sk` / `sk-in`）：按钮（`slant`）、导航页签、分段选项、海报页签（`PosterTabs`）、贴纸、比例格子、落地页的大图和缩略图（`sk-frame`，图片反向倾斜并放大 1.16 倍铺满）。文字永远在 `sk-in` 里摆正。
- **正放圆角 Upright**：控件 10px，图片 14px，卡片和面板 16px，大的浮层和弹窗 20px；全圆只给状态点。
- **贴纸 Sticker**：珊瑚底的小牌子，旋转 -6° 到 1.5°，像随手贴上去的；设计助手的出图卡片上，「已放到画布」贴纸在流式时盖章动一下。
- **品牌标**：珊瑚圆角方块，斜得比按钮更多（-14°），16px 时读作「一道珊瑚斜杠」。

**The Slant Means Choose Rule.** 斜切只给「可以选、可以按」的东西。面板、卡片、输入框、整块区域不斜。

## Components

### Buttons
- **Shape:** 柔和圆角（10px），主行动作可以加斜切；`poster` 尺寸高 48px，14px 圆角，优设标题黑 19px 标签。
- **Accent（珊瑚）:** 每屏最要紧的动作，白字（暗色深字），下面一汪珊瑚光；悬停加深，按下下沉 1px 并缩到 0.98。
- **Ink（墨色，default）:** 强的次要动作，暗色主题下自动反色。
- **Outline / Secondary / Ghost:** 安静的动作，叠加色 5–10% 的底或细描边。
- **Destructive:** 深红浅底加深红字，不用实心红。
- **Focus:** 2px 珊瑚轮廓，偏移 2px。禁用时 50% 透明、不可点。

### Poster tabs and segmented choices
- **Style:** 斜切小块，未选中是叠加色 5.5% 的底和次级字；选中是墨色底加墙色字（暗色反过来）。
- **State:** 完整的 tab / radio 语义，方向键切换。画质 1K/2K/4K 用 `lg` 尺寸，高 48px，Big Shoulders 26px 数字。
- **Ratio grid:** 每个比例画一个小框图标加比例文字，当前模型不支持的会禁用并在读屏里说明。

### Cards / Containers
- **Corner Style:** 16px（结果图片 14px）。
- **Background:** 面板色；放图的区域用地面色。
- **Shadow Strategy:** Card / Card hover，选中的图用 Picked。
- **Border:** 默认没有，靠阴影分层。
- **Internal Padding:** 20–24px。

### Inputs / Fields
- **Style:** 叠加色 6% 的底，10–14px 圆角，没有描边；提示词框是凹下去的 `well` 底。
- **Focus:** 珊瑚内描边（`inset 0 0 0 1px var(--acc)`），大输入框再加一圈 3px 珊瑚浅光；光标是珊瑚色。
- **Labels:** 字段名用分区名样式「/ 改成什么」，旁边可带一句弱字说明。

### Navigation
- **桌面：** 字标（珊瑚斜块 + GGUU + 「AI IMAGE」小签）、斜切页签（13.5px 半粗，当前页墨色底）、右侧余额（Big Shoulders 数字）、充值、主题切换、头像。
- **手机：** 底部浮动磨砂栏，图标加两字标签，当前项加粗。

### Result card and toolbar（生图页的签名组件）
每张结果是一张 14px 圆角的图卡，组标题是提示词（优设标题黑）加一行等宽说明（「扩图 · 16:9 · 2K · 1 张 · GPT Image 2」）和时间贴纸。选中或悬停时，底部浮出一条深色磨砂工具条：珊瑚「以此为参考」、变体、局部重绘、扩图、看大图、下载。生成中是斜纹加往复的进度条（不显示假的百分比）；刚完成的图从模糊揭开显现（`RevealImage`）。只有「待核对」和「未发出」两种标记，成功的图不标计费状态。

### Mask editor（局部重绘 / 扩图）
实色弹窗：左边地面色舞台放原图，右边 368px 侧栏放海报页签、字段和珊瑚主按钮。局部重绘的涂抹层以 55% 不透明的珊瑚红叠在图上，笔刷光标是白圈加细黑边；底部一条磨砂工具条放画笔 / 擦除、笔刷大小、撤销 / 重做 / 清空。扩图预览把新增的部分画成珊瑚浅色斜纹，外面一圈珊瑚细线框出新画框。

## Do's and Don'ts

### Do:
- **Do** 每屏只放一个珊瑚动作，其他按钮用墨色、描边或幽灵样式。
- **Do** 只用语义 token（`fg`、`panel`、`tint`、`acc`……），不写死白色或黑色，两套主题才能同时成立；压在照片上的文字例外，两种主题都用白字加 `scrim` 遮罩。
- **Do** 把斜切留给按钮、页签、分段选项、贴纸和落地页的大图，文字放在 `sk-in` 里摆正。
- **Do** 状态写成文字再配颜色：「待核对」（橙）、「未发出」（灰）、「没生成出来」（深红）。
- **Do** 每个动效在 `prefers-reduced-motion` 下直接显示最终状态；磨砂玻璃在 `prefers-reduced-transparency` 下退回实色。
- **Do** 文案直白：「生成」「图片」「余额」「改成什么」。

### Don't:
- **Don't** 用琥珀或黄色铺色，也不做纯黑白、硬黑边、零模糊投影的刺眼海报。
- **Don't** 出现 Loomic 品牌，或暗房、冲印、显影这类行话。
- **Don't** 把斜切用在整块面板、卡片或输入框上。
- **Don't** 用纯黑投影或硬描边分层；阴影压向房间的石墨色。
- **Don't** 只靠颜色表达状态，也不给成功的图贴「已扣费」一类标签。
- **Don't** 在工作界面放付费说明；计费说明只在落地页一节。
- **Don't** 把环境色用在按钮、文字或边框上。

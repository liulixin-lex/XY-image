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
  fg-muted: "#66626f"
  line: "rgb(36 33 43 / 0.1)"
  line-strong: "rgb(36 33 43 / 0.18)"
  tint-wash: "rgb(36 33 43 / 0.06)"
  coral: "#d4412a"
  coral-hover: "#c2361f"
  coral-ink: "#ffffff"
  coral-text: "#b23727"
  coral-soft: "rgb(212 65 42 / 0.11)"
  coral-on-ink: "#ff8068"
  alert: "#b4233f"
  alert-wash: "rgb(180 35 63 / 0.09)"
  warn: "#9f4a0d"
  warn-wash: "rgb(185 86 15 / 0.1)"
  ok: "#19714b"
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
    fontFamily: "GGUU Display, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, system-ui, sans-serif"
    fontSize: "clamp(88px, min(14vw, 19.5dvh), 212px)"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "GGUU Display, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, system-ui, sans-serif"
    fontSize: "clamp(36px, 4.2vw, 56px)"
    fontWeight: 400
    lineHeight: 1.02
  section-label:
    fontFamily: "GGUU Display, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, system-ui, sans-serif"
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
    fontFamily: "Geist, PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Geist, PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.8
  body-sm:
    fontFamily: "Geist, PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Geist, PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, system-ui, sans-serif"
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

<!-- 2026-10-13 agent01（第 62 条）：落地页加入滚动编排（首屏 CSS 入场 + 大图滚出时 3D 后转、示例区吸顶横向 3D 卷轴、三种开始方式叠放卡片、模型行擦入、计费视差、结尾扇形展开），工作台只加反馈级动效（卡片指针倾斜、管理页计数和图表绘制）；示例图全部换成本站 GPT Image 2.5 Sunburst 4K 生成的图；模型列表只留区分用的短备注（「效果优先」），去掉分组名、通用描述和档位芯片。 -->
<!-- 2026-10-12 agent01（第 57 条）：弹层（下拉、模型选择、菜单、浮层）统一用 glass-menu（面板色 95% + 28px 模糊），glass-strong 提到 92% / 94%；工作台统一页边距 gutter-x（顶栏、页头、各页、生图页对齐到同一条线，生图页宽度和顶栏一样 1600）；图片说明用 veil-bottom（自下而上的渐进模糊 + 暗纱），横排两端用 edge-blur，竖向滚动区两端用 fade-y / fade-b；弹窗背景 10px 磨砂。顶栏「画布」「作品」都是直接链接。 -->
<!-- 2026-10-12 agent01（第 56 条打磨）：亮色珊瑚加深一档 #e5533d → #d4412a（同 8° 色相，白字从 3.7:1 到 4.6:1；品牌标保留原珊瑚）；弱字、珊瑚字、待核对橙、成功绿压到地面色上也 ≥4.5:1；玻璃加发丝边和顶光渐变，新增 glass-ink（压在图片上的深色磨砂）；顶栏改成渐进模糊；最近生成的图卡随滚动入场。 -->
<!-- 2026-10-10 agent01 按 impeccable document 流程，从 F2（海报 · 柔和版）已上线的代码重写：apps/web/src/app/globals.css、components/ui/{button-variants,select,poster-tabs,dialog}.tsx、components/app-sidebar.tsx、components/landing/*、components/studio/*、components/brand/brand-mark.tsx。替换 10-08 的「夜色光场」版本。改 token 时同步本文件，再跑 `node scripts/build-design-sidecar.mjs` 重新生成 .impeccable/design.json；方向合同在 .impeccable/surfaces/src-app-page-tsx.md。 -->

## Overview

**Creative North Star: "一张会换颜色的海报"**

GGUU AI IMAGE 是一间有光的房间，房间里挂着一张海报。粉调浅灰的墙往下过渡成稍深的地面，中间有一条地平线；正在看的那张图把整个房间淡淡地染成它的颜色（墙、地面、光晕、背后的色块），换一张图，房间跟着换色。海报的语法负责说话：超大的优设标题黑写主张，斜切的按钮和页签做选择，微微歪着的珊瑚贴纸做标记，Big Shoulders 大号数字报张数、余额和计时。

亮暗两套主题是同一张海报在不同光线下：亮色是午后的粉灰房间，石墨紫墨字；暗色是低光下的深紫黑房间，近白的字，珊瑚提亮一档。落地页（Persuade）让作品和标题占满首屏；工作台（Operate：生图、画布、设置、品牌套件、技能）把同一套语法收紧：斜切只给选项和主动作，面板是安静的 16px 圆角卡片，磨砂玻璃只给漂浮在房间或图片上的控件和弹窗。

用户明确否决过的方向：Loomic 品牌；琥珀 / 黄色铺色；纯黑白、硬黑边、零模糊投影的刺眼海报；暗房、冲印、显影一类行话。

**Key Characteristics:**
- 房间而不是平面：墙到地面的过渡、地平线、接触阴影和倒影给出空间感。
- 环境色来自图片：`--amb` / `--amb-2` 在运行时从当前图片取样写到 `<html>`；房间染色换图时是新一层渐变淡入盖住旧的一层（只动 opacity），不逐帧补间变量。
- 一种强调色：珊瑚，只给每屏最要紧的那个动作和被选中的那张图。
- 斜切加小圆角（-10°）是选择和行动的形状；卡片和面板保持正放。
- 状态永远配文字，颜色只是辅助。

## Colors

一种石墨紫的中性色系，加一个珊瑚强调色和一组来自图片的环境色；暗色主题用同一套名字（frontmatter 里带 `-dark` 的值）。

### Primary
- **珊瑚 Coral**（亮 #d4412a / 暗 #ff8068；品牌标仍用 F2 原色 #e5533d）：每屏最要紧的那个动作（「生成 N 张」「开始生成」「登录」「重绘 N 张」）、选中图片的外圈（`ring-picked`：一圈墙色缝再一圈珊瑚）、分区名前的斜杠、生成中的状态点、品牌标。亮色上配白字，暗色上配深色字（#24141a）。写成文字时用 `coral-text`（亮 #b23727 / 暗 #ff977f）保证对比度；压在墨色底上的珊瑚字用 `coral-on-ink`。浅底 `coral-soft` 用在选中项的背景和扩图预览的条纹。

### Secondary
- **环境色 Ambient**（默认 rgb(224 122 102) 珊瑚肉色 / rgb(196 70 128) 莓果）：从当前图片取样，染房间的墙、地面光晕和大图背后的色块；暗色下也给大图投出同色的光（`shadow-lit`）。它是氛围，不是控件颜色：按钮、文字、边框都不用它。

### Neutral
- **墙 Wall**（#f5f2f3 → #ede9eb；暗 #1c1a22 → #17151c）：页面底色，从上往下过渡。
- **地面 Floor**（#e6e1e4 / #dbd5d9；暗 #131118 / #0f0e13）：地平线以下，以及弹窗和大图里放图的舞台。
- **面板 Panel**（#fbfafb；暗 #25222c）：卡片、设置分组、编辑器侧栏。
- **凹槽 Well**（#f0ecee；暗 #17151c）：提示词框这类往下凹的输入区。
- **墨 Ink**（#24212b；暗 #f2eff4）：正文和标题；也是「墨色」选中态（导航页签、分段选项、用户消息气泡）的底色。
- **次级字 / 弱字**（#5c5766 / #66626f；暗 #beb8c6 / #a39dad）：弱字压到最深的地面色上也有 4.5:1：说明和辅助信息。
- **线 Line**（墨色 10% / 18%）：分隔和描边，只在需要分组时用。
- **叠加 Tint**：亮色是墨，暗色是近白，写成 `bg-tint/[0.06]` 这类，用于输入框底、未选中的分段选项、悬停。

### 状态色
- **待核对 Warn**（#9f4a0d；暗 #ffa066）配浅底：结果未知、图片可能已经生成。
- **失败 Alert**（#b4233f；暗 #ff7b93）配浅底：和珊瑚明显分开的深红。
- **成功 Ok**（#19714b；暗 #5fd3a1）：只在设置里的 Key 状态这类地方用；生成成功的图不标状态。

### Named Rules
**The One Coral Rule.** 每屏只有一个珊瑚动作。第二个按钮用墨色、描边或幽灵样式；珊瑚铺成大面积底色就错了。

**The Words First Rule.** 状态颜色永远和文字一起出现（「待核对」「未发出」「没生成出来」）。去掉颜色后意思不变，才算合格。

**The No Amber Rule.** 不用琥珀或黄色铺色。橙色只出现在「待核对」的文字和浅底上。

## Typography

**Display Font:** GGUU Display（优设标题黑的子集，按 unicode-range 分片自托管，界面用字那一片预加载；回退系统中文字体）
**Numeral Font:** Big Shoulders Display（只用拉丁数字）
**Body Font:** Geist + 系统中文字体（`--font-cjk`：苹方、冬青黑、微软雅黑、思源黑体；不再下载网络中文字体）
**Label/Mono Font:** Geist Mono

**Character:** 优设标题黑是海报上的大字，粗、略带倾斜感，说主张和名字；Big Shoulders 是海报上的大号数字，窄而高；Geist 和系统黑体（苹方、雅黑）负责安静、好读的正文。

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

**页边距 gutter-x（第 57 条）**：手机 16px、平板 32px、桌面 `clamp(20px, 2.4vw, 40px)`。顶栏、页头、首页、作品、画布项目、技能、品牌套件、设置、生图页都用它，内容宽度都是 1600px：字标、页标题和内容左边对齐在同一条线上。

房间模型：页面上半是墙，下半是地面，落地页首屏的地平线大约在 y≈742（1440×900）；斜切大图立在地平线上，带接触阴影和倒影。工作台不画地平线，只保留墙到地面的渐变和环境色光晕。

- **容器**：内容最宽 1600px（生图页 1680px），左右边距手机 16px、平板 32px、桌面 clamp(20px, 2.4vw, 40px)。
- **顶部导航**：吸顶，高 64px（桌面 72px），滚动后加半透明墙色底和一条细线。手机上换成底部浮动栏（磨砂玻璃，18px 圆角，避开安全区）。
- **生图页**：桌面三栏，设置 368px、结果、记录栏 84px；平板两栏；手机单栏。结果按一次请求分组，每组一个标题行（提示词 + 说明行 + 时间贴纸）。
- **编辑器 / 大图弹窗**：左边是放图的舞台（地面色），右边 360–368px 的侧栏；手机上上下排列，舞台约占 46% 高度。
- **画布**：铺满视口，工具栏和设计助手侧栏漂浮在上面。
- **节奏**：字段之间 20px，分组之间 24–32px；落地页分区之间用大段留白而不是分隔线。

## Elevation & Depth

深度来自光：带偏移的柔和阴影，颜色压向房间的暖石墨色（亮色 rgb(84 52 60)，暗色用黑），从不用纯黑硬投影。面板静止时只有很轻的阴影，悬停时加深；贴在页面里的半透明面板不做背景模糊（`glass`），压在画面或图片上的小控件才用磨砂玻璃（`glass-float`），顶边一条高光代替描边。没有显卡加速的机器上（渲染档位 lite，`<html data-render="lite">`）磨砂整体换成同色实底，层次靠阴影和高光保留。

### Shadow Vocabulary
- **Subtle**（`0 1px 2px var(--shadow)`）：小控件。
- **Card**（`0 1px 2px var(--shadow), 0 22px 40px -26px var(--shadow-2)`）：结果卡片和面板；悬停换成 **Card hover**（`0 2px 4px var(--shadow), 0 30px 50px -24px var(--shadow-2)`）。
- **Float**（`0 6px 14px var(--shadow), 0 30px 64px -20px var(--shadow-2)`）：漂浮的工具条和菜单。
- **Accent pool**（`0 14px 30px -12px var(--acc-glow)`）：珊瑚主按钮下面的一汪珊瑚光。
- **Picked**（`0 0 0 3px var(--ground), 0 0 0 5px var(--acc), 0 26px 46px -22px var(--acc-glow)`）：被选中的那张图。
- **Lit**（亮：接触阴影加长投影；暗：再加一圈环境色光晕 `0 0 140px -30px rgb(var(--amb) / 0.6)`）：立在房间里的大图和编辑中的原图。
- **Glass / Glass float / Glass strong**（e1 / e2 / e3）：三档共用同一种材质——顶边 1px 高光、一圈发丝边（`--glass-edge`，亮 白 55% / 暗 白 7%）、自上而下的顶光渐变（`--glass-sheen`）；`glass` 不模糊，`glass-float` `blur(20px) saturate(150%)`，`glass-strong` `blur(24px) saturate(150%)`，阴影一档比一档长、软。系统要求减少透明时退回实色面板。
- **Glass menu**（`glass-menu`）：下拉、模型选择器、菜单、浮层这类会盖在文字上的弹层。面板色 95% 加 `blur(28px) saturate(170%)`，后面的页面只剩一点色调，看不出字（第 57 条：62% 的玻璃让背后的大标题和选项叠在一起）。弹窗用 `glass-strong`（亮 92% / 暗 94%）。
- **Glass ink**（`glass-ink`）：压在图片上的深色磨砂（结果卡工具条、图上的角标和图标按钮），两套主题都是白字，`blur(14px) saturate(160%)` 加发丝边；lite 档位换成 86% 实底。
- **Progressive veil**（`progressive-veil`）：顶栏的渐进模糊。页面滚到顶栏下面时，三层逐级加深的背景模糊（2 / 6 / 14px，各自用渐变遮罩）加一层墙色薄纱，往下 32px 渐隐，没有硬分隔线；只淡入淡出整层，不动画模糊值。lite 档位和减少透明时退回实色墙。

### Named Rules
**The Lit Not Lined Rule.** 用光和阴影分层，不用硬描边。描边只在输入框、分段选项这类需要「边界可点」的地方出现，并且是墨色 10–18% 的细线。

**The Opaque Workbench Rule.** 要在上面精细操作的弹窗（局部重绘 / 扩图编辑器）用实色面板，不能让背后的结果列表透出来。

### Edges and veils
- **veil-bottom**：压在图片上的说明（作品页图块悬停时）：三层逐级加深的背景模糊加一层自下而上的暗纱，白字在任何图上都清楚；平时不显示（visibility），不占模糊开销。
- **edge-blur**：横排（首页最近生成）还有内容的一端，渐进模糊加墙色渐隐，不硬切；两端由 `data-more-left` / `data-more-right` 控制。
- **fade-y / fade-b**：竖向滚动区（生图页记录栏、设置面板底部）两端 28px 渐隐，只用遮罩不模糊。

### Scroll
- **跟随滚动**：吸顶的只有顶栏、生图页的设置面板和最近生成的来源筛选（吸住后变成 glass-strong 小胶囊）。最近生成的图卡用滚动时间线（`scroll-rise`，`animation-timeline: view()`）从略低略淡升到原位，和滚动位置绑定；不支持的浏览器和减少动效时直接显示。长列表滚过 1.5 屏后出现「回到顶部」磨砂圆钮。
- **落地页滚动编排（第 62 条，GSAP ScrollTrigger，`lib/motion.ts`）**。用户从录屏预览里选了 A 横向 3D 卷轴和 A 卡片叠放，第二轮又选了标题遮罩、生图页屏幕、结尾图墙、按钮流光和生成中扫描：
  - 首屏：标题、副文、输入框和大图在首帧就由 CSS 播放入场（`hero-rise`、`stage-swing`），不等脚本，避免静态导出页「先显示、再隐藏、再播放」。宽屏上大图随指针轻微倾斜（≤ 9°），往下滚时大图向房间里转回去、缩小，标题以更快的速度上移（scrub，只动 transform / opacity）。
  - 示例区：区块吸顶，往下滚 = 横向翻看（`containerAnimation` 同一思路，`ease: "none"`）。卡片在共享透视里像 coverflow：正中那张正对你，两侧转开下沉；正中那张给房间换色（停稳 220ms 后才换）。底部刻度尺和 01/18 计数显示位置，点刻度、箭头或用键盘聚焦都会把页面滚到对应位置。手机、平板和减少动效时是原生横向滑动（scroll-snap），刻度尺照样跟随；lite 档位只吸顶滑动，不做逐张 3D。
  - 三种开始方式：三张卡片 `position: sticky` 依次吸住（每张低 22px），下一张盖上来时上一张缩到 0.93 并被一层墙色薄纱压暗（scrub，只动 transform / opacity）。手机上正常排列。
  - 模型列表：左侧标题吸顶；行作为列表出现时用 clip-path 从左擦入一次（`ScrollTrigger.batch`，最多错开 60ms）。
  - 计费说明：图片和背后色块以不同速度视差；记录卡从 38° 仰角翻平，请求 ID 逐字打出，只播一次。
  - 区块大标题：第一次滚进视野时每个字从遮罩里错落升起（GSAP SplitText，`RevealHeading`；参考 React Bits Masked/Split Text、anime.js splitText），只播一次。
  - 生图页长这样（示例区之后）：真实生图页截图（干净的示例数据，裁掉顶栏，不显示余额；亮暗各一张）装在屏幕框里，滚动时从后仰 32° 摆正（参考 Aceternity Container Scroll）。
  - 结尾海报：右侧是一面向后倾斜的示例图墙（`ImageWall`，8 列、每列 6 张裁成 3:4、重复 4 份，交替上下各移动一份的高度循环；参考 Aceternity 3D Marquee），左侧墨色渐隐保证文字清楚；手机上只留文字。图墙靠近视口才挂载并加载图片。
  - 首屏「开始生成」：约每 4 秒一道斜光扫过（`star-glint`，只动 transform）。
- **生图页「生成中」**：点阵网格加一道自上而下的珊瑚扫描线（`gen-scan`，参考 Aceternity Image Generation Loader），取代原来的斜纹和往复进度条；计时器保留。
- **工作台（Operate）只做反馈级动效**：首页最近生成和最近的画布卡片随指针轻微倾斜（`useTilt` + `tilt`，≤ 6°，只在可悬停的精确指针上）；管理页大数字计数上升、占用条从左长出、走势线自己画出来（`useCountUp`、`grow-x`、`draw-line`），都只播一次，减少动效时直接显示终态。

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
每张结果是一张 14px 圆角的图卡，组标题是提示词（优设标题黑）加一行等宽说明（「扩图 · 16:9 · 2K · 1 张 · GPT Image 2」）和时间贴纸。选中或悬停时，底部浮出一条深色磨砂工具条：珊瑚「以此为参考」、变体、局部重绘、扩图、看大图、下载。生成中是点阵网格加一道珊瑚扫描线（不显示假的百分比）；刚完成的图从模糊揭开显现（`RevealImage`）。只有「待核对」和「未发出」两种标记，成功的图不标计费状态。

### Mask editor（局部重绘 / 扩图）
实色弹窗：左边地面色舞台放原图，右边 368px 侧栏放海报页签、字段和珊瑚主按钮。局部重绘的涂抹层以 55% 不透明的珊瑚红叠在图上，笔刷光标是白圈加细黑边；底部一条磨砂工具条放画笔 / 擦除、笔刷大小、撤销 / 重做 / 清空。扩图预览把新增的部分画成珊瑚浅色斜纹，外面一圈珊瑚细线框出新画框。

## Do's and Don'ts

### Do:
- **Do** 每屏只放一个珊瑚动作，其他按钮用墨色、描边或幽灵样式。
- **Do** 只用语义 token（`fg`、`panel`、`tint`、`acc`……），不写死白色或黑色，两套主题才能同时成立；压在照片上的文字例外，两种主题都用白字加 `scrim` 遮罩。
- **Do** 把斜切留给按钮、页签、分段选项、贴纸和落地页的大图，文字放在 `sk-in` 里摆正。
- **Do** 状态写成文字再配颜色：「待核对」（橙）、「未发出」（灰）、「没生成出来」（深红）。
- **Do** 每个动效在 `prefers-reduced-motion` 下直接显示最终状态；磨砂玻璃在 `prefers-reduced-transparency` 下退回实色。
- **Do** 动效只动 transform、opacity、filter；展开收起用 grid 行 `0fr → 1fr`，依次进场用 `--stagger`。
- **Do** 文案直白：「生成」「图片」「余额」「改成什么」。

### Don't:
- **Don't** 用琥珀或黄色铺色，也不做纯黑白、硬黑边、零模糊投影的刺眼海报。
- **Don't** 出现 Loomic 品牌，或暗房、冲印、显影这类行话。
- **Don't** 把斜切用在整块面板、卡片或输入框上。
- **Don't** 用纯黑投影或硬描边分层；阴影压向房间的石墨色。
- **Don't** 只靠颜色表达状态，也不给成功的图贴「已扣费」一类标签。
- **Don't** 在工作界面放付费说明；计费说明只在落地页一节。
- **Don't** 把环境色用在按钮、文字或边框上。
- **Don't** 逐帧补间 `<html>` 上的 CSS 变量，或动画 width / height / backdrop-filter：整页每帧重算样式和重绘，就是 v0.0.2 卡顿的来源。

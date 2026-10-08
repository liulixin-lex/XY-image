---
version: 1
slug: "src-app-page-tsx"
primary_target: "src/app/page.tsx"
related_targets: ["src/app/login/page.tsx","src/app/(workspace)/layout.tsx","src/app/(workspace)/studio/page.tsx","src/app/canvas/page.tsx"]
---

## Scope

整站视觉重做（第二版，替换「暗房接触印样」）：落地页 `/`（Persuade）定义世界；登录、工作台首页、生图（/studio）、画布项目、设置、品牌套件、技能、画布外框（Operate）继承同一世界。品牌名 GGUU AI IMAGE（字标：GGUU 粗体 + 描边小标签 AI IMAGE）。

## Audience and job

主站用户与新创作者；来到落地页要弄懂「主站账号直接登录、按次从主站余额扣费、每笔可在主站账单查到」，然后写下画面、登录、出第一张图。真实素材只有 `public/images/showcase` 示例图（标注「示例作品」），不得编造价格、用户数、评价。

## Direction contract

THESIS: 页面的光来自正在看的那张图。一块倾斜悬在夜色房间里的大图屏照亮整页，换一张图，房间的颜色跟着换；生成的结果也落到这块屏上。拒绝品类默认：渐变背景上居中的「AI 魔法」大标题加等宽作品瀑布流。

OWN-WORLD: 夜色光场。深墨蓝底（#060912 / #0a0f1e / #111a2f），环境光是当前图片本身放大高斯模糊后的色场（--amb/--amb-2 取自图片主色），地面一条淡光带和屏幕倒影给出空间。磨砂玻璃面板只用于漂浮在图上的控制层（导航、输入框、信息卡）。主按钮是带环境光晕的近白按钮；芯片为胶囊形，面板 16–22px 圆角，图片 20px。标题用得意黑（Smiley Sans，斜体气质），正文用 Geist + 思源黑体，数据用 Geist Mono。异常用珊瑚红 rgb(255 138 128)，不用琥珀黄。文案直白亲切，不用暗房/冲印/曝光/显影等行话。

STORY: 访客先看到一张真实作品被投在倾斜大屏上照亮房间，读到「想到什么，就生成什么」和三件主站事实，在玻璃输入框里写下画面按「开始生成」（未登录先登录、提示词保留、不自动提交），点下方缩略图换图，整页的光随之改变。

FIRST VIEWPORT: 1440×900：左上字标，中上玻璃胶囊导航，右上登录。左侧 64px 起两行得意黑大标题（约 112px）「想到什么，/就生成什么」，「生成」用浅色强调；下接两行副文；再下一块 760px 宽玻璃输入框压在大屏左缘之上，右下近白「开始生成」。右侧 640px 起一块 rotateY(-24deg) 的大图屏（约 780×560）带倒影，顶部玻璃标签「示例作品 · 提示词」；屏下方缩略图条（当前一张放大描白边），配文「点一张，整个页面换成它的光」。

FORM: 氛围屏（用户在 A 光场舞台 / B 氛围屏 / C 光之长廊三张 HTML 效果图中选定 B，并明确表示「多多参考这张首页」；方向由用户钉定，未运行 concept-seed，无种子键）。效果图：`.impeccable/mocks/home-b.png`，工作台参考 `studio-b.png`。签名交互：换图换光（环境色场与屏幕交叉淡入，GSAP），屏幕随指针轻微转动；生成结果完成时落到工作台大屏上并点亮房间。全部在 prefers-reduced-motion 下降级为直接切换。

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- 示例图版权未核实，上线前替换为站点自产图（`src/components/landing/showcase.ts`）。
- 效果图为 HTML 渲染（未配置生图 API），按代码主导构建，效果图作评审参照。

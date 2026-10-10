---
version: 1
slug: "src-app-page-tsx"
primary_target: "src/app/page.tsx"
related_targets: ["src/app/login/page.tsx","src/app/(workspace)/layout.tsx","src/app/(workspace)/studio/page.tsx","src/app/canvas/page.tsx"]
---

## Scope

整站视觉重做（第三版，替换「夜色光场」）：落地页 `/`（Persuade）定义世界；登录、工作台首页、生图（/studio）、节点画布（/canvas，React Flow 重写）、对话生图（画布右侧设计助手）、项目、设置、品牌套件、技能（Operate）继承同一世界。亮暗两套主题，默认跟随系统，可手动切换并记住。品牌名 GGUU AI IMAGE。

## Audience and job

主站用户与新创作者；来到落地页要弄懂「主站账号直接登录、按次从主站余额扣费、每张图带请求 ID 可在主站账单查到」，然后写下画面、登录、出第一张图；进到工作台后能一次出多张、优化提示词、局部重绘和扩图，并在节点画布上连续创作。真实素材只有 `public/images/showcase` 示例图（标注「示例作品」），不得编造价格、用户数、评价。

## Direction contract

THESIS: 首页是一张会换颜色的海报：超大标题、斜切大图、贴纸标签和大号数字把「写一句话，拿到图」说清楚；选中的作品把整个房间（墙面、地面、光晕、背后的色块）染成它的颜色。拒绝品类默认：居中「AI 魔法」标题加等宽瀑布流；也拒绝硬黑边、纯红、纯黑白的刺眼海报。

OWN-WORLD: 柔和海报。亮色：粉调浅灰墙 #F5F2F3→#EDE9EB，地面 #E6E1E4，石墨紫墨字 #24212B；暗色：深紫黑墙 #1C1A22/#17151C，墨色字 #F2EFF4。唯一强调色珊瑚 #E5533D（暗色 #FF8068，配深色字）。环境光 --amb/--amb2 取自当前图片。形状语言：-10° 斜切加小圆角（按钮、页签、贴纸、缩略图、大图），贴纸微旋转；卡片和面板 16px；不用硬黑边、零模糊投影、条纹底和颗粒滤镜。字：优设标题黑（标题、按钮、分区名）、Big Shoulders Display（张数、计时、余额等大数字）、Geist 与苹方（正文）、Geist Mono（请求 ID、比例）。状态：已扣费绿、生成中珊瑚、待核对橙、未扣费灰，始终配文字。

STORY: 访客读到「一句话，生成你想要的图」和三条主站事实（1 个账号、1 份余额、1 次请求），在输入框写画面按「开始生成」（未登录先登录，提示词保留、不自动提交）；点缩略图换作品，房间颜色跟着换；往下看两种创作方式（生图、画布）。

FIRST VIEWPORT: 1440×900：左上字标（珊瑚斜块 + 优设标题黑 GGUU + AI IMAGE 小签），斜切导航页签，右上主题切换和「登录」。左侧「一句话」约 210px，下一行「生成你想要的图」约 94px（「想要的图」珊瑚），两行副文，640px 宽输入框（芯片 + 珊瑚斜切「开始生成」）。右侧约 500×620 的斜切大图立在地平线上（y≈742），后面有同色半透明斜块和两张虚化远景图，地面透视线、接触阴影和倒影；大图上贴「示例作品」贴纸和提示词卡。地面上左侧三组大数字事实，右侧斜切缩略图条和「02/12」。

FORM: 用户在第二轮五个方向（E 光幕 / F 海报 / G 构成 / H 仪器 / I 东方）中选定 F，并要求配色更亲和、有空间氛围、不刺眼；柔和版 F2 的强调色在珊瑚、莓果、潮汐蓝中选了珊瑚。这个方向不在 concept-seed 的排序表里（首轮种子键 7eb27b8b 的 A–D 四个方向用户都没选）。参考稿：`.impeccable/mocks/v4/board-f2.png` 及 `f2-*.png`（代码主导构建，参考稿作评审参照）。签名交互：换图换色（墙、地、光晕、斜块随图片主色过渡，GSAP），大图入场和指针视差，生成完成时结果卡的状态贴纸「盖章」落下。prefers-reduced-motion 下全部改为直接切换。

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- 示例图中 8 张继承图的版权未核实（用户 10-08 决定保留），上线前替换为站点自产图（`src/components/landing/showcase.ts`）。
- 优设标题黑、阿里妈妈系列等字体按发布方说明可免费商用，上线前逐个核对许可原文；Big Shoulders Display 为 OFL。

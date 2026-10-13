-- 技能市场第二版 (第 58 条, agent01).
--
-- 1. The official skill json-image-prompt becomes 「生图提示词规范」. Its
--    SKILL.md lives in the repo (skills/json-image-prompt/SKILL.md, read by
--    the agent from /skills/); this row only carries what the 技能 page shows.
--    The slug stays: it is the agent's path.
-- 2. Seven new curated skills for jobs the first eight did not cover, written
--    from OpenAI's GPT Image prompting guide (2026-04) and Google's Gemini
--    image docs: 信息图, 写实摄影, 插画风格, 界面样机, 室内空间, 服装上身,
--    图中文字翻译. Their SKILL.md follows the Agent Skills format (name and
--    description, then metadata).
-- 3. metadata.examples (things to say to the assistant) and
--    metadata.templates (生图模板 ids in apps/web/src/lib/templates.ts) for
--    every curated skill, shown in the skill's detail.
--
-- Re-runnable: the inserts upsert only rows that are already curated, the
-- updates only touch the rows they name.

-- 1 ─────────────────────────────────────────────────────────────────────
UPDATE public.skills
SET name = '生图提示词规范',
    description = '生成或修改任何图片前使用：按「用途、场景、主体、细节、约束」写清楚的提示词，画面里的字放引号，改图写明什么不变，按用途选比例、画质和质量，出图后按清单检查。',
    version = '2.0',
    author = 'GGUU AI',
    metadata = coalesce(metadata, '{}'::jsonb) || '{
      "examples": ["帮我做一张周末市集的海报，标题写「夏日市集」", "把这张产品图换成干净的白底", "照着这张设定图，画小狐狸在雨里撑伞"],
      "templates": ["poster-event", "ecom-white", "illus-character"]
    }'::jsonb,
    updated_at = now()
WHERE slug = 'json-image-prompt' AND source = 'system';

-- 2 ─────────────────────────────────────────────────────────────────────
INSERT INTO public.skills
  (name, slug, description, author, version, category, icon_name, source, is_featured, metadata, skill_content)
VALUES
(
  '信息图与图解',
  'xy-infographic',
  '把流程、步骤、对比、数据做成一张图时使用：先定结构和受众，字少而准，复杂内容拆成几张。',
  'GGUU AI', '1.0', 'design', 'workflow', 'community', true,
  '{"market": "curated", "tags": ["信息图", "图解", "流程图", "知识卡片", "PPT", "教程"],
    "examples": ["把手冲咖啡的五个步骤画成一张图解", "做一张「睡前三不要」的知识卡片"],
    "templates": ["info-process", "info-card"]}'::jsonb,
  $skill$---
name: xy-infographic
description: 把流程、步骤、对比、数据做成一张图时使用：先定结构和受众，字少而准，复杂内容拆成几张。
metadata:
  author: GGUU AI
  version: "1.0"
---

# 信息图与图解

## 先定三件事

- **给谁看、用在哪**：新手教程、内部汇报、社媒分享。决定详略和风格。
- **结构**：步骤（从上到下或从左到右）、对比（左右两栏）、层级（中心向外）、时间线。
- **每一块的字**：每块最多一个短标签（6 个字以内），逐字和用户确认。

## 写提示词

- 开头写清图的类型和受众：`信息图：手冲咖啡的步骤，给第一次手冲的新手看。`
- 写清结构：`从上到下 5 个步骤，每步一个简洁的插图配编号和短标签，箭头表示顺序。`
- 每个标签放在双引号里依次列出，并写「字形准确，每个只出现一次，除这些标签外不要其他文字」。
- 风格写成扁平插画、统一配色、留白充足。
- `quality` 用 high，`aspectRatio` 竖版 3:4，演示文稿用 16:9。

## 字多的时候

- 超过 6 块、或者每块要一段说明：拆成几张图，或者只让模型画插图和编号，文字用 manipulate_canvas 的 add_text 放到画布上。
- 数字、百分比、公式必须准确时，一律用画布文字，不让模型画。

## 出图后

逐个核对标签有没有错字、漏字、顺序错乱。有错就告诉用户，给出重出或改用画布文字的办法。生图页「模板」里的「流程图解」「知识卡片」可以直接用。
$skill$
),
(
  '写实摄影',
  'xy-photoreal',
  '要像真实照片的人像、产品、美食、建筑时使用：用摄影语言写光线、镜头和质感，避开「完美假脸」。',
  'GGUU AI', '1.0', 'generation', 'camera', 'community', true,
  '{"market": "curated", "tags": ["写实", "摄影", "人像", "美食", "产品", "照片感"],
    "examples": ["拍一张老书店窗边看书的人像，要像真的照片", "一碗牛肉面的美食照，45 度斜拍"],
    "templates": ["photo-portrait", "photo-food", "photo-interior"]}'::jsonb,
  $skill$---
name: xy-photoreal
description: 要像真实照片的人像、产品、美食、建筑时使用：用摄影语言写光线、镜头和质感，避开「完美假脸」。
metadata:
  author: GGUU AI
  version: "1.0"
---

# 写实摄影

## 写法

按「场景 → 主体 → 光线 → 镜头 → 质感」写成完整句子：

```
写实人像照片：三十岁左右的男性，灰色毛衣，在老式书店的窗边低头看书。窗边自然光从右侧照进来，85mm 人像镜头的视角和浅景深，背景的书架虚化。真实的皮肤纹理和毛发细节，不要过度磨皮，不要摆拍感，像一张真实拍到的照片。画面里不要出现文字和水印。
```

- **一定写光**：方向（侧光、逆光、顶光）、性质（柔和、硬朗）、来源（窗户、夕阳、霓虹）。
- **镜头感**：35mm 纪实感、85mm 人像、广角环境、微距特写。只用来定整体观感，不追求参数精确。
- **质感**：皮肤纹理、布料纤维、食物的油光和热气、金属反光。写「真实」「自然」，不写「完美」「8K」。
- **人物**：写清动作、视线和与物体的关系；手部容易出错，尽量让手自然放着或拿着东西。

## 参数

- 人像 3:4，美食 4:5 或 1:1，建筑和室内 3:2，风景 16:9。
- `quality` 用 high；第一次试方向可以 low。

## 不要

- 不画真实名人，不做以假乱真的新闻照片、证件照或冒充他人的图。用户要求时说明不能做。
- 不要写 Midjourney 的参数（`--ar`、`--style raw`），这里无效。

## 出图后

检查手指、牙齿、眼睛、文字招牌是否怪异；有问题建议在生图页用「局部重绘」只修那一块。
$skill$
),
(
  '插画风格统一',
  'xy-illustration-style',
  '做插画、贴纸、图标组、绘本时使用：先定一套画风写法，每张都照着写，让一组图像出自同一个画师。',
  'GGUU AI', '1.0', 'design', 'brush', 'community', false,
  '{"market": "curated", "tags": ["插画", "贴纸", "表情包", "图标", "绘本", "画风"],
    "examples": ["给橘猫做一组四个表情的贴纸", "做一组智能家居的 3D 黏土图标"],
    "templates": ["illus-sticker", "illus-icons", "illus-picturebook"]}'::jsonb,
  $skill$---
name: xy-illustration-style
description: 做插画、贴纸、图标组、绘本时使用：先定一套画风写法，每张都照着写，让一组图像出自同一个画师。
metadata:
  author: GGUU AI
  version: "1.0"
---

# 插画风格统一

## 先写一段「画风说明」

第一张图之前，和用户确认一段固定的画风说明，之后每张提示词都原样带上：

```
画风：温暖的水彩绘本风格，柔和的纸张纹理，线条细而松，配色以奶油白、雾蓝、浅橙为主，光线柔和，没有硬阴影。
```

包括：媒介（水彩、彩铅、3D 黏土、扁平矢量、像素）、线条、配色（能写色号就写）、光影、背景处理。

## 一组图

- **贴纸 / 表情包**：一张图里排成 2×2 或 3×3 网格，写「同一个角色，外形和配色一致，每个都有白色贴纸描边」。
- **图标组**：写清「统一视角、统一光线、统一圆角、统一配色，网格整齐排列，间距一致，不要文字」。
- **绘本**：先用「系列图与角色一致」技能出角色设定图，以后每页把设定图放进 inputImages。
- 风格满意的第一张，作为后续每张的参考图（inputImages），并写「沿用参考图的画风」。

## 参数

- 贴纸、图标 1:1；绘本内页 4:3；竖版封面 3:4。
- `quality` 一般 medium；细节多的封面用 high。

## 出图后

把新图和之前的放在一起看：线条粗细、配色、光影有没有跑偏。跑偏就把画风说明写得更具体，或者换一张更好的参考图。
$skill$
),
(
  '界面与设备样机',
  'xy-ui-mockup',
  '做 App 界面效果图、网页首屏、设备样机时使用：把界面当成已经上线的产品来描述，写清真实的界面元素。',
  'GGUU AI', '1.0', 'design', 'monitor-smartphone', 'community', false,
  '{"market": "curated", "tags": ["UI", "界面", "App", "网页", "样机", "效果图"],
    "examples": ["做一张记账 App 首页的手机样机图", "把这个网页首屏放进笔记本电脑样机里"],
    "templates": ["brand-mockup"]}'::jsonb,
  $skill$---
name: xy-ui-mockup
description: 做 App 界面效果图、网页首屏、设备样机时使用：把界面当成已经上线的产品来描述，写清真实的界面元素。
metadata:
  author: GGUU AI
  version: "1.0"
---

# 界面与设备样机

## 写法

把界面写成一个已经上线的真实产品，而不是「一个 UI 设计概念」：

```
一台 iPhone 竖放在浅灰桌面上，屏幕上是一款记账 App 的首页：顶部是本月支出总额 "¥3,280"，下面是一张按类别分色的环形图，再往下是最近 5 笔记录的列表，每行有图标、名称和金额，底部是 4 个标签的导航栏。界面是浅色主题，主色青绿，圆角卡片，留白充足。柔和的自然光，写实的产品摄影。除界面上的这些文字外不要其他文字。
```

- 列出主要的界面元素和从上到下的顺序；按钮、导航、卡片写具体。
- 界面上的字越少越准：只写标题和几个关键数字，其余用「几行列表」概括。
- 设备：手机、平板、笔记本、显示器；场景：纯色背景、桌面、手持。

## 用户已有截图

把截图放进 inputImages，写「把参考图里的界面放到 X 设备的屏幕上，界面内容保持不变，透视和反光自然」。

## 参数

- 手机样机 3:4 或 4:5，网页和桌面样机 16:9。
- `quality` 用 high（界面字小）。

## 提醒

生成的界面是效果图，不是可用的设计稿；需要可编辑的设计时，建议用户在设计工具里按这张图重画。
$skill$
),
(
  '室内与空间改造',
  'xy-interior-space',
  '装修效果图、换家具、换风格、门店空间设计时使用：以现场照片为准，只换指定的东西，透视和光线不变。',
  'GGUU AI', '1.0', 'generation', 'sofa', 'community', false,
  '{"market": "curated", "tags": ["室内", "装修", "家具", "空间", "民宿", "门店"],
    "examples": ["把这张客厅照片里的沙发换成墨绿色丝绒沙发", "这间空房做成日式原木风的效果图"],
    "templates": ["photo-interior", "edit-relight"]}'::jsonb,
  $skill$---
name: xy-interior-space
description: 装修效果图、换家具、换风格、门店空间设计时使用：以现场照片为准，只换指定的东西，透视和光线不变。
metadata:
  author: GGUU AI
  version: "1.0"
---

# 室内与空间改造

## 有现场照片（推荐）

把照片放进 inputImages，只写要换的东西，并列出不变的：

```
把参考图里的布艺沙发换成一张墨绿色丝绒三人沙发，尺寸和摆放位置与原沙发一致。房间的墙面、地板、窗户、其他家具、相机角度、透视和光线都保持不变，新沙发的阴影和反光与房间光线一致。
```

- 一次只换一两样；整屋换风格时写「保留房间结构、门窗位置和视角，只改变软装、材质和配色为日式原木风」。
- 用户要看多个方案时，每个方案一张，并说明差别。

## 没有照片

写清空间（面积感、朝向、门窗位置）、风格、时间和光线、视角（人眼高度的广角），参数 3:2 或 4:3，`quality` high。

## 提醒

效果图只用来看感觉：尺寸、结构和材料要以设计师和施工方为准。
$skill$
),
(
  '服装上身与换装',
  'xy-try-on',
  '把服装、饰品穿到模特或用户照片上时使用：人物的脸、身材、姿势不变，只换衣服，版型和面料以商品图为准。',
  'GGUU AI', '1.0', 'generation', 'shirt', 'community', false,
  '{"market": "curated", "tags": ["上身", "换装", "试穿", "服装", "模特", "电商"],
    "examples": ["把这件开衫穿到这张模特图上", "用这件连衣裙生成一张街拍上身图"],
    "templates": ["ecom-model"]}'::jsonb,
  $skill$---
name: xy-try-on
description: 把服装、饰品穿到模特或用户照片上时使用：人物的脸、身材、姿势不变，只换衣服，版型和面料以商品图为准。
metadata:
  author: GGUU AI
  version: "1.0"
---

# 服装上身与换装

## 两张参考图

inputImages 依次放：第 1 张人物照片，第 2 张服装商品图。提示词按顺序说明：

```
第 1 张参考图是人物，第 2 张是一件燕麦色粗针羊毛开衫。把第 2 张的开衫穿到第 1 张的人物身上，合身自然，褶皱和垂坠符合面料。人物的脸、发型、身材、姿势、背景和光线保持完全不变；开衫的颜色、针织纹理、纽扣和版型与第 2 张一致。
```

- 只有服装图、没有人物：写清模特的样子和场景（见生图页「模特上身图」模板）。
- 饰品（包、帽子、项链）同理，写清佩戴位置和大小。

## 底线

- 只处理用户本人或明确有权使用的照片；不要把衣服换到真实名人或他人的照片上，不做暴露、低俗的换装。
- 不改变人物的身份特征。

## 出图后

对照商品图检查颜色、图案、logo 有没有变；对照人物照检查脸是不是还是同一个人。不对就如实说明，建议重出或换模型。
$skill$
),
(
  '图中文字翻译',
  'xy-text-translate',
  '把海报、菜单、截图、包装上的文字翻成另一种语言时使用：译文放回原位，字号、颜色、排版不变。',
  'GGUU AI', '1.0', 'writing', 'languages', 'community', false,
  '{"market": "curated", "tags": ["翻译", "本地化", "海报", "菜单", "多语言"],
    "examples": ["把这张中文海报翻成英文版", "这份菜单做一个日文版"],
    "templates": ["edit-translate"]}'::jsonb,
  $skill$---
name: xy-text-translate
description: 把海报、菜单、截图、包装上的文字翻成另一种语言时使用：译文放回原位，字号、颜色、排版不变。
metadata:
  author: GGUU AI
  version: "1.0"
---

# 图中文字翻译

## 步骤

1. 先读出图里所有文字，列给用户，并给出你的译文，请用户确认（品牌名、人名通常不翻）。
2. 确认后，把原图放进 inputImages：

```
把参考图中的文字替换成下面的英文译文，每段译文放在原文的位置：标题 "Summer Market"，副标题 "Every Saturday · 10:00–18:00"。字号、颜色、字重、对齐方式和排版方向与原文一致。图片的其他部分、配色和布局完全不变，不要增加原图没有的文字。
```

3. `quality` 用 high。

## 注意

- 译文比原文长很多时，提醒用户可能放不下，建议精简或调小字号。
- 字很多（菜单、说明书）时分区域做，或者只翻主标题，正文用画布文字重排。
- 出图后逐字核对译文，有错字就告诉用户。
$skill$
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  author = EXCLUDED.author,
  version = EXCLUDED.version,
  category = EXCLUDED.category,
  icon_name = EXCLUDED.icon_name,
  is_featured = EXCLUDED.is_featured,
  metadata = EXCLUDED.metadata,
  skill_content = EXCLUDED.skill_content,
  updated_at = now()
WHERE public.skills.source = 'community'
  AND public.skills.metadata ->> 'market' = 'curated';

-- 3 ─────────────────────────────────────────────────────────────────────
UPDATE public.skills AS s
SET metadata = s.metadata || v.extra,
    updated_at = now()
FROM (VALUES
  ('xy-poster-design', '{"examples": ["做一张咖啡店开业海报，标题「今天开门」", "活动主视觉，要能打印 A3"], "templates": ["poster-event", "poster-festival", "poster-type"]}'::jsonb),
  ('xy-ecommerce-product', '{"examples": ["用这张照片做一张白底主图", "把这个保温杯放到露营场景里"], "templates": ["ecom-white", "ecom-scene", "ecom-selling-point"]}'::jsonb),
  ('xy-photo-edit', '{"examples": ["把背景里的路人去掉", "把这张图改成黄昏的光线"], "templates": ["edit-background", "edit-remove", "edit-relight"]}'::jsonb),
  ('xy-social-cover', '{"examples": ["小红书封面，标题「新手露营照抄就行」", "B 站视频封面，标题「一周只花 300」"], "templates": ["social-xhs", "social-video", "social-header"]}'::jsonb),
  ('xy-brand-consistency', '{"examples": ["按品牌套件做一组三张活动图", "这几张图的配色统一一下"], "templates": ["brand-mockup", "brand-packaging"]}'::jsonb),
  ('xy-character-series', '{"examples": ["先给小狐狸做个三视图设定", "照着设定图画第二页：小狐狸在灯塔里"], "templates": ["illus-character", "illus-picturebook"]}'::jsonb),
  ('xy-logo-draft', '{"examples": ["给「山野咖啡」出三个标志方向"], "templates": ["brand-logo"]}'::jsonb),
  ('xy-marketing-copy', '{"examples": ["给这张主图写三个标题", "海报的口号来几个不同风格的"]}'::jsonb),
  ('xy-canvas-arrange', '{"examples": ["把画布上的图排整齐，做成对比板", "这些参考图排成情绪板"]}'::jsonb)
) AS v(slug, extra)
WHERE s.slug = v.slug
  AND s.source = 'community'
  AND s.metadata ->> 'market' = 'curated';

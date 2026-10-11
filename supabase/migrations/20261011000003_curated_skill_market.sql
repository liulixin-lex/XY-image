-- Curated skills for the 技能 → 市场 tab.
--
-- The 市场 tab used to search npm for packages tagged "agent-skill": English
-- coding helpers (and unrelated packages such as yahoo-finance2), nothing for
-- posters or product shots. These are written for this product's agent and
-- its real tools (generate_image, inspect_canvas, manipulate_canvas,
-- screenshot_canvas, get_brand_kit). They are source = 'community' rows:
-- every signed-in user can read them (skills_select_all) and a workspace
-- installs one with an ordinary workspace_skills row, so 安装 / 卸载 / 启用
-- work exactly like the official skill. metadata.market = 'curated' marks
-- them for the 市场 tab; metadata.tags feed its search.
--
-- Slugs carry an xy- prefix: slug is unique across all users and is the
-- agent's path (/workspace-skills/<slug>/SKILL.md). ON CONFLICT only
-- refreshes rows that are already curated, so a later migration can edit a
-- skill by re-running its INSERT, and a user's own skill is never touched.
--
-- To change a skill later: add a new migration with UPDATE ... WHERE slug =
-- '<slug>' AND source = 'community', and bump version.

INSERT INTO public.skills
  (name, slug, description, author, version, category, icon_name, source, is_featured, metadata, skill_content)
VALUES
(
  '海报设计',
  'xy-poster-design',
  '做海报、活动主视觉、宣传单、邀请函时使用：先定比例和信息层级，再出图；文字要一字不差时改用画布文字叠加。',
  'GGUU AI', '1.0', 'design', 'layout-template', 'community', true,
  '{"market": "curated", "tags": ["海报", "主视觉", "宣传单", "邀请函", "排版"]}'::jsonb,
  $skill$---
name: xy-poster-design
description: 做海报、活动主视觉、宣传单、邀请函时使用：先定比例和信息层级，再出图；文字要一字不差时改用画布文字叠加。
---

# 海报设计

## 先问清楚（缺什么问什么，只问一轮）

- 用在哪里：手机上发、打印张贴、易拉宝、屏幕投放。这决定比例和尺寸。
- 画面上必须出现的文字：主标题、副标题、时间地点、按钮文案。逐字和用户确认。
- 风格参照：用户上传的图、品牌色，或一句话风格（如"复古丝网印刷""日式极简"）。

## 比例和尺寸

| 用途 | aspectRatio | resolution |
| --- | --- | --- |
| 手机海报、朋友圈 | 9:16 或 3:4 | 2K |
| 打印 A4 / A3 竖版 | 3:4（A 系列约 1:1.41，打印时两边留出血） | 4K |
| 横幅、屏幕投放 | 16:9 | 2K |
| 方形社媒图 | 1:1 | 2K |

只有打印或大尺寸展示才用 4K，它更慢。模型不支持的比例会被换成最接近的一个，出图后告诉用户实际比例。

## 版面

- 只放一个视觉焦点。主标题约占画面高度的 1/5 到 1/3，四周留白。
- 在提示词里写清位置关系，例如："主体人物在画面下半部分，上方 40% 是干净的浅色背景，留给标题"。
- 信息层级：主标题 > 主视觉 > 副标题 > 时间地点 > 小字。不要把所有文字做得一样大。

## 文字

- 10 个字以内的短标题可以让模型直接画：文字放进引号，写明字体气质、颜色和位置，例如 `标题文字 "夏日市集"，粗黑体，白色，居中在画面上方`。
- 日期、地址、价格、二维码说明这类必须一字不差的内容：先出一张留好空白的底图，再用 manipulate_canvas 的 add_text 把文字放到画布上，用户之后还能改。
- 出图后检查有没有错字、多字、乱码。有就如实告诉用户，并给出改法：在「生图」页用「局部重绘」重画那一块，或换成画布文字。

## 流程

1. 项目绑定了品牌套件时，先调用 get_brand_kit，沿用其中的颜色和字体气质。
2. 写提示词（装了「结构化提示词」技能时按它的格式写），一次只出一张。
3. 给用户看结果，说明比例和尺寸，问要不要换方向。用户要多个方案时再出多张。
$skill$
),
(
  '电商主图',
  'xy-ecommerce-product',
  '做商品主图、白底图、场景图、详情页配图时使用：以用户的商品照片为参考，商品本身保持不变，只换背景和场景。',
  'GGUU AI', '1.0', 'design', 'shopping-bag', 'community', true,
  '{"market": "curated", "tags": ["电商", "主图", "白底图", "场景图", "详情页", "商品"]}'::jsonb,
  $skill$---
name: xy-ecommerce-product
description: 做商品主图、白底图、场景图、详情页配图时使用：以用户的商品照片为参考，商品本身保持不变，只换背景和场景。
---

# 电商主图

## 最重要的一条：商品不能变样

- 用户给了商品照片，就一定把它放进 generate_image 的 inputImages（用户附加的图片，或画布上那张图的地址）。
- 提示词写明："保持商品的外形、颜色、logo 和包装上的文字完全不变，只改变背景和场景"。
- 没有商品照片时，先请用户上传。不要凭文字描述重新画一个商品：画出来的和实物不一致，不能拿去卖。

## 常用图型

- 白底主图：1:1，纯白背景（#FFFFFF），商品居中，约占画面 70%–80%，底部一点柔和阴影。
- 场景图：1:1 或 3:4。写清使用场景、光线、时间和道具；道具颜色要比商品弱，不能抢主体。
- 详情页单屏：3:4 或 9:16，一屏只讲一个卖点。
- 主流平台的主图都是正方形，2K 足够；要做印刷物料时才用 4K。

## 卖点和价格文字

价格、促销信息、规格参数不要让模型画进图里。先出干净的图，再用 manipulate_canvas 的 add_text 把文字叠在画布上，方便改价和换活动。

## 出图后检查

对照原图看 logo、包装文字、颜色、比例有没有变。变了就如实告诉用户，换一种说法重出；或者建议在「生图」页用「局部重绘」只涂背景区域，让商品完全不动。
$skill$
),
(
  '改图与修图',
  'xy-photo-edit',
  '用户要修改已有图片时使用（换背景、改颜色、加减物体、换风格、修瑕疵）：把原图作为参考，只描述要改的地方。',
  'GGUU AI', '1.0', 'generation', 'wand-sparkles', 'community', true,
  '{"market": "curated", "tags": ["修图", "改图", "换背景", "去路人", "编辑", "参考图"]}'::jsonb,
  $skill$---
name: xy-photo-edit
description: 用户要修改已有图片时使用（换背景、改颜色、加减物体、换风格、修瑕疵）：把原图作为参考，只描述要改的地方。
---

# 改图与修图

- 把要改的图片放进 generate_image 的 inputImages（用户附加的图片，或画布上选中的图片地址）。不要只凭文字描述重画一张。
- 提示词只写要变的部分，并明确其余不变。例如："把背景换成黄昏的海边；人物的脸、发型、衣服和姿势保持不变"。
- 一次只改一两处。要改的地方多，就分几步做，每一步都以上一步的结果为参考。
- 比例和原图保持一致（aspectRatio 选最接近原图的那个），除非用户要改比例。
- 人像：不改变五官和身份特征，除非用户明确要求。

## 什么时候推荐别的做法

- 只改画面里的某一块（去掉路人、换一件衣服、改一个招牌）：告诉用户在「生图」页打开这张图，用「局部重绘」涂出区域再描述，比整张重画更稳。
- 想把画面往外延伸、或者改成别的比例：告诉用户用「扩图」。

## 出图后

和原图对比。改动以外的地方变了很多（脸变了、构图变了），如实告诉用户，并建议换一个模型或改用局部重绘。
$skill$
),
(
  '社媒封面',
  'xy-social-cover',
  '做小红书、抖音、视频号、B 站、公众号等平台的封面和配图时使用：按平台选比例，标题大、字少，缩小后也能一眼看清。',
  'GGUU AI', '1.0', 'design', 'smartphone', 'community', true,
  '{"market": "curated", "tags": ["小红书", "抖音", "视频号", "B站", "公众号", "封面", "社媒"]}'::jsonb,
  $skill$---
name: xy-social-cover
description: 做小红书、抖音、视频号、B 站、公众号等平台的封面和配图时使用：按平台选比例，标题大、字少，缩小后也能一眼看清。
---

# 社媒封面

## 按平台选比例

| 平台 | aspectRatio |
| --- | --- |
| 小红书笔记首图 | 3:4 |
| 抖音、视频号、快手竖屏 | 9:16 |
| B 站、西瓜视频横版封面 | 16:9 |
| 公众号头图（约 2.35:1） | 选模型支持的最宽比例（如 21:9 或 16:9），重要内容放中间，留给用户裁切 |
| 公众号次图、微博配图 | 1:1 |

封面 2K 足够。

## 封面要点

- 想象它缩到指甲盖大小：主体占画面一半以上，背景简单，颜色对比强。
- 标题 12 个字以内，字要大。完整的标题文字和用户确认后再出图。
- 重要内容放在中间。底部和右下角常被平台的标题栏、时长、按钮挡住，不要放关键信息。
- 一个系列（同一个账号的多期封面）用固定的版式和配色，只换主体和标题。

## 文字

短标题可以让模型直接画（文字放进引号，写清字体和位置）。长标题、必须一字不差的内容，先出留白的底图，再用 manipulate_canvas 的 add_text 叠字。出图后检查错字。
$skill$
),
(
  '品牌一致性',
  'xy-brand-consistency',
  '为同一品牌或同一系列出多张图时使用：统一配色、字体气质和画风，让一组图看起来出自同一个设计师。',
  'GGUU AI', '1.0', 'design', 'swatch-book', 'community', false,
  '{"market": "curated", "tags": ["品牌", "VI", "配色", "系列", "统一风格", "logo"]}'::jsonb,
  $skill$---
name: xy-brand-consistency
description: 为同一品牌或同一系列出多张图时使用：统一配色、字体气质和画风，让一组图看起来出自同一个设计师。
---

# 品牌一致性

1. 先调用 get_brand_kit。项目没有绑定品牌套件时，请用户提供品牌色（色值）、logo 和一两张满意的参考图。
2. 写一段"风格块"，这一组图的每个提示词都原样带上。风格块包括：
   - 配色：写色值和大致占比，例如"主色 #FF6B4A 约 20%，大面积米白 #FAF6F0，点缀深灰"；
   - 光线和质感；
   - 构图习惯（留白多少、主体位置）；
   - 字体气质（如"圆润无衬线"）。
3. 第一张满意后，把它作为后面几张的 inputImages 参考，画风更稳。
4. 不要让模型生成或重画 logo：在画面里留出位置，用户上传真实 logo 后放到画布上。
5. 一组图用同一个比例，在画布上排成一行（manipulate_canvas 的 align、distribute），方便整体对比。哪一张偏了，就以最满意的那张为参考重出。
$skill$
),
(
  '系列图与角色一致',
  'xy-character-series',
  '需要同一角色、同一产品或同一场景出现在多张图里时使用（绘本、分镜、表情包、系列海报）：先定设定图，再逐张参考生成。',
  'GGUU AI', '1.0', 'generation', 'film', 'community', false,
  '{"market": "curated", "tags": ["角色", "分镜", "绘本", "表情包", "系列", "一致性"]}'::jsonb,
  $skill$---
name: xy-character-series
description: 需要同一角色、同一产品或同一场景出现在多张图里时使用（绘本、分镜、表情包、系列海报）：先定设定图，再逐张参考生成。
---

# 系列图与角色一致

1. 先出一张设定图：角色正面全身，纯色背景，写清外貌要点（发型发色、服装、配饰、体型、主色）。用户确认后再继续。用户已经有角色图时，直接用它当设定图。
2. 之后每一张都把设定图放进 generate_image 的 inputImages，提示词开头原样重复同一段角色描述，再写这一张的动作、表情和场景。
3. 分镜、绘本：先用文字列出每一格（编号、景别、动作、台词），和用户确认后再出图。一张一张出，每张出完看一眼有没有走样。
4. 在画布上按顺序排成一行或网格：用 placementX、placementY 指定位置，title 写成"分镜 01 …"这样的编号。
5. 走样了（脸变了、衣服颜色变了）：用最满意的一张替换设定图作为新参考，重出走样的那张。
$skill$
),
(
  '标志草案',
  'xy-logo-draft',
  '设计 logo、图标、徽章、吉祥物初稿时使用：出简洁的图形方案供挑选，并说明 AI 草案正式使用前还要矢量化。',
  'GGUU AI', '1.0', 'design', 'shapes', 'community', false,
  '{"market": "curated", "tags": ["logo", "标志", "图标", "徽章", "吉祥物"]}'::jsonb,
  $skill$---
name: xy-logo-draft
description: 设计 logo、图标、徽章、吉祥物初稿时使用：出简洁的图形方案供挑选，并说明 AI 草案正式使用前还要矢量化。
---

# 标志草案

- 先问清：品牌名、行业、想传达的感觉、偏好颜色、主要用在哪里（App 图标、门头、印章、包装）。
- 提示词写："扁平矢量风格标志，简单几何图形，2 到 3 种纯色，纯白背景，居中，没有阴影、渐变和写实细节"。比例 1:1，2K。
- 文字标志：模型写字不稳定。先出图形部分，品牌名用 manipulate_canvas 的 add_text 在画布上配字演示；告诉用户正式字体需要设计师定稿。
- 一次一个方向。用户想比较时，每个方向出一张，并排放在画布上，title 写"方向 A：…"。
- 交付时说明：AI 出的是位图草案，正式使用前要矢量化（重绘成 SVG 或 AI 文件），并做商标检索。
$skill$
),
(
  '营销文案',
  'xy-marketing-copy',
  '为海报、主图、封面、广告写中文标题、口号和卖点时使用：给几个风格不同的短文案供挑选，避开广告法禁用词。',
  'GGUU AI', '1.0', 'writing', 'pen-line', 'community', false,
  '{"market": "curated", "tags": ["文案", "标题", "口号", "卖点", "广告"]}'::jsonb,
  $skill$---
name: xy-marketing-copy
description: 为海报、主图、封面、广告写中文标题、口号和卖点时使用：给几个风格不同的短文案供挑选，避开广告法禁用词。
---

# 营销文案

- 先确认：卖什么、给谁看、在哪里发、想让人做什么（购买、报名、关注）。
- 每次给 3 个方向，例如直接利益、情绪共鸣、反差悬念。每个方向一条主标题加一条副标题。
- 字数：海报主标题不超过 10 个字，副标题不超过 20 个字；封面标题不超过 12 个字；按钮 2 到 4 个字。
- 避开《广告法》禁止的绝对化用语：最、第一、顶级、极致、国家级、100% 等。
- 不编造数据、奖项和认证。用户没给的数字用「[待填]」占位。
- 用户选定后，按海报或封面的做法把文案放进画面，或用 manipulate_canvas 的 add_text 放到画布上。
$skill$
),
(
  '画布整理',
  'xy-canvas-arrange',
  '用户想整理画布、把图片排整齐、做方案对比板或情绪板时使用：先看清画布，再批量移动、对齐、加标注。',
  'GGUU AI', '1.0', 'design', 'layout-grid', 'community', false,
  '{"market": "curated", "tags": ["画布", "整理", "对齐", "对比", "情绪板"]}'::jsonb,
  $skill$---
name: xy-canvas-arrange
description: 用户想整理画布、把图片排整齐、做方案对比板或情绪板时使用：先看清画布，再批量移动、对齐、加标注。
---

# 画布整理

1. 先调用 inspect_canvas，看清所有元素的位置和尺寸。需要看实际效果时再用 screenshot_canvas。
2. 用 manipulate_canvas 一次提交多个操作：move、resize 统一尺寸，align 对齐，distribute 等距分布。
3. 方案对比板：同一需求的几个方案排成一行，每张下方用 add_text 写方案名。
4. 情绪板：参考图排成网格，间距一致（例如 24），左上角用 add_text 加一个标题。
5. 不删除用户的元素。确实需要删时，先说明要删哪些，用户同意后再删。
6. 整理完再截一次图确认，用一两句话告诉用户改了什么。
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

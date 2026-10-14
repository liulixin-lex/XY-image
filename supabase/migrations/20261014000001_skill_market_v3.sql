-- 技能市场第三版 (第 64 条, agent01).
--
-- 1. Ten new curated skills for the jobs the first two rounds did not
--    cover: 看图反推提示词, 二次元, 漫画与分镜, 影视, 梗图, 超现实, 3D 潮玩,
--    艺术风格, 商业设计排版, 技术图解. Written from OpenAI's GPT Image
--    prompting guide (2026-04), Google's Nano Banana prompting guide
--    (2026-03) and the category atlas and craft notes of
--    wuyoscar/GPT-Image2-Skill (MIT; its get-prompt-from-image skill is the
--    model for 看图反推提示词). SKILL.md follows the Agent Skills format.
-- 2. metadata for the 技能 page: tags, examples (things to say to the
--    assistant), templates (生图模板 ids in apps/web/src/lib/templates.ts,
--    including the ones added in 第 64 条), sources (shown in the skill's
--    detail) and added (the date the 市场 shows 新上架 from).
-- 3. Every curated skill gets the sources list; the earlier ones get
--    links to the new templates where they fit.
--
-- Re-runnable: the insert upserts only rows that are already curated, the
-- updates only touch curated rows they name.

-- 1, 2 ──────────────────────────────────────────────────────────────────
INSERT INTO public.skills
  (name, slug, description, author, version, category, icon_name, source, is_featured, metadata, skill_content)
VALUES
(
  '看图反推提示词',
  'xy-prompt-from-image',
  '用户给一张图、想要「同款」或想知道怎么写时使用：按用途、场景、主体、细节、镜头、风格、限制拆开写成提示词，再给一个可替换的模板版。',
  'GGUU AI', '1.0', 'generation', 'scan-eye', 'community', true,
  '{"market": "curated", "added": "2026-10-14",
    "tags": ["反推", "同款", "提示词", "参考图", "拆解"],
    "examples": ["这张图是怎么写出来的？帮我反推提示词", "照着这张海报的感觉，换成我的产品"],
    "templates": ["film-still", "surreal-dream", "photo-fashion"],
    "sources": [
      {"name": "wuyoscar/GPT-Image2-Skill · get-prompt-from-image", "url": "https://github.com/wuyoscar/GPT-Image2-Skill"},
      {"name": "OpenAI GPT Image 提示词指南", "url": "https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide"}
    ]}'::jsonb,
  $skill$---
name: xy-prompt-from-image
description: 用户给一张图、想要「同款」或想知道怎么写时使用：按用途、场景、主体、细节、镜头、风格、限制拆开写成提示词，再给一个可替换的模板版。
metadata:
  author: GGUU AI
  version: "1.0"
---

# 看图反推提示词

## 先看清楚这张图

按顺序记下来，看不出的就不写，不要编：

1. **它是什么**：照片、电影剧照、海报、插画、3D 渲染、截图；横竖和大致比例。
2. **场景与光线**：地点、时间、天气；主光从哪来、硬还是软、色温冷暖。
3. **主体**：人物（年龄感、发型、服装、动作、表情、朝向）、物体或动物。
4. **细节与材质**：布料、金属、石材、皮肤、水、烟雾、灯光这类能看见的质感。
5. **镜头与介质**：景别、机位高低、焦距感（广角、长焦、微距）、景深；胶片颗粒、绘画笔触、像素格。
6. **配色与风格**：两三个主色；风格用可描述的特征写（「粗描边、网点阴影」），不要写在世画家或摄影师的名字。
7. **画面里的字**：有就逐字照抄放进引号，写清位置和字体；没有就写「画面中没有文字」。

## 写成两版

- **复刻版**：一段完整的中文描述，顺序是「用途与画幅 → 场景与光线 → 主体 → 细节材质 → 镜头与介质 → 限制」，用完整的句子，不堆关键词。
- **模板版**：把复刻版里用户最可能想换的部分写成 {主体}、{场景}、{配色} 这样的空，告诉用户可以存到生图页「模板 → 我的 → 新建模板」反复用。

## 注意

- 不辨认、不点名照片里的真实人物；要保持某个人的样子，让用户把照片作为参考图。
- 有品牌标志、商标的图，复刻时换成用户自己的品牌或去掉。
- 反推结果是起点，不保证一模一样：先出一张，再按差别逐项调整（一次只改一处）。
$skill$
),
(
  '二次元与动漫',
  'xy-anime-art',
  '画动漫角色、动画场景、Q 版、头像或把照片转成动漫风格时使用：先定角色锚点和画风，系列图保持同一个角色不走样。',
  'GGUU AI', '1.0', 'design', 'sparkles', 'community', true,
  '{"market": "curated", "added": "2026-10-14",
    "tags": ["二次元", "动漫", "立绘", "Q版", "头像", "动画场景"],
    "examples": ["画一个银发蓝眼的魔法少女立绘", "把这张自拍画成日系动画风格", "做一个 Q 版的我，抱着猫"],
    "templates": ["anime-character", "anime-scene", "anime-chibi", "anime-avatar", "anime-from-photo"],
    "sources": [
      {"name": "wuyoscar/GPT-Image2-Skill · anime-and-manga / character-design", "url": "https://github.com/wuyoscar/GPT-Image2-Skill"},
      {"name": "Google Nano Banana 提示词指南", "url": "https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana"}
    ]}'::jsonb,
  $skill$---
name: xy-anime-art
description: 画动漫角色、动画场景、Q 版、头像或把照片转成动漫风格时使用：先定角色锚点和画风，系列图保持同一个角色不走样。
metadata:
  author: GGUU AI
  version: "1.0"
---

# 二次元与动漫

## 先定角色锚点

每个角色写一段固定描述，之后每张图原样带上：发型与发色、眼睛颜色、脸型和年龄感、标志性服装、一两件配饰、主色。原创角色就好，不画已有作品里的角色，用户点名时改成「同样气质的原创角色」。

## 画风写具体

不要只写「动漫风」。选一种并写出特征：

- **赛璐璐上色**：清晰的阴影分界、干净线条、饱和平涂。
- **厚涂**：笔触可见、光影柔和过渡、偏插画。
- **水彩柔和**：边缘晕染、低饱和、纸张纹理。
- **90 年代复古动画**：略粗线条、胶片颗粒、偏暖的旧色调。

## 常用写法

- 立绘：`二次元角色立绘，全身，纯白背景，角色完整不被裁切` + 角色锚点 + 姿势表情 + 画风。
- 动画场景：写地点、时间天气、云和光（丁达尔光、积雨云、夕阳），人物小、景是主角，宽画幅。
- Q 版：`二头身、大头小身、圆润轮廓`，四周留白，适合做贴纸。
- 照片转动漫：用户的照片作参考图，写「姿势、表情、衣着、构图保持不变，只改画法」。

## 系列与一致性

先出一张满意的立绘或三视图，之后每张都把它作为参考图，并在提示词里重复角色锚点；需要多个姿势时，用「4×4 网格，每格编号，同一角色、比例一致、不裁切四肢」。

## 出图后

检查手指、瞳孔高光、配饰是否在每张里一致；有偏差就只改那一处再出。
$skill$
),
(
  '漫画与分镜',
  'xy-comic-storyboard',
  '做四格漫画、漫画分镜页、美漫封面或拍片用的分镜表时使用：一格一个情节，写清格数、阅读顺序、景别和对白规则。',
  'GGUU AI', '1.0', 'design', 'layout-grid', 'community', false,
  '{"market": "curated", "added": "2026-10-14",
    "tags": ["漫画", "四格", "分镜", "条漫", "美漫", "故事板"],
    "examples": ["画一个打工人周一的四格漫画", "把这段剧情画成 6 格分镜", "做一张超级英雄漫画封面，刊名 RED NOVA"],
    "templates": ["comic-4koma", "comic-page", "comic-cover", "film-storyboard"],
    "sources": [
      {"name": "OpenAI GPT Image 提示词指南 · Comics", "url": "https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide"},
      {"name": "wuyoscar/GPT-Image2-Skill · cinematic-and-animation", "url": "https://github.com/wuyoscar/GPT-Image2-Skill"}
    ]}'::jsonb,
  $skill$---
name: xy-comic-storyboard
description: 做四格漫画、漫画分镜页、美漫封面或拍片用的分镜表时使用：一格一个情节，写清格数、阅读顺序、景别和对白规则。
metadata:
  author: GGUU AI
  version: "1.0"
---

# 漫画与分镜

## 先写结构，再写内容

提示词第一句就定格子：`一页竖排四格漫画，四格从上到下，大小一致，格间留白`，或 `分镜表：3 列 × 2 行，从左到右、从上到下，每格左上角标 1–6`。结构不先说，模型会自己乱排。

## 一格一个情节

- 按编号逐格写，每格只写一个动作或表情，写具体的动作（「把小鱼干藏到身后」），不写抽象情绪。
- 四格按起、承、转、合：交代 → 推进 → 意外 → 结果。
- 分镜页要有景别变化：远景交代环境，中景交代关系，特写表现情绪。
- 主角写一段固定描述，每格都一样。

## 对白

- 默认不画对话气泡，图更干净，字可以后加在画布上。
- 一定要字时：每格最多一个气泡、一句短话，原文放引号里，写「中文字形准确」。出图后逐字检查。

## 风格

黑白网点日漫、彩色条漫、美漫粗线条网点、铅笔素描分镜，选一种写清特征。美漫封面加「强烈透视、放射速度线」，刊名单独放引号里。

## 出图后

数格子数、编号顺序，看角色是否每格一致，再看有没有多出来的文字。
$skill$
),
(
  '影视剧照与海报',
  'xy-film-still',
  '要电影感的画面、电影或电视剧海报、角色定妆照时使用：用类型、布光、镜头、胶片和调色写出电影感，海报只放片名和一句宣传语。',
  'GGUU AI', '1.0', 'generation', 'clapperboard', 'community', true,
  '{"market": "curated", "added": "2026-10-14",
    "tags": ["电影", "剧照", "电影海报", "电视剧", "定妆照", "电影感"],
    "examples": ["来一张悬疑片的剧照：深夜火车站的女人", "做一张古装剧海报，剧名「山河长明」", "这张图改成电影感的调色"],
    "templates": ["film-still", "film-poster", "film-tv-poster", "film-costume", "film-storyboard"],
    "sources": [
      {"name": "Google Nano Banana 提示词指南 · 相机与光线", "url": "https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana"},
      {"name": "wuyoscar/GPT-Image2-Skill · cinematic-film-references", "url": "https://github.com/wuyoscar/GPT-Image2-Skill"}
    ]}'::jsonb,
  $skill$---
name: xy-film-still
description: 要电影感的画面、电影或电视剧海报、角色定妆照时使用：用类型、布光、镜头、胶片和调色写出电影感，海报只放片名和一句宣传语。
metadata:
  author: GGUU AI
  version: "1.0"
---

# 影视剧照与海报

## 剧照：电影感来自这五样

1. **类型**：悬疑、科幻、文艺、武侠、西部……类型决定光和色。
2. **布光**：说清主光方向和软硬，如「顶部一盏冷白灯管、四周大面积暗部」「黄昏逆光」。
3. **镜头**：景别和焦距，如「35mm 中景」「85mm 特写」「广角低机位仰拍」「宽银幕 21:9」。
4. **介质与调色**：「35mm 胶片颗粒」「变形宽银幕镜头光晕」「冷青色低饱和」「暖橙与青色对比」。
5. **真实细节**：服装道具的材质、皮肤纹理、空气里的雾和尘。

写完一句「画面中没有字幕、片名和水印」。不写「电影级、震撼、大片感」这类空词。

## 海报

- 主视觉先写，再写文字：片名放引号里，写字体气质、大小和位置；宣传语最多一句。
- 不要演职员表、评分、日期这类小字，模型容易写错；需要时出图后在画布上加。
- 电视剧群像：主角最大居中，配角按主次排列，服化道统一到题材。

## 定妆照

全身站姿、正面略侧，影棚灰背景或实景，写清服装面料、纹样、配饰和道具。

## 注意

不模仿或点名真实演员的样貌；用户提到明星时，改成「气质相近的原创角色」。
$skill$
),
(
  '梗图与表情包',
  'xy-meme',
  '做网络梗图、对比图、聊天反应图、萌宠拟人时使用：一眼能懂的画面加一两行短字，字放引号里、白字黑边，不拿真人开涮。',
  'GGUU AI', '1.0', 'design', 'laugh', 'community', false,
  '{"market": "curated", "added": "2026-10-14",
    "tags": ["梗图", "表情包", "对比图", "反应图", "萌宠", "搞笑"],
    "examples": ["做一张周一上班的梗图：柴犬生无可恋", "理想与现实对比图：健身", "一只穿西装开会的猫"],
    "templates": ["meme-classic", "meme-compare", "meme-reaction", "meme-pet", "illus-sticker"],
    "sources": [
      {"name": "OpenAI GPT Image 提示词指南 · 文字渲染", "url": "https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide"}
    ]}'::jsonb,
  $skill$---
name: xy-meme
description: 做网络梗图、对比图、聊天反应图、萌宠拟人时使用：一眼能懂的画面加一两行短字，字放引号里、白字黑边，不拿真人开涮。
metadata:
  author: GGUU AI
  version: "1.0"
---

# 梗图与表情包

## 四种常用格式

- **上下文字**：一张图，上方一句铺垫、下方一句包袱，白色粗体加黑色描边、居中。
- **对比图**：左右两格，顶部各一个短标签（「理想 / 现实」「买家秀 / 卖家秀」），两格主体一一对应，反差越大越好笑。
- **反应图**：一个夸张表情的近景，可配一句话，聊天里直接发。
- **萌宠拟人**：动物保持真实身体结构，只是动作和道具像人，神情越认真越好笑。

## 写法

- 先写画面再写字。画面要一眼看懂情绪：表情夸张、构图简单、背景不抢戏。
- 每段字都放进引号，写清位置、颜色、描边，并写「字形准确，只出现一次，除这些字外不要其他文字」。
- 字越短越好，一行不超过 12 个字；长句拆成上下两行。
- 方形 1:1 适合聊天和朋友圈，对比图用 16:9。

## 分寸

- 不用真实人物的脸做梗，不嘲笑具体的人、地区、群体或弱势身份。
- 不碰政治人物、灾难事故和他人隐私。用户坚持时，换成动物或原创角色。

## 出图后

逐字检查文字；文字压住主体的脸就让它挪位置。
$skill$
),
(
  '超现实与概念设计',
  'xy-surreal-concept',
  '要梦境感、微缩世界、双重曝光、巨物尺度或电影概念设计时使用：一个不合常理的点子，加上可信的光影、倒影和尺度参照。',
  'GGUU AI', '1.0', 'generation', 'moon-star', 'community', false,
  '{"market": "curated", "added": "2026-10-14",
    "tags": ["超现实", "梦境", "微缩", "双重曝光", "概念设计", "科幻"],
    "examples": ["一条鲸鱼游过麦田上空", "咖啡杯里有一座下雪的小镇", "女孩侧脸的剪影里是一片松林"],
    "templates": ["surreal-dream", "surreal-miniature", "surreal-double-exposure", "surreal-giant", "game-scene"],
    "sources": [
      {"name": "Google Nano Banana 提示词指南", "url": "https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana"},
      {"name": "wuyoscar/GPT-Image2-Skill · craft（场景密度胜过形容词）", "url": "https://github.com/wuyoscar/GPT-Image2-Skill"}
    ]}'::jsonb,
  $skill$---
name: xy-surreal-concept
description: 要梦境感、微缩世界、双重曝光、巨物尺度或电影概念设计时使用：一个不合常理的点子，加上可信的光影、倒影和尺度参照。
metadata:
  author: GGUU AI
  version: "1.0"
---

# 超现实与概念设计

## 一个点子，其余都真实

超现实好不好看，在于「不可能的事被拍得像真的」。只放一个不合常理的点子，其他都按真实世界写：

- **光**：点子里的东西和环境同一个光源、同一个方向，有投影和接触阴影。
- **倒影与空气**：水面倒影、雾、尘埃让它融进场景。
- **尺度参照**：放一个人、一辆车、一棵树，大小才看得出来。

## 常用结构

- **梦境**：日常场景 + 一个错位的东西（鲸鱼在麦田上空、门里是另一个季节）。
- **微缩世界**：容器里的小世界，移轴镜头、中间清晰上下虚化，像精致手工模型。
- **双重曝光**：剪影轮廓里叠风景，边缘自然过渡，纯色底。
- **巨物**：广角低机位，用人群和建筑衬尺度。
- **概念设计**：前景、中景、远景分明，有一个小角色衬尺度，光线有引导。

## 写法

场景密度胜过形容词：多写「看得见的东西」（雾里的电线、湿石板上的反光），少写「梦幻、震撼、史诗」。写完加「画面中没有文字」。

## 出图后

看光影方向是否统一、接触阴影在不在、尺度参照是否清楚，不对就只改那一项。
$skill$
),
(
  '3D 潮玩与等距场景',
  'xy-3d-toy',
  '做盲盒手办、黏土风、等距小场景或 3D 图标时使用：写清材质、比例、棚拍布光和背景，包装上不写字。',
  'GGUU AI', '1.0', 'design', 'box', 'community', false,
  '{"market": "curated", "added": "2026-10-14",
    "tags": ["3D", "手办", "盲盒", "黏土", "等距", "图标"],
    "examples": ["把我的小猫做成盲盒手办", "等距视角的复古咖啡馆", "做一组 3D 磨砂玻璃图标"],
    "templates": ["render-toy", "render-clay", "render-isometric", "render-icon3d", "illus-icons"],
    "sources": [
      {"name": "wuyoscar/GPT-Image2-Skill · isometric / product-and-food", "url": "https://github.com/wuyoscar/GPT-Image2-Skill"}
    ]}'::jsonb,
  $skill$---
name: xy-3d-toy
description: 做盲盒手办、黏土风、等距小场景或 3D 图标时使用：写清材质、比例、棚拍布光和背景，包装上不写字。
metadata:
  author: GGUU AI
  version: "1.0"
---

# 3D 潮玩与等距场景

## 材质是关键

材质和光线分开写，不要只写「3D」：

- **手办**：哑光 PVC、半透明树脂、陶瓷釉面、毛绒；表面有涂装细节和柔和高光。
- **黏土**：能看到指纹和捏痕，边缘圆润，色彩柔和。
- **图标**：磨砂玻璃、光滑塑料、金属、软胶；圆角造型，轻微俯视。

## 布光与背景

影棚三点布光（主光、补光、轮廓光），纯色柔和背景，底部有柔和投影。产品图写「居中、四周留白」。

## 等距场景

`等距视角（45°）的小场景，像一块漂浮的立方体切片，前面两面墙打开，能看到内部`，再列出里面的东西（吧台、书架、绿植、楼梯），场景越具体越好看。

## 角色变手办

用户给照片或角色图时作为参考图，写「保留发型、配色和服装特征，做成大头身的潮玩手办」。

## 注意

包装盒、底座上只放图案，不写文字和品牌；需要品牌名时，出图后在画布上加。
$skill$
),
(
  '艺术风格与国风',
  'xy-art-style',
  '要国风水墨、工笔、油画、水彩、像素画、版画等艺术风格时使用：用媒介、技法、年代写风格，不写在世艺术家的名字。',
  'GGUU AI', '1.0', 'generation', 'palette', 'community', false,
  '{"market": "curated", "added": "2026-10-14",
    "tags": ["国风", "水墨", "工笔", "油画", "水彩", "像素画", "艺术风格"],
    "examples": ["画一幅「孤舟蓑笠翁，独钓寒江雪」的水墨画", "把这张照片变成印象派油画", "做一张 16 位像素风的城市夜景"],
    "templates": ["art-ink", "art-oil", "art-watercolor", "art-pixel", "edit-style"],
    "sources": [
      {"name": "wuyoscar/GPT-Image2-Skill · ink-and-chinese / fine-art-painting / watercolor / pixel-art", "url": "https://github.com/wuyoscar/GPT-Image2-Skill"},
      {"name": "Google Nano Banana 提示词指南 · 风格", "url": "https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana"}
    ]}'::jsonb,
  $skill$---
name: xy-art-style
description: 要国风水墨、工笔、油画、水彩、像素画、版画等艺术风格时使用：用媒介、技法、年代写风格，不写在世艺术家的名字。
metadata:
  author: GGUU AI
  version: "1.0"
---

# 艺术风格与国风

## 风格要「有边界」

只写「中国风」「艺术感」太空。写成 **媒介 + 技法 + 特征**：

- **写意水墨**：宣纸、墨分五色、浓淡干湿、大面积留白，可以有一方红色印章。
- **工笔重彩**：细线勾勒、层层设色、矿物颜料的厚重色彩。
- **青绿山水**：石青石绿为主、金线勾边、层峦叠嶂。
- **印象派油画**：可见笔触、明亮的外光、色彩并置。
- **水彩**：晕染、水渍边缘、留白透出纸色、冷压纸纹理。
- **像素画**：8 位或 16 位、像素格锐利无抗锯齿、有限调色板。

## 写法

先写画面内容，再写风格段；风格段放在最后一两句。照片转风格时，写「内容和构图保持不变，只改变画法」。

## 注意

- 不写在世艺术家或插画师的名字，把他们的特征翻译成上面的描述。
- 国画默认不写诗文和落款：模型写的书法常常错字；需要题字时让用户出图后在画布上加。
- 像素画里不要可读文字。
$skill$
),
(
  '商业设计排版',
  'xy-commercial-layout',
  '做 PPT 封面、菜单、邀请函、网站横幅、App 界面这类带字的商业设计时使用：先定版式区域，再逐字给出文案，字小就用高质量。',
  'GGUU AI', '1.0', 'design', 'presentation', 'community', true,
  '{"market": "curated", "added": "2026-10-14",
    "tags": ["PPT", "菜单", "邀请函", "横幅", "界面", "排版", "商业设计"],
    "examples": ["做一张年度计划的 PPT 封面", "咖啡店菜单：美式 22、拿铁 28", "婚礼邀请函，花卉水彩风"],
    "templates": ["design-slide", "design-menu", "design-invitation", "design-banner", "design-ui", "info-card"],
    "sources": [
      {"name": "OpenAI GPT Image 提示词指南 · 文字、幻灯片、界面", "url": "https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide"},
      {"name": "wuyoscar/GPT-Image2-Skill · typography-and-posters / ui-ux-mockups", "url": "https://github.com/wuyoscar/GPT-Image2-Skill"}
    ]}'::jsonb,
  $skill$---
name: xy-commercial-layout
description: 做 PPT 封面、菜单、邀请函、网站横幅、App 界面这类带字的商业设计时使用：先定版式区域，再逐字给出文案，字小就用高质量。
metadata:
  author: GGUU AI
  version: "1.0"
---

# 商业设计排版

## 先定画布和区域

第一句写画幅和版式：`16:9 演示文稿封面，左侧放文字，右侧是主视觉`、`竖版菜单，顶部店名，下面逐行列出菜品，名称左对齐、价格右对齐`。结构写在主体之前，模型才不会把字挤到角落。

## 文案逐字给出

- 每段文字都放进引号，段之间用「/」分隔，写清字号层级、颜色和位置。
- 写「字形准确，每段只出现一次，除这些文字外不要其他文字」。
- 用户给的中文原样照抄，不改写、不翻译。
- 价格、日期、电话这类必须准确的，出图后逐字核对；条目很多时建议用画布文字。

## 风格与层级

主标题最大，副标题小一级，正文再小；留白充足，配色不超过三种。界面图按「已经上线的产品截图」来写：布局、层级、间距、图标风格统一，不写「概念设计」。

## 参数

小字多（菜单、界面、图表）用高质量；PPT 用 16:9，菜单和邀请函用 3:4，横幅用 21:9。

## 出图后

逐字检查，看对齐和留白；有错字时先换写字更准的模型（GPT Image 2、Nano Banana Pro）重出，或改用画布文字。
$skill$
),
(
  '技术图解与爆炸图',
  'xy-tech-illustration',
  '画产品爆炸图、剖面图、结构说明、带标注的示意图时使用：写清视图、部件和编号标注，标签逐字给出，用横版和高质量。',
  'GGUU AI', '1.0', 'design', 'cog', 'community', false,
  '{"market": "curated", "added": "2026-10-14",
    "tags": ["爆炸图", "剖面", "结构图", "示意图", "标注", "教学"],
    "examples": ["画一张机械手表的爆炸图，标出 6 个部件", "咖啡机内部结构的剖面图", "做一张植物细胞结构的教学挂图"],
    "templates": ["info-process", "info-card", "render-isometric"],
    "sources": [
      {"name": "wuyoscar/GPT-Image2-Skill · technical-illustration / scientific-and-educational", "url": "https://github.com/wuyoscar/GPT-Image2-Skill"},
      {"name": "OpenAI GPT Image 提示词指南 · 信息图与图表", "url": "https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide"}
    ]}'::jsonb,
  $skill$---
name: xy-tech-illustration
description: 画产品爆炸图、剖面图、结构说明、带标注的示意图时使用：写清视图、部件和编号标注，标签逐字给出，用横版和高质量。
metadata:
  author: GGUU AI
  version: "1.0"
---

# 技术图解与爆炸图

## 用图解的语法写

- **类型和视图**：`爆炸图：部件沿中轴线分开，按装配顺序排列`、`剖面图：从正面切开一半，露出内部`、`教学挂图：上方标题，左侧主图，右侧图例`。
- **部件清单**：按顺序列出每个部件和材质（不锈钢表壳、蓝宝石镜面、黄铜齿轮）。
- **标注方式**：`每个部件有编号 1–6，细引线连到右侧的标签`；标签原文放引号里。
- **风格边界**：`干净的技术插画，深灰背景加细网格`或`白底，线条清晰，配色克制`，不写成海报或广告。

## 参数

横版 16:9 或 3:2；标签和小字多，用高质量。

## 字多的时候

超过 8 个标签、或要写参数和数值时，让模型只画编号，标签和数据用画布文字放上去，避免错字。

## 出图后

数一数部件和编号是否对应、引线有没有连错、标签有没有错字或重复。
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
-- Sources for the earlier curated skills, and links to the new templates.
UPDATE public.skills AS s
SET metadata = s.metadata || v.extra,
    updated_at = now()
FROM (VALUES
  ('xy-poster-design', '{"templates": ["poster-event", "poster-festival", "poster-type", "film-poster"]}'::jsonb),
  ('xy-photoreal', '{"templates": ["photo-portrait", "photo-headshot", "photo-fashion", "photo-street", "photo-landscape", "photo-pet"]}'::jsonb),
  ('xy-illustration-style', '{"templates": ["illus-picturebook", "art-watercolor", "art-oil", "art-ink"]}'::jsonb),
  ('xy-ui-mockup', '{"templates": ["design-ui", "design-banner"]}'::jsonb),
  ('xy-character-series', '{"templates": ["illus-character", "illus-picturebook", "anime-character"]}'::jsonb),
  ('xy-social-cover', '{"templates": ["social-xhs", "social-video", "social-header", "meme-classic"]}'::jsonb)
) AS v(slug, extra)
WHERE s.slug = v.slug
  AND s.source = 'community'
  AND s.metadata ->> 'market' = 'curated';

UPDATE public.skills
SET metadata = metadata || '{"sources": [
      {"name": "OpenAI GPT Image 提示词指南", "url": "https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide"},
      {"name": "Google Nano Banana 提示词指南", "url": "https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana"}
    ]}'::jsonb,
    updated_at = now()
WHERE source = 'community'
  AND metadata ->> 'market' = 'curated'
  AND NOT (metadata ? 'sources');

# 生图参数：各家对标（第 66 条）

2026-10-14，agent01。网站上的「比例 / 画质 / 质量」和「更多参数」，对应到 OpenAI、Google、xAI 各自接口里的哪个字段，每个模型能选什么。服务端以模型目录 `apps/server/src/features/xy2api/catalog.ts` 为准，前端只显示目录里该模型有的选项；请求里有模型不支持的值时，服务端会换成最接近的值，并在日志里写明换成了什么（`[billing-guard] … adjusted …`）。

## 质量

| 网站 | OpenAI `quality` | Google `thinkingLevel` | xAI `quality` |
| --- | --- | --- | --- |
| 自动 | 不发（默认 auto） | 不发（用模型默认） | 不发（默认 auto） |
| 低 | `low` | `minimal` | `low` |
| 中 | `medium` | `medium`（只有 Nano Banana 2.1） | `medium` |
| 高 | `high` | `high` | — |
| 极高 | `xhigh`（只有 GPT Image 2.5） | — | — |
| 最高 | `max`（只有 GPT Image 2.5） | — | — |

各模型实际提供的档位：

| 模型 | 质量 | 「自动」相当于 |
| --- | --- | --- |
| GPT Image 2.5 Sunburst / Flare | 自动、低、中、高、极高、最高 | 由模型决定 |
| GPT Image 2 | 自动、低、中、高 | 由模型决定 |
| Nano Banana 2.1 | 自动、低、中、高 | 中（Google 文档的默认） |
| Nano Banana 2（gemini-3.1-flash-image） | 自动、低、高 | 低（默认 minimal） |
| Nano Banana Pro | 不可调（Google：思考默认开、关不掉） | — |
| Grok Imagine 2.0 | 自动、低、中 | 生成时为低，改图时为中 |
| Grok Imagine、Grok Imagine 高质量 | 不可调（xAI 只给 2.0 文档写了 `quality`） | — |

- 选了模型没有的档位：用它有的、比所选低的最高一档；没有更低的，就用比所选高的最低一档；都没有就是「自动」。例：模板里的「最高」，在 GPT Image 2 上按「高」，在 Grok 2.0 上按「中」。这一版之前，这种情况一律按「自动」。
- 多模型一起生成时，请求里带的是用户选的档位，每个模型各自换成自己最接近的一档。
- 质量只影响速度和细节；主站各分组按张固定收费，不按质量计费。

## 更多参数（只有 OpenAI 模型有）

| 网站 | OpenAI 字段 | 取值 | 说明 |
| --- | --- | --- | --- |
| 格式 | `output_format` | 默认、PNG、JPEG、WebP | 「默认」是站点设置 `LOOMIC_IMAGE_OUTPUT_FORMAT`（正式站 JPEG） |
| 压缩 | `output_compression` | 默认、100、85、70、50 | 只对 JPEG、WebP 生效；「默认」是 `LOOMIC_IMAGE_OUTPUT_COMPRESSION`（正式站 90） |
| 背景 | `background` | 自动、不透明、透明 | 透明只开给 GPT Image 2.5（OpenAI 写明完整支持；GPT Image 2 还是预览，不开）。透明背景要 PNG 或 WebP，选了 JPEG 或「默认」时按 PNG 出图 |
| 审核 | `moderation` | 标准（auto）、宽松（low） | 只在生成时发送；改图接口没有这个字段 |

生图页把这几项放在「质量」下面的「更多参数」里，默认收起；收起时右边显示改过的项。格式、压缩、审核会记住，背景不记（透明背景如果带到下次，用户容易没注意到）。画布的生成节点在模型支持时多出「格式 / 压缩 / 背景 / 审核」几行。设计助手的 `generate_image` 也可以传 `outputFormat`、`background`（用于标志、贴纸、抠图）。

## 主站（xy2api 0.3.0）透传

- OpenAI 生图接口：`quality`、`background`、`output_format`、`output_compression`、`moderation` 原样转发，不校验取值（`backend/internal/service/openai_images.go`），所以 `xhigh`、`max` 也能过。计费只看返回图片的长边档位（1K / 2K / 4K），和质量、格式无关。
- Grok：发 JSON 时整个请求体原样转发，`quality` 能到 xAI；只有 multipart 改图会重建请求（本站改图用 JSON）。
- Gemini：`generationConfig` 原样转发；`imageSize` 决定计费档位，缺省按 2K 计。

## 这次没加的

| 参数 | 原因 |
| --- | --- |
| Gemini `imageSize: "512"`（Nano Banana 2 的 0.5K） | 主站识别不了 `512`，会按 2K 计费，用户多付钱。主站支持后再加 |
| Gemini 联网搜索（`google_search`，网页 / 图片搜索） | 结果页要按 Google 的要求展示搜索建议，界面还没有这块；单独做 |
| xAI 更多比例（2:1、1:2、19.5:9、20:9、5:2、auto） | 网站的比例列表是三家共用的，加了其他两家没有；需要时按模型单列 |
| OpenAI `input_fidelity` | 官方写明 GPT Image 2 不要传，2.5 也没写支持 |
| OpenAI `partial_images`、`stream` | 流式预览，本站按张排队，不走流式 |
| OpenAI `style`、`response_format` | DALL·E 的旧参数，GPT Image 不支持 |
| 一次多张 `n` | 本站每张是一个任务（独立计费、独立重试），数量在网站这边控制 |

## 依据

- OpenAI：[Create image](https://developers.openai.com/api/reference/cli/resources/images/methods/generate/index.md)、[Create image edit](https://developers.openai.com/api/reference/cli/resources/images/methods/edit/index.md)（2026-10 版，GPT Image 2.5 的 `xhigh` / `max`、透明背景、自定义尺寸）
- Google：[Gemini 图片生成](https://ai.google.dev/gemini-api/docs/image-generation)（各模型的 `image_size`、思考档位和默认值、联网搜索）
- xAI：[Image generation](https://docs.x.ai/developers/model-capabilities/images/generation)（`quality` 只有 `grok-imagine-image-2.0` 支持，取值 low / medium / auto）

# 设计助手：思考强度、联网搜索、审图、上下文与工具（第 67 条）

2026-10-14，agent01。设计助手（画布右侧的对话）这一轮加的能力，各自怎么工作、在哪里改、日志怎么看。

## 思考强度

对话框下方模型名右边的「思考强度」：自动、低、中、高、极高、最高。只列当前模型能用的档位（`packages/shared/src/chat-options.ts`，前端和服务端用同一份）。

| 模型（按名字判断） | 能选的档位 | 发给主站的字段 |
| --- | --- | --- |
| OpenAI：`gpt-*`、`o*`、`codex*` | 自动、低、中、高、极高、最高 | Responses API：`reasoning.effort`；Chat Completions：`reasoning_effort` |
| Claude | 自动、低、中、高、极高、最高 | `reasoning_effort`，主站转成 `output_config.effort`（极高多数模型按最高） |
| Gemini | 自动、低、中、高 | `reasoning_effort` |
| Grok | 自动、低、中、高；grok-4.6 / 4.7 多一个极高 | 同上，主站把不支持的极高降成高 |
| 自己添加的服务商 | 自动、低、中、高 | `reasoning_effort` |

- 「自动」什么都不发，由模型自己决定；gpt-6 系列在「自动」时也会要推理摘要（`reasoning.summary = "auto"`），思考过程显示在回复上方，长时间思考时连接也一直有数据。
- 记住的档位换到不支持它的模型上，按它有的、比所选低的最高一档发（例：最高在 Gemini 上按高），选择框显示的就是实际会用的那档。
- 主站分组可以设上限（xy2api `max_reasoning_effort`，默认超出就降档）。模型仍然拒绝（400/422，报错里提到 reasoning/effort）时，服务端降一档重试，直到不发；服务商回了说不清原因的 400 而当时带着档位，就去掉档位再试一次。一次对话里降过就一直用降过的。
- 代码：`agent/model-options.ts`（降档、联网兜底）、`agent/deep-agent.ts` `createStreamingChatModel`（字段格式）。LangChain 只给它认识的模型名（gpt-5*、o*）发 `reasoning`，所以这里用 `modelKwargs` 直接写字段。

## 联网搜索

对话框下方的地球按钮，默认开，只在支持的模型上出现：主站的 OpenAI 模型（Codex 账号）和 Grok 模型。用的是模型自带的搜索（Responses API 的 `web_search` 工具），由主站执行，本站不需要搜索服务的 Key。

- 开着时模型自己决定要不要搜；搜过的每一次在回复里显示一个「联网搜索」块（搜索的关键词、打开的网页），刷新后还在。
- 开着搜索的模型一律走 Responses API（xy2api 0.3.0 的 Codex 账号原生支持，并会在历史里有搜索记录时自动补上工具声明）。
- Gemini 不开：Google 的搜索结果要求按它的规定展示搜索建议，界面还没做。自己添加的服务商也不开。
- 主站拒绝（400/404/405/422，报错提到 web_search 或说不清原因）时，这次对话不再带搜索，模型退回原来的接口继续答。日志 `[agent-model] … refused a request with built-in web search`。
- 主站把搜索按次计费（分组的 `web_search_price_per_call`），所以只在模型觉得需要时才搜；用户关掉地球就不会搜。

## 提示词缓存

- 每段对话一个固定的 `prompt_cache_key`（对话线程 ID 的 SHA-256 前 32 位，加前缀 `xyimg-`，线程 ID 本身不出本站）。同一段对话的后续请求会落到已经缓存了前缀的机器上。
- 前缀稳定：系统提示词、技能列表、工具定义在一段对话里不变；画布摘要附在用户消息里，不在系统提示词里。
- 用量里的缓存命中写进每轮日志：`[agent-turn] … in_tokens=12000 cached=11264 out_tokens=300 reasoning=180`。`streamUsage` 打开了，Chat Completions 也会带用量。
- 自己添加的服务商不发 `prompt_cache_key`（有的服务商拒绝不认识的字段）。

## 审图：模型真的看图

以前 `screenshot_canvas` 只给模型一行带链接的 JSON（多数接口把工具结果里的图当文字），模型说「看了截图」其实是猜的。现在（`agent/vision.ts`）：

- `screenshot_canvas` 把页面截到的图留在这次运行里；新工具 `view_images` 按图片元素 ID 取画布上的图（生成结果、参考图），用用户自己的存储权限读。
- 这些图在下一次调用模型时作为一条用户消息紧跟在工具结果后面给模型看，同一次运行里每次调用都带；只带本次运行的、最新的 3 张，旧截图不会越积越多。对话记录里只存小的 JSON。
- 发给模型前压到最长边 1536 px 的 JPEG（4K PNG 每次调用要带约 10 MB base64，现在约 200 KB）；用户在对话里上传的参考图同样压缩后给模型看，工具（生图参考）仍用原图。
- 模型不收图（400，报错提到 image/vision）时，去掉图再调一次，这次运行之后都不带图。
- 截图要等页面把画布上所有图片画出来，图多、图大时以前 10 秒就超时；现在等 60 秒。日志 `[agent-tool] screenshot_canvas … from the page in Nms`、`[agent-vision] … → WxH … KB`。
- 提示词新增「审图」：重要的成品图生成后先看一眼，有问题说清楚并建议怎么改，是否重新生成由用户决定。

## 项目记忆（上下文读取）

`/memories/AGENTS.md`（`agent/project-memory.ts`）：同一个项目的所有对话共用、长期保存的记忆。每次运行开始读一次，附在系统提示词末尾（同一次运行里每次调用都相同，缓存不受影响）。助手在用户定下长期适用的东西时自己更新（品牌、受众、配色字体、风格偏好、纠正过的地方），不记一次性请求和任何密钥。超过 6000 字截断并提示助手整理。`/workspace/` 下的文案、分镜、方案同样按项目保存，其他对话也能读到。

## 工具调用

- **apply_patch**（`agent/tools/apply-patch.ts`）：Codex 的补丁格式，一次改多处、多个文件。上下文先精确匹配，再忽略行尾空格，再忽略首尾空白和全角/半角标点。所有改动先全部核对，有一处对不上就一个文件都不改，并指出是第几处。不支持删除和移动。`edit_file`、`write_file` 仍然可用。
- **读取类工具重试**（`agent/run-budget.ts`）：`inspect_canvas`、`project_search`、`get_brand_kit`、`view_images` 和文件读取遇到连接断开、超时，间隔 0.8 秒、2 秒再试两次；写入和生图不重试。画布读取遇到网络错误时抛出（以前会说「画布不存在」）。
- **单次运行上限**：一次运行最多调用模型 60 次，超过就停下并告诉用户「这一轮的步骤太多了，我先停在这里……」，已完成的改动保留。
- **上下文超长**：主站或服务商回「超出上下文长度」时，错误链里放一个 LangChain 的 `ContextOverflowError`，deepagents 的摘要中间件会压缩历史后重试，而不是让运行失败（`utils/context-overflow.ts`）。
- 提示词新增：互不依赖的读取同一轮并行调用；多步骤任务先 `write_todos`；文字资料放 `/workspace/` 并用 apply_patch 修改；需要最新外部信息时用联网搜索并写明来源。

中间件顺序（`agent/deep-agent.ts` `loomicAgentMiddleware`，排在前面的在外层）：deepagents 自带（待办、文件、子任务、摘要、补全工具调用）→ 拆开粘连的工具调用 → 工具错误回给模型 → 读取工具重试 → 运行上限 → 项目记忆 → 模型重试 → 思考强度 / 联网搜索 → 审图。

## 网络和重试

见 `docs/XY2API_OPERATIONS.md`「繁忙自动重试」：对话模型在没输出任何内容前被主站拒为繁忙或连接没建立，等 2、6、15 秒重发；已经开始输出后的流内错误不重发（`agent/tool-call-stream.ts` 标记 `afterOutput`）。

兼容：有的网关用 Chat Completions 上游拼出 Responses 流，`output_text` 没有 `annotations` 数组，LangChain 读到第二轮就报 `Cannot read properties of undefined (reading 'map')`。`agent/tool-call-stream.ts` 的 `normalizeResponsesEvent` 补上缺的数组（实验室 xy2api 0.2.5 复现过）。

## 实验室演练

`~/xy-lab/e2e/chat-options.sh`（`16-chat-options.mjs`）：选最高、联网默认开，发一条带 `[[mock:websearch]]` 的消息；关掉联网、选低再发一条；检查假上游收到的档位、`stream_options`、缓存 Key。实验室的 xy2api 是 0.2.5，会把 Responses 请求转成 Chat Completions 发给假上游，所以搜索块和 Responses 上的缓存 Key 只能在上游直接看到 `/v1/responses` 时检查（单元测试 `agent/model-options.test.ts` 覆盖了请求格式）。

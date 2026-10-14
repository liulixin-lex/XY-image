# 设计助手：思考强度、联网搜索、审图、上下文与工具（第 67、68 条）

2026-10-14，agent01。设计助手（画布右侧的对话）这两轮加的能力，各自怎么工作、在哪里改、日志怎么看。第 68 条按主站源码和真实调用重新核对了每家模型的思考强度，并让所有模型都能联网搜索。

## 思考强度

对话框下方模型名右边的「思考强度」：自动、低、中、高、极高、最高。只列当前模型能用的档位（`packages/shared/src/chat-options.ts`，前端和服务端用同一份）。

| 模型（按名字判断） | 能选的档位 | 发给主站的字段 | 核对结果（2026-10-14） |
| --- | --- | --- | --- |
| OpenAI：`gpt-*`、`o*`、`codex*` | 自动、低、中、高、极高、最高 | Responses API：`reasoning.effort`；Chat Completions：`reasoning_effort` | 生效：推理 token 随档位增加（gpt-6-sol 12→24，gpt-5.6-sol 10→19） |
| Claude | 自动、低、中、高、极高、最高 | `reasoning_effort`，主站转成 `output_config.effort`（极高多数模型按最高） | 主站的 Claude 分组目前只给 Claude Code 客户端用或没有可用账号，本站列不出 Claude 模型 |
| Gemini（主站） | 只有自动 | 不发 | 主站的 Chat Completions 经 Claude 消息格式转成 Gemini 请求，`convertClaudeGenerationConfig` 只保留最大长度、温度、top_p、停止词，档位被丢掉（实测高低输出一样）。原生 generateContent 的 `thinkingLevel` 才生效（实测低 109、高 375 个思考 token）。主站改好后把 `chat-options.ts` 里 Gemini 改回低/中/高即可（TODO 已写） |
| Grok | grok-4.6 / 4.7：自动、低、中、高、极高；grok-4.3 / 4.5、grok-3-mini、grok-4.20 推理版：自动、低、中、高；其余（composer、build、非推理版）：只有自动 | `reasoning_effort` / `reasoning.effort` | 与主站 `openai_gateway_grok.go` 一致：它只给这些模型转发档位，最高按高 |
| 主站上的其他模型 | 自动、低、中、高 | `reasoning_effort` | — |
| 自己添加的服务商 | 自动、低、中、高 | `reasoning_effort` | 服务商不认就自动去掉（见下） |

只有「自动」的模型，模型名右边显示一个不能点的「自动」，鼠标停留提示「这个模型的思考强度由主站决定，不能调」。

- 「自动」什么都不发，由模型自己决定；gpt-6 系列在「自动」时也会要推理摘要（`reasoning.summary = "auto"`），思考过程显示在回复上方，长时间思考时连接也一直有数据。
- 记住的档位换到不支持它的模型上，按它有的、比所选低的最高一档发（例：最高在 Gemini 上按高），选择框显示的就是实际会用的那档。
- 主站分组可以设上限（xy2api `max_reasoning_effort`，默认超出就降档）。模型仍然拒绝（400/422，报错里提到 reasoning/effort）时，服务端降一档重试，直到不发；服务商回了说不清原因的 400 而当时带着档位，就去掉档位再试一次。一次对话里降过就一直用降过的。
- 代码：`agent/model-options.ts`（降档、联网兜底）、`agent/deep-agent.ts` `createStreamingChatModel`（字段格式）。LangChain 只给它认识的模型名（gpt-5*、o*）发 `reasoning`，所以这里用 `modelKwargs` 直接写字段。

## 联网搜索

对话框下方的地球按钮，默认开，**所有模型都有**。鼠标停在地球上会说明这个模型怎么搜。开着时模型自己决定要不要搜，搜过的每一次在回复里显示一个「联网搜索」块，「查看详情」里列出搜索内容和来源链接（只有 http/https 链接可点），刷新后还在。

三种搜法（`packages/shared/src/chat-options.ts` 的 `chatWebSearchMode`）：

| 模型 | 搜法 | 怎么工作 | 实测（正式环境，2026-10-14） |
| --- | --- | --- | --- |
| 主站的 OpenAI 模型、Grok | 模型自带 | Responses API 的 `web_search` 工具，主站在同一次回答里搜，本站不执行 | gpt-6-sol 搜 1 次、grok-4.7 搜 2 次，答案正确并带 nodejs.org 来源，10–12 秒 |
| 主站的 Gemini | Gemini 自带的 Google 搜索 | 模型调用 `search_web` 工具；服务端用同一个 Key、同一个模型单独发一次只带 `googleSearch` 的原生 generateContent，拿回带来源的回答（`features/web-search/gemini-grounded.ts`）。来源是 Google 的跳转链接，服务端解析成真实网页地址 | Gemini 和本站工具同时出现时 Gemini 不会真的去搜（实测 0 个来源、凭记忆回答），单独调用才搜；一次 5–10 秒 |
| 其他所有模型（自己添加的服务商、Claude、DeepSeek、通义、GLM、Kimi……） | 免费网页搜索 | 模型调用 `search_web`（标题、链接、摘要）和 `read_webpage`（打开网页读正文），服务端执行（`features/web-search/`） | 自定义服务商 gpt-5.6-sol 搜 1 次，经 Yahoo! JAPAN 拿到 6 条结果，答案正确，8 秒 |

- 模型自带的搜索被拒（400/404/405/422，报错提到 web_search 或说不清原因）时，这次对话改用 `search_web` 继续搜，接口退回原来的。日志 `[agent-model] … refused a request with built-in web search (…); this run searches with the web search tool instead`。
- 服务商连 `search_web` 也拒绝时，这次对话不再带搜索。
- Gemini 的单独搜索失败或没有来源时，改用免费网页搜索；也没有结果时，把 Gemini 的回答标成「未经核实」交给模型。
- 每次运行最多搜 12 次、读 12 个网页，超过就让模型用已有结果回答。
- 主站把自带搜索按次计费（分组的 `web_search_price_per_call`），Gemini 的单独搜索按一次 Gemini 调用计费；免费网页搜索不花钱。用户关掉地球就不会搜。

### 免费网页搜索的来源

按顺序试，哪个先给出结果就用哪个（`features/web-search/service.ts`）：

1. 配置了才有（可靠，推荐生产配置一个）：`LOOMIC_WEB_SEARCH_SEARXNG_URL`（自建 SearXNG，要在 settings.yml 打开 json 格式）、`LOOMIC_WEB_SEARCH_TAVILY_KEY`（Tavily，免费额度每月 1000 次）、`LOOMIC_WEB_SEARCH_BRAVE_KEY`（Brave Search API）。
2. 不用 Key 的网页：Yahoo! JAPAN（Google 的索引，中文结果也好）→ DuckDuckGo html → 维基百科 API（只有百科条目）。`LOOMIC_WEB_SEARCH_KEYLESS=off` 可以关掉这一组。

- 2026-10-14 从正式服务器（156.238.224.151）实测：Yahoo! JAPAN 有结果；DuckDuckGo 一开始有结果，被连续探测几十次后对我们所有服务器都弹「请证明你是人」（HTTP 202）；维基百科一直可用；Bing（RSS 和网页）对这个 IP 返回空页，而且它的 RSS 写明只许个人非商业使用，所以不用；Google、百度、搜狗、360、Brave 网页版、Startpage、Qwant、Ecosia、Mojeek 不是被拦就是没结果。
- 不用 Key 的来源是「尽力而为」：被拦的来源（验证页、403/429）歇 15 分钟，网络错误歇 2 分钟，下一次搜索直接跳过它；同一个问题 15 分钟内不重复搜。这些网站的使用条款可能不允许程序化搜索，量大或要长期稳定就配置上面的 Key。
- 日志不记搜索内容，只记长度：`[web-search] q(len=14) → yahoo-jp 6 result(s) in 1169ms`、`[web-search] duckduckgo refused us (HTTP 202); resting 15 min`、启动后第一次用到时 `[web-search] sources: yahoo-jp → duckduckgo → wikipedia`。

### 读网页的安全限制

`read_webpage` 的地址来自模型，按用户提供的地址对待（`features/web-search/read-page.ts`）：只允许 http/https 和默认端口，不允许 `user:pass@`、单段主机名和 .local/.internal 等；域名解析出的每个地址都必须是公网地址（和自定义服务商同一个 DNS 检查，在建立连接时检查，防 DNS 重绑定）；跳转手动跟随最多 5 次、每次重新检查；最多读 3 MB、20 秒；HTML 转成纯文字（MediaWiki 页面从正文开始），每次给模型 6000 字，可以接着读。正式环境实测 169.254.169.254、内部容器名、解析到 127.0.0.1 的域名都被拦下。

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

`~/xy-lab/e2e/chat-options.sh`（`16-chat-options.mjs`）：

- 选最高、联网默认开，发一条带 `[[mock:websearch]]` 的消息；关掉联网、选低再发一条；检查假上游收到的档位、`stream_options`、缓存 Key。
- 审图：截图后下一次请求带着 JPEG。
- 第 68 条：联网打开、选中，发 `[[mock:refusesearch]] …`。假上游拒绝没有 `search_web` 的请求（模拟不支持自带搜索的分组），服务端改用 `search_web`，假模型调用它，免费搜索去问假上游的 SearXNG 接口（实验室 `server.env` 里 `LOOMIC_WEB_SEARCH_SEARXNG_URL=http://mock-upstream:8000`、`LOOMIC_WEB_SEARCH_KEYLESS=off`），回复引用第一条结果；「联网搜索」块显示 2 个来源，刷新后还在。
- 实验室的 xy2api 用 API Key 账号把 Responses 请求转成 Chat Completions 发给假上游，并去掉自带的 `web_search` 工具，所以自带搜索块只能由单元测试覆盖（`agent/model-options.test.ts`）。

正式环境的真实核对脚本在工作区 `xy-ops/agent01/r68/live.mts`：把分支的服务端源码放到正式 API 容器的 `/tmp/r68`，链接容器里已装好的依赖运行（不影响正在服务的进程），用 acct1 自己的 Key 跑四种搜法和读网页的安全检查。

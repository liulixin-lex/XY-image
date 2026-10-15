# 设计助手：思考强度、联网搜索、审图、工作流、上下文与工具（第 67–70 条）

2026-10-14～15，agent01。设计助手（画布右侧的对话）这几轮加的能力，各自怎么工作、在哪里改、日志怎么看。第 68 条按主站源码和真实调用重新核对了每家模型的思考强度，并让所有模型都能联网搜索；第 69 条让助手做事高效（不像编程助手那样反复思考、探索），接入 AnySearch，并能只靠对话搭建和运行完整的节点工作流。第 70 条：执行步骤的模型和思考强度可在设置里选；取消每轮调用次数上限，改为 10 万 token 的上下文窗口（80% 时自动压缩，也可手动压缩）；对话时可以用「+」菜单指定目标、技能、品牌套件和工具；AnySearch 额度用完时有兜底。

## 第 70 条速览

| 方面 | 做法 | 位置 |
| --- | --- | --- |
| 执行步骤模型 | 设置 › 模型 › 执行步骤模型：选一个对话模型和思考强度，拿到工具结果之后的每一步都用它。不设置时用对话模型、思考强度「低」（模型没有档位时「自动」）。选的模型不能用了（Key 没了这个模型、服务商关了）就自动改用对话模型，日志 `[agent-model] execution model … is not usable`。两个模型不同时，历史里的推理内容（Responses 的 reasoning、reasoning_content、thinking 块）不传给另一个模型 | 迁移 `20261015000001_agent_execution_model.sql`（`xy2api_preferences.agent_exec_model / agent_exec_effort`）；`agent/execution-model.ts`；`agent/model-options.ts`（`createChatOptionsMiddleware` 的 planning / execution 两侧，`withoutReasoning`）；网页 `components/settings/models-tab.tsx` |
| 上下文窗口 | 不再限制每轮调用模型的次数（原来 30 次）。每次调用前估算上下文（中文约一字一 token，图片按 1000，按上一次调用实际计的 token 校准）；到窗口（10 万，模型更小时按模型）的 80% 时，较早的对话由执行步骤模型压缩成摘要，最近约 2 万 token 原文保留；服务商说超长时也压缩后重试。被压缩的原文存进项目的 `/history/<会话>.md`，模型需要细节时可以 read_file。每次调用后发 `context.updated` 事件，对话面板顶部的圆环显示用量 | `agent/context-window.ts`（替代 deepagents 的摘要中间件，状态字段沿用 `_summarizationEvent`，已压缩过的旧会话照常可用）；`backends/prod.ts`、`dev.ts` 的 `/history/` 路由；`stream-adapter.ts`；网页 `components/chat/context-meter.tsx` |
| 手动压缩 | 点圆环 › 现在压缩：用同样的方法压缩（保留最近约 30%，至少 2000 token），对话还在回复时不能压缩（409）。`GET /api/agent/sessions/:id/context` 读用量，`POST …/compact` 压缩 | `runtime.ts` `sessionContext` / `compactSession`，`http/runs.ts`，`context-window.ts` `compactAgentThread`（用和运行时同一张图写状态，不会丢掉同一会话里的文件等其他状态） |
| 防止死循环 | 同一个工具、同样的参数连续第三次调用不执行，告诉模型换个做法或直接回复；LangGraph 的步数上限恢复为 10,000（v0.0.15 用 `createAgent` 后默认只有 25 步，大约 8 轮工具就会报错） | `agent/run-guards.ts`（原 `run-budget.ts`） |
| 指定（「+」菜单） | 输入框左下的「+」：目标（画布上的节点）、技能、品牌套件（整套，替换这条消息用的项目套件）、工具（生图、搭建工作流、运行工作流、联网搜索、审图、编辑画布）。选中的显示在输入框上方，随消息发出；服务端写成 `<human_targets>`、`<human_skill_mentions>`、`<human_brand_kit_choice>`、`<human_tool_choice>` 并要求模型照做。选「联网搜索」时这条消息自动打开联网 | 网页 `components/chat/pick-menu.tsx`；`packages/shared/src/contracts.ts`（`canvas-node`、`brand-kit`、`tool` 三种引用）；`runtime.ts` `buildMentionXmlBlocks` |
| AnySearch 额度 | 区分限流（按「retry after N 秒」休息）、额度用完（402 或额度字样：先停 1 小时，再停 2 小时、4 小时，最多 6 小时）、密钥无效（停 6 小时，日志报错）。每天（UTC）最多发 `LOOMIC_WEB_SEARCH_ANYSEARCH_DAILY` 次（默认 1000，搜索和读网页一起算），用到就当天不再用。不能用时依次换下一个来源（Tavily/Brave 若配置 → Yahoo! JAPAN → DuckDuckGo → 维基百科）；全都没有结果时，用用户主站 Key 上的 Gemini（优先 Flash）做 Google 搜索（`LOOMIC_WEB_SEARCH_GEMINI_FALLBACK=off` 关掉）。管理页「联网搜索」显示每个来源的状态、今天用了几次 | `features/web-search/providers.ts`（`anysearchRefusal`），`service.ts`（休息、每日额度、`extract`、`status`），`agent/tools/web-search.ts`（`fallback`），`http/admin-ops.ts` `GET /api/admin/ops/search` |
| 乱码 | AnySearch 把没声明字符集的网页按 Windows-1252 读成乱码，读回后还原（PR #99） | `providers.ts` `repairMojibake` |

## 高效做事（第 69 条）

以前的问题（旧正式站 10-11～10-14 的记录）：几乎每轮都先读技能文件，常常先 `ls`/`glob` 浏览目录、反复写待办清单（`write_todos`）、每轮都 `inspect_canvas`，有一轮连接挂了近两小时。这些都是编程助手（deepagents）的习惯。现在：

| 改动 | 位置 |
| --- | --- |
| 不再用 deepagents 的整套编程助手：没有待办清单（`write_todos`）和通用子助手（`task`）；只保留文件工具、对话摘要（也负责上下文超长时压缩）和补全悬空工具调用 | `agent/deep-agent.ts`（`createAgent` + 选出的中间件） |
| 文件工具的说明换成三行中文（知道路径就直接读，不列目录）；`ls`、`glob`、`grep` 不给模型看 | `deep-agent.ts` `FILES_PROMPT`，`run-guards.ts` `createToolDietMiddleware` |
| 启用的技能直接写进系统提示词（14,000 字以内，超出的列出路径），不用再读文件；系统提示词按对话缓存 | `agent/skills-prompt.ts` |
| 思考强度：理解需求的那一步（用户刚发消息）按所选档位，「自动」按中；拿到工具结果之后的步骤按「执行步骤模型」的设置，没设置时用对话模型、按低（第 70 条） | `agent/model-options.ts` `planningEffort`，`agent/execution-model.ts` |
| 第 69 条曾限制一轮最多 30 次模型调用，第 70 条取消，改为上下文窗口和防死循环 | `context-window.ts`、`run-guards.ts` |
| 系统提示词重写：最重要的一节是「高效做事」（直接动手、合理默认、不重复检查、只做用户要的、回复不超过 5 行），并按节点画布讲清楚工作流 | `agent/prompts/loomic-main.ts` |
| `<canvas_state>` 把连线合成一行，生成节点显示最近一次运行有几张已在画布上，最多列 60 个节点，模型不用先 `inspect_canvas` | `agent/tools/inspect-canvas.ts` |

日志：`[agent-model] gpt-6-sol effort=auto→medium; after tools same model effort=low …`、`[agent-model] steps after a tool result: gpt-5.4-mini (execution model) effort low (first call gpt-6-sol medium)`、`[context] gpt-6-sol: compacted (auto) ~82000 → ~21000 tokens …`、`[agent-tools] inspect_canvas called 3 times in a row with the same arguments; not run`。

## 只靠对话搭建画布工作流（第 69 条）

画布是节点画布（`apps/web/src/lib/node-canvas`）：提示词卡片（`prompt`）、生成节点（`generator`，设置在 `customData.generator`）、图片、文字、分组框（`frame`），用两端绑定的箭头连接。生成节点运行时发送「连进来的提示词卡片文字 + 自己的描述」，连进来的图片作为参考图，连进来的上游生成节点把最近一次出的图作为参考图（链式）。

- **canvas_workflow**（`agent/tools/canvas-workflow.ts`）：一次调用完成整个结构：`add_prompt`、`add_generator`（模型、比例、画质、质量、张数、描述）、`add_note`、`connect`、`disconnect`、`update_prompt`、`update_generator`、`move`、`delete`、`add_frame`。新节点用 `ref`（p1、g1…）命名，同一次调用里直接连。不写坐标时从左到右自动排（卡片 → 生成节点 → 出图位置 → 下一个生成节点），放在已有内容右边；每个生成节点最多 8 张。模型名不认识时用默认模型并在结果里说明。
- **run_workflow**：和用户点「生成」走同一条路（`features/jobs/image-batch.ts`，HTTP 批量接口也改用它）：每个生成节点一批，出图位置按页面同样的 `outputSlots`（已移到 `packages/shared/src/canvas-layout.ts`），运行记录写进生成节点，打开的页面马上显示等待中的图，Worker 把图放到位置上并连线。同一次传入的链式节点先运行上游、等它出完图再运行下游。默认等出图并返回图片元素 id；算在本轮生图上限里。
- 写画布统一用 `features/canvas/canvas-mutation.ts` 的 `mutateCanvas`：只在 `updated_at` 没变时写入，否则重读再改，页面同时保存的内容不会被覆盖（`manipulate_canvas` 以前直接覆盖整张画布，现在也改用它）。
- 两个工具执行后页面都会重新同步画布（`canvas.sync`）。对话里显示「搭建工作流」「运行工作流」两个块。
- 实验室演练 `workflow.sh`：假模型用 canvas_workflow 搭出提示词卡片、生成节点、连线和分组框，再 run_workflow；检查存下来的画布（运行记录、图片在生成节点右边并连线、分组框包住节点）、页面上的节点，以及假上游收到的工具和思考强度（中 → 低 → 低，没有 write_todos/ls/glob/grep）。

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

- 「自动」（第 69 条起）：理解需求的那一步按中、之后的步骤按低（见「高效做事」）；Gemini（主站）和自己添加的服务商仍然什么都不发。gpt-6 系列也会要推理摘要（`reasoning.summary = "auto"`），思考过程显示在回复上方，长时间思考时连接也一直有数据。
- 选了其他档位：第一步按所选档位，拿到工具结果后的步骤最多按中（低仍按低）。
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

1. 配置了才有（可靠）：`LOOMIC_WEB_SEARCH_SEARXNG_URL`（自建 SearXNG，要在 settings.yml 打开 json 格式）、**`LOOMIC_WEB_SEARCH_ANYSEARCH_KEY`（AnySearch，正式环境第 69 条起使用；免费套餐每天 1,000 次）**、`LOOMIC_WEB_SEARCH_TAVILY_KEY`（Tavily，免费额度每月 1000 次）、`LOOMIC_WEB_SEARCH_BRAVE_KEY`（Brave Search API）。
   - AnySearch（`features/web-search/providers.ts`）：`POST https://api.anysearch.com/v1/search`，`Authorization: Bearer <key>`；中文问题带 `zone: "cn"`、`language: "zh-CN"`；结果用较长的 `content` 摘要。被拒时按原因休息（第 70 条：限流按对方给的秒数，额度用完 1→2→4→6 小时，Key 无效 6 小时），每天最多 `LOOMIC_WEB_SEARCH_ANYSEARCH_DAILY` 次。2026-10-15 从正式服务器实测：中文设计类问题 1.6–4.7 秒、结果相关（多乐士、立邦、站酷等）。
   - `read_webpage` 直接读被拒（HTTP 错误、连不上、超时）或读不到文字时，配置了 AnySearch 就改用它的 `POST /v1/extract` 读（页面由 AnySearch 抓取，不是本服务器）；内网地址、PDF 和图片不会走这条路。
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
- **读取类工具重试**（`agent/run-guards.ts`）：`inspect_canvas`、`project_search`、`get_brand_kit`、`view_images` 和文件读取遇到连接断开、超时，间隔 0.8 秒、2 秒再试两次；写入和生图不重试。画布读取遇到网络错误时抛出（以前会说「画布不存在」）。
- **没有调用次数上限**（第 70 条）：一轮能调用多少次模型只受上下文窗口约束（见上文「第 70 条速览」）；同样的工具调用连续第三次不执行（`run-guards.ts`）。
- **上下文超长**：主站或服务商回「超出上下文长度」时，错误链里放一个 LangChain 的 `ContextOverflowError`（`utils/context-overflow.ts`），上下文窗口中间件压缩历史后重试，而不是让运行失败。
- 提示词（第 69 条重写）：互不依赖的调用同一轮一起发；文字资料放 `/workspace/` 并用 apply_patch 修改；需要最新外部信息时用联网搜索并写明来源；工作流用 canvas_workflow / run_workflow。

中间件顺序（`agent/deep-agent.ts`，排在前面的在外层）：文件工具（deepagents）→ 上下文窗口（第 70 条）→ 补全悬空工具调用（deepagents）→ 拆开粘连的工具调用 → 隐藏 ls/glob/grep → 防死循环 → 工具错误回给模型 → 读取工具重试 → 项目记忆 → 模型重试 → 思考强度 / 执行步骤模型 / 联网搜索 → 审图。

## 网络和重试

见 `docs/XY2API_OPERATIONS.md`「繁忙自动重试」：对话模型在没输出任何内容前被主站拒为繁忙或连接没建立，等 2、6、15 秒重发；已经开始输出后的流内错误不重发（`agent/tool-call-stream.ts` 标记 `afterOutput`）。

兼容：有的网关用 Chat Completions 上游拼出 Responses 流，`output_text` 没有 `annotations` 数组，LangChain 读到第二轮就报 `Cannot read properties of undefined (reading 'map')`。`agent/tool-call-stream.ts` 的 `normalizeResponsesEvent` 补上缺的数组（实验室 xy2api 0.2.5 复现过）。

## 实验室演练

`~/xy-lab/e2e/chat-options.sh`（`16-chat-options.mjs`）：

- 选最高、联网默认开，发一条带 `[[mock:websearch]]` 的消息；关掉联网、选低再发一条；检查假上游收到的档位、`stream_options`、缓存 Key。
- 审图：截图后下一次请求带着 JPEG。
- 第 68 条：联网打开、选中，发 `[[mock:refusesearch]] …`。假上游拒绝没有 `search_web` 的请求（模拟不支持自带搜索的分组），服务端改用 `search_web`，假模型调用它，免费搜索去问假上游的 SearXNG 接口（实验室 `server.env` 里 `LOOMIC_WEB_SEARCH_SEARXNG_URL=http://mock-upstream:8000`、`LOOMIC_WEB_SEARCH_KEYLESS=off`），回复引用第一条结果；「联网搜索」块显示 2 个来源，刷新后还在。第 70 条起，拿到搜索结果之后的调用是执行步骤，用对话模型、思考强度「低」（lab-a 没设执行步骤模型），所以检查的是：第一次带 `search_web` 的调用为「中」，之后的为「低」。
- 实验室的 xy2api 用 API Key 账号把 Responses 请求转成 Chat Completions 发给假上游，并去掉自带的 `web_search` 工具，所以自带搜索块只能由单元测试覆盖（`agent/model-options.test.ts`）。

`~/xy-lab/e2e/controls.sh`（`18-controls.mjs`，第 70 条）：设置页的「执行步骤模型」；用「+」选「搭建工作流」后发 `[[mock:workflow]]`，假上游收到 `<human_tool_choice>`，第一次调用用对话模型（中），工具结果之后用执行步骤模型（中）；发一段长文后点圆环 › 现在压缩，假上游收到一次摘要请求（由执行步骤模型发出），会话读回已压缩。假上游在 `/__mock/requests` 里记 `picks` 和 `summary`。

正式环境的真实核对脚本在工作区 `xy-ops/agent01/r68/live.mts`：把分支的服务端源码放到正式 API 容器的 `/tmp/r68`，链接容器里已装好的依赖运行（不影响正在服务的进程），用 acct1 自己的 Key 跑四种搜法和读网页的安全检查。

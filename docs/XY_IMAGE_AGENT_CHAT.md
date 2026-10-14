# 设计助手：思考强度、联网搜索、上下文与工具（第 67 条）

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

## 网络和重试

见 `docs/XY2API_OPERATIONS.md`「繁忙自动重试」：对话模型在没输出任何内容前被主站拒为繁忙或连接没建立，等 2、6、15 秒重发；已经开始输出后的流内错误不重发（`agent/tool-call-stream.ts` 标记 `afterOutput`）。

兼容：有的网关用 Chat Completions 上游拼出 Responses 流，`output_text` 没有 `annotations` 数组，LangChain 读到第二轮就报 `Cannot read properties of undefined (reading 'map')`。`agent/tool-call-stream.ts` 的 `normalizeResponsesEvent` 补上缺的数组（实验室 xy2api 0.2.5 复现过）。

## 实验室演练

`~/xy-lab/e2e/chat-options.sh`（`16-chat-options.mjs`）：选最高、联网默认开，发一条带 `[[mock:websearch]]` 的消息；关掉联网、选低再发一条；检查假上游收到的档位、`stream_options`、缓存 Key。实验室的 xy2api 是 0.2.5，会把 Responses 请求转成 Chat Completions 发给假上游，所以搜索块和 Responses 上的缓存 Key 只能在上游直接看到 `/v1/responses` 时检查（单元测试 `agent/model-options.test.ts` 覆盖了请求格式）。

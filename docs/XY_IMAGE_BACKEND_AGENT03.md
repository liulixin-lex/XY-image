# agent03 后端增量交接（2026-10-08）

2026-10-09（北京时间）更新：用户选定**自建 Supabase**。部署入口、内外网URL、迁移/类型生成、权限加固及备份恢复详见 [自建运行手册](XY_IMAGE_SELFHOST.md)。当前共34份应用迁移，真实联调仍未执行。本文件保留首轮功能交付记录；自建收尾与发布状态见 [发布验收表](XY_IMAGE_RELEASE.md)。
执行目录 `/workspace/XY-image`，容器 `claude-module-02`，分支 `feat/server-agent03`，基于 `c7dcf6f`。本文件首轮成果已提交 `6e67855`；用户现已授权全部无冲突改动提交、推送并合并，最终记录见发布验收表。

用户最新指示：主站为 **gguuai.com**，主站镜像源码为 `https://github.com/liulixin-lex/xy2api`；Supabase 暂未创建，其它环境资料暂不提供；**先开发，开发完成后再做真实测试**。本轮只有离线单测、内存 PostgreSQL 迁移检查，未访问真实主站、使用真实凭据、执行付费调用或部署。

## 已实现

- **4-A 字体代理**：公开 `/api/fonts/css2` 与 `/api/fonts/files/*`；字体族与路径校验、固定上游、禁止重定向、10 秒超时、每 IP 每分钟 240 次、50 MB / 2048 项 LRU、最多 8 个同时进行的上游请求、文件流式发送。CSS 缓存一天，文件缓存一年。继承 API 的 CORS origin 白名单。
- Google 返回的文件名实际包含大写字母，子集 CSS 的地址为 `/l/font?kit=...&skey=...&v=...`，因此在原方案上增加固定的 `/api/fonts/files/subset.woff2` 参数白名单映射。前端仍只传 `family` / `text`，无需修改。
- 字体目录无 `GOOGLE_FONTS_API_KEY` 时保持 `{ fonts: [] }`，前端提示手动输入。**不依赖未公开保证的 metadata API**；若后续提供免 Key 字体库，选版本化、经审核的静态清单，避免新增运行时外部依赖。目前没有宣称提供全量离线字体库。
- **4-H 自定义对话服务商**：表与权限、AAD 绑定加密、服务层、CRUD/刷新路由、模型合并、账户偏好、设计助手接入、错误码和离线测试已完成。
- **原 4-B**：HTTP/WS 只把明确的本次模型选择传入运行时，不再拿工作区 `defaultModel` 覆盖账户偏好。
- **4-C**：已按主站源码确认 Key 额度单位为美元，`quota <= 0` 代表无限制。
- **4-E**：旧首页示例/发现表保留，清理方案见下方；未执行删表。
- **4-F**：仍按单 API 实例部署；跨进程协调留 TODO。图像计费链路未调整。

## 自定义服务商契约

与 `/workspace/XY-IMAGE-AGENT03-PLAN.md` 6.4 / 6.4.1 一致：

| 请求 | 响应 |
| --- | --- |
| GET `/api/chat-providers` | `{ providers: Provider[] }` |
| POST `/api/chat-providers` | 201 `{ provider }` |
| PATCH `/api/chat-providers/:id` | `{ provider }` |
| POST `/api/chat-providers/:id/refresh-models` | `{ provider }` |
| DELETE `/api/chat-providers/:id` | 204 |
| GET `/api/models` | `{ models, xy2api: { available, error? } }` |
| GET/PUT `/api/account/preferences` | `{ preferences }`，始终包含 `default_chat_provider_id` |

这些路由均要求已有主站影子用户登录。服务商不存在或不属于用户时为带 `provider_not_found` 的 404。创建/编辑/刷新按用户每分钟合计最多 10 次，429 带 `Retry-After`。响应均不缓存，Key 只返回末四位。

- PATCH 仅改名称、启用状态或手动模型列表不访问上游；带凭据或地址时验证 `/models`。改地址必须重填 Key。
- 手动模型允许 `/models` **404** 时保存；401/403、断网、无效 JSON、过大响应仍失败，失败 PATCH 不写入。
- 刷新失败只记错误码和检查时间，保留原模型列表；成功替换列表并清空错误。
- 每用户最多 10 个，同用户名称唯一。服务层串行化修改，数据库触发器也约束数量；数据库组合外键防止跨用户偏好引用。
- 删除由数据库触发器在同一事务内清空 `default_chat_provider_id` 和 `default_chat_model`。
- `openai:<model>` 为主站；`custom:<providerId>:<model>` 为自定义。模型名中 `:` / `/` 保留。shared 导出 `parseChatModelRef`、`formatChatModelRef`，行为与前端现有副本一致。
- 运行时：明确 override → 账户偏好 → 主站第一个可用模型。停用/删除的默认服务商按未设置处理。显式选中不可用自定义模型会返回对应错误。主站模型列表为空或不可用时不凭空启用环境模型。
- 自定义对话不取主站对话 Key，费用由该服务商收取；生图工具仍只走主站生图 Key、额度和任务守卫。
- `agent_runs.model` 保存完整模型引用，可确定来源和服务商 ID，不存 Key。
- `run.failed.error.code` 保留 `provider_*`；SDK 错误只记录安全码，不输出上游原文。共享错误目录已扩展。

### 网络与凭据边界

Key 使用现有 `LOOMIC_SECRET_KEY` 的 AES-256-GCM，加密 AAD 为 `loomic:chat-provider:v1:<user_id>:<provider_id>`。现有主站密文默认 AAD 不变。Key 只在 transport 闭包里注入，不进入模型序列化配置或图状态。

默认只允许 HTTPS 公网地址；拒绝用户信息、查询、fragment、空白与反斜杠；屏蔽配置中的主站、前端和 Supabase 主机名。undici 的每次连接 DNS lookup 检查全部解析地址，拒绝私网、环回、链路本地、CGNAT、保留/文档网段、IPv4 映射私网、IPv6 本地/组播/隧道地址。IP 字面量在每次请求前检查。重定向禁止，模型列表上限 2 MB，连接 10 秒超时，不自动重试。

配置：

- `LOOMIC_CHAT_PROVIDER_ALLOWED_HOSTS`：可选逗号分隔的**精确主机名**白名单。空值允许所有公网主机；该名单只收窄范围，**不豁免私网检查**。这是对方案「内网白名单放行」的收口，内网模型支持仍不在首版范围。
- `LOOMIC_CHAT_PROVIDER_ALLOW_HTTP=true`：仅开发时允许 HTTP；`NODE_ENV=production` 时忽略，仍不放开私网。
- 自定义服务商使用直接出站连接，**不使用 HTTPS_PROXY**，避免由代理解析 DNS 绕过防护；字体代理保留 HTTPS_PROXY 支持。部署网络需允许到服务商的直连。

锁定依赖的 `ChatOpenAI` 会按部分模型名自动选 Responses，即使 `useResponsesApi=false`；自定义分支使用该依赖正式导出的 `ChatOpenAICompletions`。主站原 GPT-6 Responses 行为保持。参考 [LangChain ChatOpenAI 配置](https://docs.langchain.com/oss/javascript/integrations/chat/openai)，并核对仓库已安装版本源码；新增 SDK 离线测试覆盖 GPT-6 名称的 Chat Completions 路由、流式工具调用、并发凭据隔离和不重试。

## 迁移、类型与部署准备

首轮新增 `supabase/migrations/20261009000001_user_chat_providers.sql`，后续自建增加 `20261009000002` 和 `20261009000003`，当前共34份。自建栈初始化后按文件名顺序执行全部，必须在新版API启动前完成。

新表 RLS 开启，没有客户端 policy，撤销 anon/authenticated 全部表权限，仅 service_role 访问。加密主密钥 API / Worker 必须一致，不能发布时重新生成。

`packages/shared/src/supabase/database.ts` 仍是旧的自动生成文件。本轮只扩展后端明确的 `IntegrationDatabase` 类型；**未手工伪造 langgraph schema 类型**。4-D 和 shared 既有红项要在真实 Supabase 迁移后用 `--schema public,langgraph` 重新生成。内存 SQL 夹具不用于生成生产类型。

`apps/server/scripts/check-xy2api-migrations.sh` 已包括新迁移与断言。有 Docker 时可完整重复执行；本容器没有 Docker，本轮使用 `/workspace/xy-ops/agent03/sql-check/` 中独立安装的 `@electric-sql/pglite@0.3.14` 执行相同 SQL 夹具和断言。仓库依赖及锁文件没有改变。这只验证增量 SQL、权限、外键和触发器，不能代替完整 Supabase 的 Auth/Storage/PGMQ/Realtime 验收，也未验证多连接数据库并发。

后续环境文件统一置于 `/workspace/xy-env/`（目录 700、文件 600）。使用 API `:3101` / 实际环境前端 `:4200`，不要占用假数据预览 `:3001` / `:4100`。API 单实例、Worker 独立进程、反代 TLS / WebSocket / 20m / 超时至少 660 秒，日志只记路径不记查询；详见 `XY2API_OPERATIONS.md`。

## Key 额度核实（4-C）

只读核对 `/workspace/xy2api`，origin 为用户指定仓库，HEAD `9717116f1`，没有修改或拉取：

- `backend/internal/service/api_key.go:51`：Quota 为 USD；`:85` 的 `IsQuotaExhausted` 对 `Quota <= 0` 返回 false；`:93` 的剩余额度对不限返回 -1。
- `backend/internal/handler/api_key_handler.go:40` / `:56`：请求 quota 的注释为 USD / 0 不限。
- `backend/internal/service/gateway_usage_billing.go:132` / `:173`：Key quota 累计使用实际美元成本；无限额度 Key 不进入这一分支，所以 quota_used 不能当作所有 Key 的累计消费账单。
- `frontend/src/types/index.ts:753` / `:754`、`frontend/src/views/user/KeysView.vue:1823`：美元额度/已用额度，空或 0 转成存储值 0。

当前生图站美元显示与 `quota <= 0` = 额度不限的处理正确。该结论来自上述源码版本，未验证 gguuai.com 的实际部署版本。

## 旧首页表方案（4-E）

目前保留 `home_example_categories`、`home_example_examples`、`home_discovery_categories`、`home_discovery_cases` 及历史迁移。代码搜索显示应用业务已不再使用，只有迁移和自动生成类型仍引用。

如以后决定删除：先盘点真实库行数、外键/视图/函数/定时任务/外部消费方和 Storage 对象，导出表数据及 schema 备份；确认无需恢复后，新增单独迁移按「examples/cases → categories」顺序删除，禁止改写历史迁移或使用宽泛 CASCADE。先在预发验证，部署窗口再执行。类型随后重新生成；只清理由这些表独占且有备份的对象，保留用户决定留下的 8 张前端示例图。回退采用备份恢复。**本轮没有执行任何删表或素材删除。**

## 前端接续

在 `/workspace/XY-IMAGE-HANDOFF.md` 第 9 节已留言：

1. 删除 `models-tab.tsx` 向工作区 `defaultModel` 的过渡双写。
2. `lib/chat-models.ts` 的模型引用解析/格式化可改为从 shared 导出，删除本地副本。
3. 获准开始真实测试且环境具备后，验证设置 CRUD、手动列表404、刷新失败、停用/删除默认、分组选择器、provider 错误中心和字体跨域。

后端已不读取双写值，因此前两项清理不阻塞这版运行时。按角色边界，本轮未改 `apps/web`。

## 验证记录

首轮离线检查（2026-10-08 UTC，后续结果见发布验收表）：后端 **22 文件 / 182 项通过**，前端 **21 文件 / 127 项通过**，根工作区 **10 项通过**；shared **42/43**，唯一失败为原有 `tracks official langgraph persistence schema typings`，按 4-D 等真实库迁移后生成。全仓类型检查 **5/5**，server/shared 构建 **3/3** 通过。显式改动文件 Biome 诊断由基线 9 项降至 8 项（剩余 5 lint / 3 format 均为既有位置），没有新增诊断；`git diff --check` 通过。

完整结果与后续变更以 `/workspace/XY-IMAGE-HANDOFF.md` 顶部和 agent03 的已完成记录为准。可复核日志均在 `/workspace/xy-ops/agent03/`；测试凭据为合成值，网络用 mock 或在打开 socket 前被拒绝的测试解析器，没有真实服务商对话。

真实环境仍待：创建 Supabase、完整迁移与类型生成、影子用户登录/TOTP/Turnstile、真实模型/工具兼容性、Storage/Realtime/PGMQ、request ID 与费用核对、实际部署版本和网络验收。

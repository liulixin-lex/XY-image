# Loomic × xy2api 后端交付记录

日期：2026-10-07。分支：`feat/xy2api-sso-billing`，基线 `21206c3`。

仓库发布补记：本记录描述原 Loomic 二开阶段。现按用户后续要求，将 `a5fe573` 完整代码快照创建为独立私有仓库 [XY-image](https://github.com/liulixin-lex/XY-image)，本地目录 `/image/XY-image`，默认分支 `main`，已推送 GitHub。原 `/image/Loomic` 和 `/image/xy2api` 保持不动。前端、真实环境验收及生产部署状态仍如下所述；GitHub 发布不是生产上线。

**后端实现、本地验证与容器冒烟完成；完整网站尚未达到生产放行门槛。** 用户追加要求将前端留给其他模型，因此本次没有修改 `apps/web`，没有执行 F1–F8。真实主站、Supabase 配置及内测凭据未提供，真实登录、TOTP、计费生图和端到端验收仍待负责人在预发完成。没有部署生产；原二开分支未推送，新独立仓库已按后续要求发布。

## 交付入口

- [前端接口交接](docs/XY2API_FRONTEND_HANDOFF.md)：接口、会话、请求与响应字段、错误处理、余额刷新、模型选择和 F1–F8 待办。
- [部署运行手册](docs/XY2API_OPERATIONS.md)：配置、迁移、容器、付费预检、验收、观察和回滚。
- [配置模板](.env.example)。API 与 Worker 必须使用相同加密密钥和 Supabase 项目。
- [真实主站预检脚本](apps/server/scripts/xy2api-preflight.ts)。需要私有环境配置，执行会产生实际费用，本次未运行付费调用。
- [可重复迁移检查](apps/server/scripts/check-xy2api-migrations.sh)。只使用独立临时 PostgreSQL，运行后自动删除。

## 范围和实施结果

依照 `/image/Loomic × xy2api 生图站当日上线开发交接规范（执行方：gpt-6-astra）.pdf`（36 页）和同目录 Markdown 实施 P0 后端。实际项目目录是 `/image/Loomic`；`/image/xy2api` 保持 `9717116f1`，工作区干净，未修改任何代码、文档或配置。没有新增项目依赖，pnpm-lock.yaml 未变。P1/P2 均未实施。

| 任务 | 结果 |
| --- | --- |
| B1 配置 | API/Worker 校验必填变量；停止读取旧供应商/支付秘密；配置及目录可覆盖 |
| B2 加密 | AES-256-GCM、随机 IV、AAD、严格版本与编码校验；密钥轮换要求重新登录 |
| B3 错误 | 管理面/网关错误识别、中文安全映射、unknown 计费状态；禁止转发原始错误体 |
| B4 客户端 | 登录、TOTP、刷新、me、Key 翻页、models、usage、logout、公开配置；固定 User-Agent，无转发用户 IP |
| B5 账号 | 合成邮箱影子用户、加密令牌、登录合并、刷新并发合并与轮换恢复、退出与会话失效 |
| B6 登录路由 | tokenHash、五分钟加密 TOTP 挑战、重放防护、Turnstile、IP/邮箱限流 |
| B7 鉴权 | 要求 xy2api provider 与 active 映射；60 秒缓存失效；HTTP/WS 主站会话复核 |
| B8 Key/目录 | 加密同步，最多三个模型探测并发，能力/归属/额度/期限校验，别名与平台回退 |
| B9 账户接口 | 真实邮箱、元数据白名单、美元余额 15 秒缓存、偏好更新与主站链接 |
| B10 Provider | 每次请求独立 OpenAI/Gemini 用户凭据、原生协议、参考图、1K/2K、请求 ID、实际 MIME |
| B11 生图入口 | 余额/模型/并发守卫；异步和同步画布共用服务；任务只绑定 Key ID |
| B12 Worker | 仅图像队列；持久化 CAS 防重复发送；charged/not_charged/unknown；只重试素材上传 |
| B13 Agent | 每轮独立对话 Key，GPT-6 Responses，运行限额，动态图像工具，关闭匿名与视频 Agent |
| B14 契约/清理 | 关闭本地积分、支付、视频路由及提权入口；增加错误契约、任务计费状态、日志脱敏 |

以上「结果」指实现及可完成的本地检查，不等同于规范第 9.3 节真实主站验收完成。旧积分表和触发器保留，但本应用执行链路不再读取、扣除或退还积分。旧 Provider/视频源文件保留且不注册。

## 数据库交付

1. `20261007000001_xy2api_integration.sql` 与规范 SQL 文本核对一致，未改原迁移。
2. `20261007000002_xy2api_job_write_boundary.sql` 补充撤销 anon/authenticated 对 background_jobs 的 INSERT/UPDATE/DELETE，保留 RLS 读取。浏览器不能自行重置 billing_status 或篡改已绑定 Key。

两份都要执行。新三表启用 RLS 且没有客户端 policy，仅服务端访问。任务创建、取消经 API 的 admin 客户端执行并重新校验权限。当前无法连接云端生成正式类型，采用显式 IntegrationDatabase 类型；迁移后负责人可生成完整数据库类型（包含使用到的 schema），再做类型复核。

## 验证结果

验证环境：宿主 Node 24.21.0 / pnpm 10.26.2；实际生产镜像 Node 22-slim；隔离迁移检查 PostgreSQL 18.1。所有测试凭据均为人工合成数据，没有真实主站 Key。

| 检查 | 实际结果 |
| --- | --- |
| pnpm install --frozen-lockfile | 通过，锁文件未修改 |
| shared build / typecheck | 通过 |
| server typecheck | 0 错误 |
| server test | 17 个测试文件，108 项全部通过（基线 24 项） |
| 修改文件 Biome | 60 个 TypeScript/JSON 等文件全部通过，无忽略生产规则 |
| git diff --check | 通过 |
| 两份迁移分别重复执行两次 | 通过；RLS、零 policy、权限、计费状态约束及服务端写入通过 |
| Docker build | 通过；构建阶段包含 shared build 与 server typecheck |
| 最终容器 API 冒烟 | health 200；account/models/匿名 runs 401；已移除提权与视频入口 404 |
| API/Worker 必填配置 | 六种缺变量启动场景全部失败退出，错误包含变量名而不包含秘密值 |
| shared test（额外检查） | 35 通过、1 既有失败；在 `21206c3` 独立副本复现完全相同结果 |
| 前端、锁文件、xy2api 变更检查 | apps/web、pnpm-lock.yaml 无差异；xy2api 工作区干净 |
| 秘密/旧入口静态检查 | 无主站 Key 字面量，无旧供应商环境变量读取，无服务端 set-plan 字面路径 |
| 真实主站 / Supabase E2E | 未执行，缺少部署配置和内测凭据；不可据本地测试放行生产 |

shared 既有失败是 `tracks official langgraph persistence schema typings`：基线 `packages/shared/src/supabase/database.ts` 缺失测试预期的 langgraph schema。该类型文件与测试均未修改；没有伪造生成类型来令断言通过。全仓 lint 的原有 812 项问题、前端原有类型/测试问题不属于此次后端改造修复范围；不宣称全仓全绿。

新增测试覆盖：加密篡改/轮换、错误映射、管理面分页、并发刷新、普通 Supabase 用户拒绝、登录/TOTP/限流、账户脱敏和余额缓存、Key 能力和归属、低余额与用户锁、真实 SDK 向本地 HTTP 服务发送的协议/请求头/参数、429/503/断连无重试、同时投递只发送一次、持久化 claim 失败不发送、Storage 三次上传失败不重新生图、双用户对话凭据隔离、模型序列化无真实 Key、GPT-6 Responses 路由。

## 决策与规范差异

- 第 0 节禁止生成发送后自动重试，与 B12 允许 429/503 重试冲突。采用前者：所有生图只发送一次，任务 max_attempts=1，仅 Storage 上传最多三次。
- 保留原迁移并增加第二份权限迁移，解决原 background_jobs ALL policy 可被浏览器利用来重置计费状态的问题。
- 会话到期复核采用等待结果，并预留 30 秒复核窗口；相比 B7 异步返回，更及时阻止已撤销账号。主站网络/429/5xx 短暂故障不直接撤销会话。
- 禁用宿主 shell 与 filesystem Agent 模式。只过滤子进程环境不足以阻止读取宿主秘密，因此使用 StateBackend；旧依赖 Python 执行的技能不可用。
- 实际对话 Key 只进入 transport 闭包，ChatOpenAI 可序列化配置中放无效占位凭据，避免 LangGraph 序列化泄漏。
- 固定锁文件中的 Google GenAI SDK 无 retryOptions 时走单次 fetch；显式 attempts=1 会丢失非 2xx 错误体，故不设置该项。已有真实 SDK 本地 HTTP 回归测试证明只发送一次且保留错误映射，升级 SDK 必须重跑。
- 信任代理默认关闭，生产正确隔离反代端口后显式启用。参考图下载限定当前 Supabase Storage 或受限 data URL。
- gpt-image-1.5 使用其支持的方/横/竖尺寸；实际 MIME 从图像解析，不假定上游遵守请求格式。预检输出请求画质与最终画质。
- 前端 env 示例文件未修改；所需构建变量在根 .env.example 及前端交接文档中提供给下一执行方。

## 负责人剩余操作

1. 完成云端 Supabase 两份迁移、Auth 设置与私有环境配置，校对主站分组/额度/出口 IP。
2. 由下一模型执行前端 F1–F8，按接口文档联调，不恢复已停用入口。
3. 在预发分别用 OpenAI 与 Gemini 内测 Key 跑预检，逐条核对 request ID、生成次数和真实费用。
4. 勾选原规范第 9.3 节所有 P0 场景，特别是 TOTP/Turnstile、改密码/撤会话、超时不重发、余额不足无任务、素材保存与日志检查。
5. 全部通过后按运行手册部署生产；P1 一键创建 Key、预估价、嵌入登录继续保持未实现。

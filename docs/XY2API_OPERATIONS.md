# xy2api 后端部署与验收

2026-10-09（北京时间）更新：用户选定**自建 Supabase**。部署入口、内外网URL、迁移/类型生成、权限加固及备份恢复详见 [自建运行手册](XY_IMAGE_SELFHOST.md)。当前共34份应用迁移，真实联调仍未执行。运维自动化见 [监控与异地备份](XY_IMAGE_OPERATIONS_AUTOMATION.md)，上线放行记录见 [发布验收表](XY_IMAGE_RELEASE.md)。
2026-10-08 更新：前端 F1–F8 已交付；agent03 新增字体代理和自定义对话服务商，详见 [后端增量交接](XY_IMAGE_BACKEND_AGENT03.md)。用户要求先开发，真实测试延后；Supabase 尚未创建。生产放行仍要求完整迁移、真实主站和服务商验收，离线测试不代表真实计费已打通。

## 配置与准备

1. 按自建运行手册准备官方固定版本Supabase容器栈；先完整执行应用迁移，确保Auth、Storage、PGMQ、Realtime和Agent持久化表可用。
2. 按顺序执行 `supabase/migrations/20261007000001_xy2api_integration.sql` 和 `20261007000002_xy2api_job_write_boundary.sql`。第一份原样保留规范 SQL；第二份收回浏览器直接增删改 background_jobs 的权限，保留受 RLS 保护的读取。必须两份一起上线。再执行 `20261009000001_user_chat_providers.sql`；新版 API 依赖此表和偏好列。新库完整执行34份迁移；新增 `20261009000002` 和 `20261009000003` 必须在本轮API前执行。
3. 自建Auth环境关闭开放注册、匿名/电话/Google登录；保留email provider和Admin createUser/generateLink/verifyOtp能力。使用生成器的配置，本地config.toml不会自动配置自建容器。无需发送合成邮箱邮件。
4. 从根目录 `.env.example` 创建服务器私有环境文件，权限 `600`。设置 Supabase URL、anon key、service role、Postgres URL、xy2api API/Web URL、SSO_EMAIL_DOMAIN、LOOMIC_WEB_ORIGIN。用 `openssl rand -base64 32` 离线生成 LOOMIC_SECRET_KEY，API/Worker 完全一致。不要执行旧的种子账号脚本；普通 Supabase 用户不通过集成鉴权。
5. 为主站 Key 分组启用图像能力，确认余额、Key 限额、模型、平台和出口 IP 白名单。主站设置或部署由负责人执行；本开发没有修改 xy2api 仓库。

API 与 Worker 缺少 XY2API_BASE_URL、LOOMIC_SECRET_KEY 或 SSO_EMAIL_DOMAIN 都会退出。LOOMIC_SECRET_KEY 必须是标准 base64 编码的 32 字节密钥。轮换后旧密文失效，用户需重新登录同步 Key；不能随每次发布重新生成。

默认单 API 实例；登录限流、刷新合并和用户排队锁均在进程内。扩容前需改成跨进程协调。Worker 只读加密用户 Key，不刷新主站会话。不要配置旧 OPENAI/GOOGLE/REPLICATE/METASO/VOLCES/LEMONSQUEEZY 平台凭据。

LOOMIC_TRUST_PROXY 默认 false。只有 API 端口被反向代理保护时才置 true，生产将容器端口绑定 127.0.0.1。LOOMIC_EGRESS_IP 用于前端提示，不用于伪造请求来源；发送主站时不会转发用户 IP。

LOOMIC_AGENT_BACKEND_MODE 仅接受 state。为防宿主机秘密被模型工具读取，关闭了本地 shell；纯画布、图片、对话和虚拟文件工具可用，依赖 Python/shell 的旧技能不可用。容器已去掉相应 Python 安装。

## 本地开发与检查

建议 Node 22、pnpm 10.26.2，使用已有 lockfile，不需要新增生产依赖。自定义服务商直接出站，不经 HTTPS_PROXY；可用 LOOMIC_CHAT_PROVIDER_ALLOWED_HOSTS 限定公网主机，详见增量交接。

```bash
pnpm install --frozen-lockfile
pnpm --filter @loomic/shared build
pnpm --filter @loomic/shared typecheck
pnpm --filter @loomic/shared test
pnpm --filter @loomic/server typecheck
pnpm --filter @loomic/server test
bash apps/server/scripts/check-xy2api-migrations.sh
```

最后一项使用 Docker 建立独立、无暴露端口的 PostgreSQL 18 临时容器并自动删除，重复执行五份集成/自建增量迁移，检查 RLS、零 policy、客户端权限、计费字段约束、服务商归属/删除/数量约束以及就绪/旧RPC权限漂移。它使用最小 Supabase 表结构夹具，不能代替真实 Supabase 项目的完整迁移验收。

开发启动：根目录准备 `.env.local`，然后 `pnpm --filter @loomic/server dev`，会同时启动 API 与 Worker。前端协作以工作区交接文档认领表为准。由于 shared 是编译包，改动契约后先重新 build shared。

## 构建和预发

统一使用 [自建运行手册](XY_IMAGE_SELFHOST.md) 的 Compose 流程：先基础栈、34份迁移及真实类型生成，再构建/启动 app profile。不要使用单独 docker run 脱离 Compose 网络；`SUPABASE_INTERNAL_URL=http://api-gw:8000` 和内部数据库地址只在该网络内可解析。

构建强制 shared build 和 server typecheck；`.dockerignore` 排除真实 env、凭据目录及前端。SERVICE_MODE 区分同一镜像的 API/Worker；非root、只读根文件系统、tmpfs临时文件。API固定单实例。`GET /api/health` 只验证进程，内部 `/api/ready` 验证依赖且由公网反代隐藏。

反向代理使用生成的 Nginx 模板：TLS、WebSocket upgrade、20m请求体、至少660秒API/Realtime读取超时、禁用上游自动重试、只记录不含查询的路径。Supabase公开Auth仅允许一次性verify、会话refresh、GET user、logout及其预检；不允许设置本地密码、password/PKCE grant或自行发登录邮件。内部Admin操作仍经私网。前端现存的旧PKCE callback不是主站登录流程，不开放对应grant。

API收到停止信号后排空已接收WebSocket Agent及最终消息持久化；Worker停止接单并等待在途任务，ACK失败保留已成功结果，重投不会再生图。Docker停止宽限720秒仍须真实环境验证，不承诺SIGKILL可优雅退出。

## 真实付费预检

在私有环境文件中额外设置 PREFLIGHT_API_KEY。只在内测/预发、获准产生实际费用时运行；脚本会对每个发现的图像模型生成两张图，再对话一次，不会自动重试。不要把 Key 放进命令行、终端历史、Git 或聊天。

本地方式（从 apps/server 运行）：

```bash
node --env-file=../../.env.local --import tsx scripts/xy2api-preflight.ts
```

容器方式使用同一 Compose 网络和镜像启动一次性任务；私有文件包含服务端配置及 PREFLIGHT_API_KEY。此命令只在真实付费预检获准后执行：

```bash
./deploy/selfhost/compose.sh --profile tools run --rm \
  -v /workspace/xy-env/preflight.env:/run/xy-preflight.env:ro xy-migrate \
  node --env-file=/run/xy-preflight.env --import tsx scripts/xy2api-preflight.ts
```

脚本先读 models/usage，逐模型 standard/hd 各调用一次，再对话；输出模型数量、余额、耗时、字节数、MIME、请求 ID，不打印 Key 或模型回答。`requestedQuality` 与 `effectiveQuality` 区分请求与降级：只支持 standard 的模型两次都会生成 standard。失败退出码非零。

若 `/v1/models` 省略生图模型，额外设置 PREFLIGHT_KEY_PLATFORM 为真实分组平台（openai/grok/gemini/antigravity/composite），使脚本与 Key 同步的平台回退规则一致。不要凭猜测选平台。Key 不支持全部协议时分别用各协议内测 Key 执行。

每次运行后到主站用量页核对生成次数、实际费用、余额和 `client:<X-Client-Request-ID>`。出现 upstream_too_large 时，由主站负责人调整响应上限或在 LOOMIC_IMAGE_MODELS 中将对应模型 maxQuality 降为 standard，再重新做受影响模型验收。

## 上线门槛与运行

- 真实账号完成密码、TOTP、Turnstile、错误密码、限流（同一邮箱连续 10 次失败后 429；成功登录不计数）、退出及普通 Supabase 用户拒绝检查。
- 主站创建/删除 Key、同步、切换 OpenAI/Gemini、额度用完、IP 白名单、余额为零检查。
- Turnstile：Cloudflare 里 site key 的 hostname 白名单要包含生图站域名，否则生图站登录拿不到 token（xy2api 本身不校验 hostname）。生产已开内容审计：用命中规则的提示词各试一次 OpenAI 和 Gemini 生图，应提示修改输入（safety_filter）、主站不扣费，并且之后同一个 Key 仍能正常生图。
- 读取主站 `/api/v1/settings/public` 的 `version`，必须在 `XY2API_VERIFIED_VERSIONS` 内；不在则先按 [xy2api 版本兼容](XY2API_COMPAT.md) 录制并回放通过。上线后关注 `[xy2api-compat]` 告警与漂移日志。
- 同步画布、异步任务、Agent 生图均拿到图；实际主站用量与账单一致。超时只发送一次，unknown 进入人工核对。
- 主站改密码/撤销会话后按配置间隔要求重新登录；新 HTTP 请求和已有 WebSocket 都验证。
- 前端 F1–F8 完成并验收；浏览器网络、Local Storage、日志、任务表无主站明文 Key/JWT。
- Supabase 真实表权限、Storage 上传、Realtime 读取及 PGMQ 心跳续期验证。只有上述全部完成后开放生产入口。

查询当天任务：

```sql
select status, billing_status, count(*)
from public.background_jobs
where created_at > now() - interval '1 hour'
group by 1, 2;
```

关注 upstream_unknown、key_unavailable、request_rejected、rate_limited 和 storage_failed。request_rejected 增多通常说明主站改了规则或文案（内容审计、新版本错误 id），要对照 `docs/XY2API_COMPAT.md` 补归类。主站开了内容审计自动封禁时，用户反复触发 safety_filter 可能被主站停用，之后会表现为 xy2api_reauth_required。生成发送后无自动重试（包括 429/503）；仅 Storage 上传最多三次。pending/unknown 不应手工改回 none 重跑。已扣费未交付的任务由负责人到主站核对并补偿；Loomic 不执行扣积分或退款。

## 回滚

先关闭前端入口并停止本次 API/Worker，避免旧前端继续调用。保留数据库增量表及审计数据，不回退成允许浏览器改 billing_status。旧平台 Key 版本不能当作本分支的无缝回退版本。

若需撤销本次集成持有的凭据，由负责人执行原规范 10.5 的清空 xy2api_api_keys、置账户 reauth_required、清空 access/refresh 密文和轮换 LOOMIC_SECRET_KEY；需要立即撤销主站会话时，在主站后台执行相应用户的撤销全部会话。此类破坏性步骤没有在本工作区运行。

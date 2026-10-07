# xy2api 后端部署与验收

本分支交付 API、Worker、数据库增量迁移和前端接口文档。生产放行仍要求前端 F1–F8、真实主站预检及原规范全部 P0 验收通过。不要将本地模拟测试或 `/api/health` 成功当成已打通真实计费。

## 配置与准备

1. 使用已有 Loomic Supabase 项目；新项目先完整执行原有迁移，确保 Auth、Storage、PGMQ、Realtime 和 Agent 持久化表可用。
2. 按顺序执行 `supabase/migrations/20261007000001_xy2api_integration.sql` 和 `20261007000002_xy2api_job_write_boundary.sql`。第一份原样保留规范 SQL；第二份收回浏览器直接增删改 background_jobs 的权限，保留受 RLS 保护的读取。必须两份一起上线。
3. Supabase 控制台关闭开放注册、匿名登录和 Google；本地 config.toml 已关闭前两项，但它不改变云端项目。保留服务端 Admin createUser/generateLink 能力。无需发送合成邮箱的邮件。
4. 从根目录 `.env.example` 创建服务器私有环境文件，权限 `600`。设置 Supabase URL、anon key、service role、Postgres URL、xy2api API/Web URL、SSO_EMAIL_DOMAIN、LOOMIC_WEB_ORIGIN。用 `openssl rand -base64 32` 离线生成 LOOMIC_SECRET_KEY，API/Worker 完全一致。不要执行旧的种子账号脚本；普通 Supabase 用户不通过集成鉴权。
5. 为主站 Key 分组启用图像能力，确认余额、Key 限额、模型、平台和出口 IP 白名单。主站设置或部署由负责人执行；本开发没有修改 xy2api 仓库。

API 与 Worker 缺少 XY2API_BASE_URL、LOOMIC_SECRET_KEY 或 SSO_EMAIL_DOMAIN 都会退出。LOOMIC_SECRET_KEY 必须是标准 base64 编码的 32 字节密钥。轮换后旧密文失效，用户需重新登录同步 Key；不能随每次发布重新生成。

默认单 API 实例；登录限流、刷新合并和用户排队锁均在进程内。扩容前需改成跨进程协调。Worker 只读加密用户 Key，不刷新主站会话。不要配置旧 OPENAI/GOOGLE/REPLICATE/METASO/VOLCES/LEMONSQUEEZY 平台凭据。

LOOMIC_TRUST_PROXY 默认 false。只有 API 端口被反向代理保护时才置 true，生产将容器端口绑定 127.0.0.1。LOOMIC_EGRESS_IP 用于前端提示，不用于伪造请求来源；发送主站时不会转发用户 IP。

LOOMIC_AGENT_BACKEND_MODE 仅接受 state。为防宿主机秘密被模型工具读取，关闭了本地 shell；纯画布、图片、对话和虚拟文件工具可用，依赖 Python/shell 的旧技能不可用。容器已去掉相应 Python 安装。

## 本地开发与检查

建议 Node 22、pnpm 10.26.2，使用已有 lockfile，不需要新增依赖。

```bash
pnpm install --frozen-lockfile
pnpm --filter @loomic/shared build
pnpm --filter @loomic/shared typecheck
pnpm --filter @loomic/shared test
pnpm --filter @loomic/server typecheck
pnpm --filter @loomic/server test
bash apps/server/scripts/check-xy2api-migrations.sh
```

最后一项使用 Docker 建立独立、无暴露端口的 PostgreSQL 18 临时容器并自动删除，重复执行两份迁移，检查 RLS、零 policy、客户端权限及计费字段约束。它使用最小 Supabase 表结构夹具，不能代替真实 Supabase 项目的完整迁移验收。

开发启动：根目录准备 `.env.local`，然后 `pnpm --filter @loomic/server dev`，会同时启动 API 与 Worker。按用户要求，本次不启动/修改前端。由于 shared 是编译包，改动契约后先重新 build shared。

## 构建和预发

```bash
docker build -f apps/server/Dockerfile -t loomic-server:<release-tag> .
docker run -d --name loomic-api --restart unless-stopped \
  --env-file /opt/loomic/.env -e SERVICE_MODE=api \
  -e LOOMIC_SKILLS_ROOT=/opt/loomic/skills \
  -p 127.0.0.1:3001:3001 loomic-server:<release-tag>
docker run -d --name loomic-worker --restart unless-stopped \
  --env-file /opt/loomic/.env -e SERVICE_MODE=worker -e WORKER_ID=w1 \
  -e LOOMIC_SKILLS_ROOT=/opt/loomic/skills loomic-server:<release-tag>
```

构建中强制 shared build 和 server typecheck；.dockerignore 排除真实 env、凭据目录及前端。SERVICE_MODE 区分同一镜像的 API/Worker。`GET /api/health` 只验证进程，不探测外部服务。

反向代理需 TLS、WebSocket upgrade、20m 请求体和至少 660 秒读取/发送超时；浏览器也不能对生图请求自动重试。原规范 Nginx 示例的 600 秒应覆盖提供商调用加上传时间，可提高至 660 秒。API 访问日志只记 `$uri`，不要记录包含 Supabase WebSocket token 的 `$request_uri` 或 `$request`。例如在 http 级别定义：

```nginx
log_format loomic_api '$remote_addr $request_method $uri $status $request_time';
```

再在 API server 中使用 `access_log /var/log/nginx/loomic-api.log loomic_api;`。API 内置 CORS 仅允许 LOOMIC_WEB_ORIGIN，不必加宽泛跨域配置。

## 真实付费预检

在私有环境文件中额外设置 PREFLIGHT_API_KEY。只在内测/预发、获准产生实际费用时运行；脚本会对每个发现的图像模型生成两张图，再对话一次，不会自动重试。不要把 Key 放进命令行、终端历史、Git 或聊天。

本地方式（从 apps/server 运行）：

```bash
node --env-file=../../.env.local --import tsx scripts/xy2api-preflight.ts
```

容器方式使用同一镜像启动一次性任务；私有文件包含服务端配置及 PREFLIGHT_API_KEY：

```bash
docker run --rm --env-file /opt/loomic/preflight.env \
  loomic-server:<release-tag> node --import tsx scripts/xy2api-preflight.ts
```

脚本先读 models/usage，逐模型 standard/hd 各调用一次，再对话；输出模型数量、余额、耗时、字节数、MIME、请求 ID，不打印 Key 或模型回答。`requestedQuality` 与 `effectiveQuality` 区分请求与降级：只支持 standard 的模型两次都会生成 standard。失败退出码非零。

若 `/v1/models` 省略生图模型，额外设置 PREFLIGHT_KEY_PLATFORM 为真实分组平台（openai/grok/gemini/antigravity/composite），使脚本与 Key 同步的平台回退规则一致。不要凭猜测选平台。Key 不支持全部协议时分别用各协议内测 Key 执行。

每次运行后到主站用量页核对生成次数、实际费用、余额和 `client:<X-Client-Request-ID>`。出现 upstream_too_large 时，由主站负责人调整响应上限或在 LOOMIC_IMAGE_MODELS 中将对应模型 maxQuality 降为 standard，再重新做受影响模型验收。

## 上线门槛与运行

- 真实账号完成密码、TOTP、Turnstile、错误密码、10 次限流、退出及普通 Supabase 用户拒绝检查。
- 主站创建/删除 Key、同步、切换 OpenAI/Gemini、额度用完、IP 白名单、余额为零检查。
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

关注 upstream_unknown、key_unavailable、rate_limited 和 storage_failed。生成发送后无自动重试（包括 429/503）；仅 Storage 上传最多三次。pending/unknown 不应手工改回 none 重跑。已扣费未交付的任务由负责人到主站核对并补偿；Loomic 不执行扣积分或退款。

## 回滚

先关闭前端入口并停止本次 API/Worker，避免旧前端继续调用。保留数据库增量表及审计数据，不回退成允许浏览器改 billing_status。旧平台 Key 版本不能当作本分支的无缝回退版本。

若需撤销本次集成持有的凭据，由负责人执行原规范 10.5 的清空 xy2api_api_keys、置账户 reauth_required、清空 access/refresh 密文和轮换 LOOMIC_SECRET_KEY；需要立即撤销主站会话时，在主站后台执行相应用户的撤销全部会话。此类破坏性步骤没有在本工作区运行。

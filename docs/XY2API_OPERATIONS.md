# xy2api 后端部署与验收

2026-10-09（北京时间）更新：用户选定**自建 Supabase**。部署入口、内外网URL、迁移/类型生成、权限加固及备份恢复详见 [自建运行手册](XY_IMAGE_SELFHOST.md)。当前共38份应用迁移（10-09 agent01 新增 `20261009000004`、`20261009000005`、`20261009000006`、`20261009000007`）；实验环境联调见 handoff 第 5 节。运维自动化见 [监控与异地备份](XY_IMAGE_OPERATIONS_AUTOMATION.md)，上线放行记录见 [发布验收表](XY_IMAGE_RELEASE.md)。
2026-10-08 更新：前端 F1–F8 已交付；agent03 新增字体代理和自定义对话服务商，详见 [后端增量交接](XY_IMAGE_BACKEND_AGENT03.md)。用户要求先开发，真实测试延后；Supabase 尚未创建。生产放行仍要求完整迁移、真实主站和服务商验收，离线测试不代表真实计费已打通。

## 配置与准备

1. 按自建运行手册准备官方固定版本Supabase容器栈；先完整执行应用迁移，确保Auth、Storage、PGMQ、Realtime和Agent持久化表可用。
2. 按顺序执行 `supabase/migrations/20261007000001_xy2api_integration.sql` 和 `20261007000002_xy2api_job_write_boundary.sql`。第一份原样保留规范 SQL；第二份收回浏览器直接增删改 background_jobs 的权限，保留受 RLS 保护的读取。必须两份一起上线。再执行 `20261009000001_user_chat_providers.sql`；新版 API 依赖此表和偏好列。新库完整执行38份迁移；新增 `20261009000002`、`20261009000003`、`20261009000004`、`20261009000005`、`20261009000006` 和 `20261009000007` 必须在本轮API前执行。
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

统一使用 [自建运行手册](XY_IMAGE_SELFHOST.md) 的 Compose 流程：先基础栈、36份迁移及真实类型生成，再构建/启动 app profile。不要使用单独 docker run 脱离 Compose 网络；`SUPABASE_INTERNAL_URL=http://api-gw:8000` 和内部数据库地址只在该网络内可解析。

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

关注 upstream_unknown、key_unavailable、request_rejected、rate_limited 和 storage_failed。request_rejected 增多通常说明主站改了规则或文案（内容审计、新版本错误 id），要对照 `docs/XY2API_COMPAT.md` 补归类。主站开了内容审计自动封禁时，用户反复触发 safety_filter 可能被主站停用，之后会表现为 xy2api_reauth_required。生成发送后无自动重试（包括 429/503）；只重试 Storage 写入（见下节），从不重新生图。pending/unknown 不应手工改回 none 重跑。已扣费未交付的任务由负责人到主站核对并补偿；Loomic 不执行扣积分或退款。

### 已扣费图片暂存与补传（M6）

主站返回图片即已扣费。之后写 Storage（每轮最多三次上传）或写 `asset_objects` 失败时，服务端把图片字节存进 `public.xy2api_pending_deliveries`（仅服务端可访问，迁移 `20261009000005`），任务回到 `queued` 并带 `error_code = storage_retrying`。Worker 用同一条队列消息补传，间隔 30 秒、1、2、4、8 分钟，之后每 10 分钟一次；连同第一次一共 12 次，约 75 分钟。补传不调用主站、不再扣费；补传成功后任务转为 `succeeded`，Worker 在记录成功之后才删除暂存行。同步画布接口遇到这种情况返回 502 `storage_retrying`，并把任务交给 Worker 补传。

用户看到的是“保存中”：不能取消，不占生图并发名额；Agent 会告诉用户图片正在保存、保存好后自动出现在画布上，不要重新生成。补传成功后 Worker 把图放到当时的画布上（见“画布图片存储”），开着的页面轮询到任务成功后合并进来。12 次都失败后任务转为 `dead_letter` / `storage_failed`，暂存行保留，等人工恢复。暂存失败（例如数据库也不可用）时直接 `storage_failed`，这时图片字节丢失，只能到主站核对补偿。日志关键字：`image held`、`storage attempt`、`delivered on storage attempt`、`for manual recovery`、`could not be held`。

查看暂存中的图片：

```sql
select d.job_id, j.status, j.error_code, d.attempts, d.last_error,
       octet_length(d.bytes) as bytes, d.created_at, d.updated_at
from public.xy2api_pending_deliveries d
join public.background_jobs j on j.id = d.job_id
order by d.created_at;
```

Storage 修好后，让放弃的任务再走一轮补传（把 `<job_id>` 换成实际 ID；补传只上传暂存的字节）：

```sql
begin;
update public.xy2api_pending_deliveries set attempts = 1, updated_at = now()
where job_id = '<job_id>';
update public.background_jobs
set status = 'queued', error_code = 'storage_retrying',
    error_message = '图片已生成并扣费，正在重新保存，稍后会出现在生成记录里', failed_at = null
where id = '<job_id>' and status = 'dead_letter' and billing_status = 'charged';
select pgmq.send('image_generation_jobs', jsonb_build_object(
  'job_id', id, 'job_type', 'image_generation', 'workspace_id', workspace_id))
from public.background_jobs where id = '<job_id>' and status = 'queued';
commit;
```

Storage 一时修不好、需要先把图交给用户时，可以导出字节：`psql -At -c "select encode(bytes, 'base64') from public.xy2api_pending_deliveries where job_id = '<job_id>'" | base64 -d > image`，扩展名看 `mime_type`。任务成功后仍留下的暂存行（Worker 删除失败）可以清理：

```sql
delete from public.xy2api_pending_deliveries d
using public.background_jobs j
where j.id = d.job_id and j.status = 'succeeded';
```

### “待核对”任务自动核对

计费结果未知（`billing_status = 'unknown'`）、但带着主站请求 ID（`xy2api_request_id`）的生图任务，由 Worker 到该用户的主站用量列表（`GET /api/v1/usage`）里找 `request_id = "client:<请求 ID>"` 的记录（迁移 `20261009000006`，代码 `features/xy2api/billing-reconciler.ts`）：

- 找到记录：改为 `charged`，日志写出用量记录 ID 和 `actual_cost`。
- 任务结束满 24 小时、完整翻完时间范围仍没有记录：改为 `not_charged`。主站每 5 秒重试一次用量写入，超过 60 秒就告警，所以一天没有记录可以认定没扣费。
- 其他情况（会话失效、主站限流、翻页超过 5 页、记录缺 `request_id`）：不下结论，下一轮再查，任务保持“待核对”。

Worker 每 5 分钟扫一次，每次最多 20 个任务。任务结束 2 分钟后第一次查，2 小时内每 10 分钟查一次，之后每 2 小时一次，最多查 7 天。多个 Worker 用 `billing_checked_at` 加 `SKIP LOCKED` 分摊，不会重复查同一个任务。用量列表占用户在主站的重查询额度（按分钟限流），所以同一用户遇到 429 或需要重新登录时，本轮跳过该用户。查询按 Key 过滤，Key 已在主站删除时改为查该用户的全部记录。

请求 ID 只有主站有响应时才拿得到：xy2api 不接受客户端自带的请求 ID。所以“主站还没响应就超时”的任务没法自动核对，仍然要用户到主站用量页核对。会带请求 ID 的情况：Gemini 安全拦截（主站会计费），以及主站已返回、但本站读不出图片的情况。

日志关键字：`[xy2api-reconcile]`。`checked N 待核对 job(s)` 是每轮汇总，`charged: usage row`、`not charged: no usage row` 是结论，`not checked (...)` 是跳过原因，`sweep failed` 说明数据库不可用或迁移没执行。设置 `XY2API_BILLING_RECONCILE=false` 可以关闭（默认开启），关闭后任务一直保持“待核对”。

查看还在等待核对的任务：

```sql
select id, created_by, xy2api_key_id, xy2api_request_id, error_code,
       created_at, failed_at, billing_checked_at
from public.background_jobs
where billing_status = 'unknown' and xy2api_request_id is not null
order by created_at desc;
```

人工在主站核对后可以直接改结论（只改仍是 `unknown` 的任务）：`update public.background_jobs set billing_status = 'charged' where id = '<job_id>' and billing_status = 'unknown';`，没扣费就改成 `'not_charged'`。

### 工作区成员与数据隔离

产品没有邀请功能，每个用户只有自己的个人工作区，成员只由 `bootstrap_viewer` 在首次登录时建立。迁移 `20261009000007` 之前，任何登录用户都能通过 Supabase REST 把别人加进自己的工作区；被加的人在 Agent 里生成的图，可能存进加人者的工作区（代码已改为按 owner 查个人工作区）。上线 `20261009000007` 前后各查一次，正常应为 0 行：

```sql
select wm.workspace_id, wm.user_id, wm.role, wm.created_at
from public.workspace_members wm
join public.workspaces w on w.id = wm.workspace_id
where w.owner_user_id <> wm.user_id;
```

有结果就说明有人用过这个漏洞：先记下这些行，再查对应用户在该工作区下的 `asset_objects` 和 `background_jobs`，确认后删除成员行。

双用户隔离演练（实验环境）：`~/xy-lab/e2e/isolation.sh`（API、WebSocket、REST、存储共 83 项，任一越权读到对方数据、5xx 或改动对方数据都算失败）和 `~/xy-lab/e2e/isolation.sh probe-agent-workspace.mjs`（Agent 生图存进自己的工作区）。脚本在 `xy-ops/agent01/e2e/`，只打印状态码，不打印令牌。

### 画布图片存储

画布图片存在 `project-assets/<工作区>/canvas-files/<画布>/`，`canvases.content.files` 里只留 `oss://project-assets/…` 标记。2026-10-09 之前路径少了工作区这一层，存储权限拒绝写入，所有画布图片都以 base64 留在 `canvases.content` 里；这些画布下次保存时自动转存，不需要手工迁移。还有多少没转存：

```sql
select c.id, count(*) as inline_files, sum(length(f.value->>'dataURL')) as inline_bytes
from public.canvases c
cross join lateral jsonb_each(
  case when jsonb_typeof(c.content->'files') = 'object' then c.content->'files' else '{}'::jsonb end
) f
where f.value->>'dataURL' like 'data:%'
group by c.id
order by inline_bytes desc
limit 20;
```

API 日志按 `[canvas-service]` 过滤：每次保存只要有图片转存、留在原地或缺数据，就记一行汇总；`not stored, kept inline` 是存储拒绝或出错（带对象路径和错误信息，不带内容），这张图会留在 `content` 里，下次保存再试。画布不再用的图片和已删除画布的图片目前不会自动清理（代码里有 TODO）。

用户在对话里点“停止”时，Agent 正在等的生图任务如果 Worker 还没取走（`queued`、`billing_status = none`），会直接取消，主站没有收到请求、不扣费；已经取走的照常跑完并放到画布上。Worker 刚取走、还没发出时任务被取消（和停止撞上），Worker 丢掉这条消息，任务保持“已取消”，不会记成失败。日志：API `[submitImageJob] job_poll_done {"status":"canceled_unsent"}` / `"stopped_running"`，Worker `canceled before it was sent`。停止或失败的对话里还在跑的工具保存成“已停止 / 处理失败”，刷新后不会一直转圈（`ws/assistant-draft.ts`）。

Agent 生的图由 Worker 放到画布上（任务带 `canvas_id` 的才放，生图面板的任务不带）。所以 Agent 等超时、或者图片在 Storage 补传期间才保存好，图也会回到画布。每个任务只放一次：元素的 `customData.jobId` 记着任务 ID，消息重投或 Agent 运行时再放一次都只返回已有的元素。写画布和保存都是条件写（`canvases.updated_at` 没变才写入，变了就重读再写），Worker 放图不会被同时进行的保存覆盖。页面保存时带上用户删掉的“Agent 放的图”的 ID（`deletedElementIds`）；库里有、页面还没加载、也没被删的 Agent 图，保存时会保留下来。不带 `deletedElementIds` 的旧页面仍然整份覆盖。日志：Worker `[image-generation] job … placed on canvas` / `already on canvas` / `not placed on canvas`（放图失败只记日志，图片仍在生成记录里），API `[canvas-service] … kept N placed image(s) the client has not loaded`、`changed during save, retry`，写入方 `[canvas-element-writer] … changed while inserting, retry`。

实验环境验证：`~/xy-lab/e2e/run.sh 04-canvas-files.mjs`（浏览器里拖入图片、刷新、旧画布转存、Agent 出图同步、画布生图面板，检查保存请求的大小和库里的标记）；`~/xy-lab/e2e/late-delivery.sh`（停掉 Storage 让 Agent 生图，恢复后检查 Worker 放图、页面没加载时的保存不丢图、合并时保留未保存的修改、删除后不再回来）；`~/xy-lab/e2e/run.sh 06-chat.mjs`（对话：回复、生图、刷新、多个对话、停止回复、生图途中停止、被拒的回复）。

`GET /api/proxy-image?url=…`（画布把生成结果放上去时用）只读本站 Storage：地址必须和 `SUPABASE_URL` 同源、在 `/storage/v1/object/public/` 或 `/sign/` 下、不含编码的 `.`、`/`、`\`；走内网（`SUPABASE_INTERNAL_URL`），不跟随重定向，只返回 png/jpeg/webp/gif（25 MB 以内，带 `nosniff`），每个 IP 每分钟 240 次。2026-10-09 之前它会抓取任何以 `supabase.co`、`replicate.*` 结尾的域名并跟随重定向，可以被当成开放代理，也能借重定向访问内网。日志前缀 `[image-proxy]`，只记拒绝原因和路径前几段，不记查询串。实验环境探针：`~/xy-lab/e2e/isolation.sh probe-image-proxy.mjs`。

## 回滚

先关闭前端入口并停止本次 API/Worker，避免旧前端继续调用。保留数据库增量表及审计数据，不回退成允许浏览器改 billing_status。旧平台 Key 版本不能当作本分支的无缝回退版本。

若需撤销本次集成持有的凭据，由负责人执行原规范 10.5 的清空 xy2api_api_keys、置账户 reauth_required、清空 access/refresh 密文和轮换 LOOMIC_SECRET_KEY；需要立即撤销主站会话时，在主站后台执行相应用户的撤销全部会话。此类破坏性步骤没有在本工作区运行。

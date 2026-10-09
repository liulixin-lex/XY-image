# XY-IMAGE 自建 Supabase 与后端运行手册

更新：2026-10-09（北京时间）。用户决定：先提交已有成果，再继续深化后端并改用自建 Supabase。此前后端成果已提交为 `6e67855`，未推送。本轮提供自建部署工程和后端加固；用户随后授权离线收尾并提交、推送、合并。代码集成与真实上线分开记录，见 [发布验收表](XY_IMAGE_RELEASE.md)。没有在真实服务器启动 Supabase，也没有调用主站或付费模型。

## 架构与边界

- 前端静态站、XY API 和 Supabase 公共入口各用一个 HTTPS 域名；域名由部署方提供，模板的 `example.com` 不能当作实际配置。
- PostgreSQL、Auth、Storage、PostgREST、Realtime、Studio 等采用官方 Supabase Docker 配置，固定至 `ff80bb14991e68667c04f74248b954e8babe6fde`。来源、SHA-256 和 Apache-2.0 LICENSE 在 `deploy/selfhost/vendor/`。`compose.base.json` 是该版本 YAML 的等价 JSON，不含自定义秘密。
- 当前固定版本默认网关为 Envoy；不沿用旧版本 Kong 的服务名假设。镜像有固定版本标签，升级时重新审核官方变更并固定 image digest；不能自动追随 master/latest。官方镜像实际拉取、目标架构和 Docker 构建仍待验收。
- API 与 Worker 同镜像，API 固定单实例。Supabase 网关绑定宿主机 `127.0.0.1:18000`，XY API 绑定 `127.0.0.1:3101`；数据库无宿主机端口。可选 Supavisor 置于 `pooler` profile，默认不启动、不暴露端口。API/Worker 使用 Docker 内网直连 DB。
- 对外只由宿主机 Nginx 提供 TLS。Studio 通过 SSH 隧道访问本机网关并使用随机管理员密码；公网反代只允许受限 Auth 和对象读取（`project-assets` 的公开 URL、各桶的签名 URL，仅 GET/HEAD）；REST、Storage 写入与列举、Realtime、Studio、meta 和 Auth admin 都不对公网开放（10-09 agent01，H2：浏览器不用这些路径，API 走 `SUPABASE_INTERNAL_URL`）。新增公开桶时要同步改 Nginx 模板里的桶名。Auth按方法/路径/完整query明确放行：POST verify、POST refresh_token、GET user、POST logout及OPTIONS；设置密码、password/PKCE grant、注册/邮件登录等入口全部拒绝，避免影子用户绕过主站认证。Realtime保留官方网关所需的网络DNS别名和tenant Host重写。
- `SUPABASE_URL` 是浏览器可达的公网 HTTPS 地址；`SUPABASE_INTERNAL_URL=http://api-gw:8000` 仅路由服务端 SDK 网络请求，SDK 生成的 Storage 公共/签名 URL 仍以公网域名为基础。服务端下载参考图时也把公网对象 URL 改写到内部地址（10-09 agent01，M4），因为公网反代只放行对象 GET，并且服务端不应绕到公网再回来。内部调用不经过外部 HTTP 代理。
- 主站账号仍在 gguuai.com 验证，Supabase 使用服务端创建的影子用户。`DISABLE_SIGNUP=true`，匿名/电话/Google 登录关闭；保留 email provider 是为了 Admin generateLink + verifyOtp 的影子会话，不能随意关闭此 provider。不会配置邮件发送。
- API/Worker 以非 root 运行、只读根文件系统，临时运行文件仅存在容器 tmpfs。所有开发文件仍在 claude-module-02 的 `/workspace`。

## 已实现的加固

1. 鉴权签名密钥与缓存改为实例内，不再跨实例共享。显式限定算法、audience 和 issuer，验证 exp/iat/sub/role；本地验证不使用会越过 exp 的缓存，远程验证缓存不超过令牌到期时间或一分钟。无效令牌/远程错误不记原文。
2. 生产启动前校验必需 Supabase 配置和公开 HTTPS 地址。`SUPABASE_JWT_ISSUER` 与自建 Auth 的 `API_EXTERNAL_URL` 保持一致。
3. `/api/health` 只代表进程存活；`/api/ready` 探测 DB 连接、业务/Agent 表、PGMQ 队列、Storage 桶、Realtime publication、权限、Auth 与 Storage API。5 秒合并缓存，3 秒单项超时，失败 503，不返回连接串；公网 Nginx 隐藏此路由。Realtime 项检查 publication 配置，不等同真实 WebSocket 推送验收；它只报告、不影响 `ok`（10-09 起：没有任何代码订阅 Realtime，公网也已关闭；以后要用 Realtime 推送时再改回必需项）。
4. Worker 满并发时休眠，数据库轮询故障指数退避至30秒；停止后不接收刚返回的新任务，等待已发送任务落库，停止宽限720秒。API先排空已接收WebSocket Agent及最终消息落库再关闭，排空期间照常响应、拒绝新运行、`/api/ready` 503；队列ACK失败不覆盖成功状态，已知charged在恢复时不退成unknown。健康文件反映轮询/运行状态；Docker unhealthy 不会自动重启，部署方需告警。没有增加任何生图重试。
5. 新增 `20261009000002`（就绪检查/Realtime publication）、`20261009000003`（权限加固）、`20261009000004`（`canvases` 存储桶改为私有并删除开放策略，权限检查增加匿名存储策略和公开 canvases 的漂移检测）和 `20261009000005`（已扣费图片暂存表 `xy2api_pending_deliveries`，只有服务端可读写；readiness 的 schema 检查要求此表存在，权限检查覆盖此表）和 `20261009000006`（“待核对”自动核对用的 `background_jobs.billing_checked_at` 列和部分索引，不加权限）和 `20261009000007`（工作区成员不再允许客户端自行添加或改动：删除 owner 的 INSERT/UPDATE 策略并收回权限，只剩 `bootstrap_viewer` 建成员；权限检查增加此项漂移检测），共38份应用迁移。旧积分扣减/退款/每日领取/套餐发放 RPC 仅 service_role 可调用；旧账单表客户端权限关闭，Agent/密文表和 langgraph schema 不对客户端开放。保留历史表，不做删表。`increment_job_attempt` 仍允许 Worker 的 service_role 调用。
6. Nginx 日志只记 `$uri`，不记查询和请求头；生成的 Envoy 日志把整个路径和 Referer 替换为固定脱敏标记，避免 Realtime query token 进入网关日志。应用/Worker 数据库错误不输出连接串。其他上游容器的错误日志还需上线前敏感信息抽检。
7. Worker 每 6 小时清扫没有任何画布引用、创建超过 3 天的画布图片对象（`CANVAS_FILES_SWEEP=on|dry-run|off`，默认 on，详见 [XY2API 运维](XY2API_OPERATIONS.md) 的“画布图片存储”）。

## 生成部署目录（离线，不启动服务）

先准备 Linux Docker Engine + Compose、Node 22、可拉取镜像的网络、服务器持久磁盘、DNS/TLS 和备份目的地。运行目录必须在 Git 仓库外。以下域名只是格式示例，首次生成前替换成实际域名；没有域名时继续开发，不生成假生产环境。

```sh
cd /workspace/XY-image
node deploy/selfhost/prepare.mjs \
  --dir /workspace/xy-env/selfhost \
  --web-origin https://image.example.com \
  --api-origin https://api.image.example.com \
  --supabase-origin https://db.image.example.com \
  --sso-domain sso.example.com
```

生成 `.env`（Supabase）、`server.env`（API/Worker）、`web.env`（前端构建）、`compose.json`、`deployment.json`、`nginx.conf` 和官方网关/DB初始化资产。目录700、凭据文件600；只输出路径，不输出秘密。已有目录直接拒绝，不覆盖、不隐式轮换密钥。`LOOMIC_SECRET_KEY` 必须长期保留，API/Worker 使用同一值。

公网域名如果套了 Cloudflare（gguuai.com 主站目前就在 Cloudflare 后面），生成时加 `--cdn cloudflare`。生成的 `nginx.conf` 会只信任 Cloudflare 公布的边缘网段，并从 `CF-Connecting-IP` 取客户端地址；不加的话，Nginx 看到的都是 Cloudflare 节点地址，登录限流会让全站共用一份 IP 额度，访问日志里也看不到真实来源（10-09 agent01，M3）。直连的请求不受影响，也不能用这个头冒充别的地址。网段清单写在 `prepare.mjs` 里（2026-10-09 读取自 https://www.cloudflare.com/ips/），Cloudflare 公告变更时要更新并重新生成 `nginx.conf`。前面用的是其他 CDN 时，先不要上线，补上对应的网段和请求头再说。

生成器从本地校验过的 vendor 复制资源，不在部署时动态拉取代码。上游 `.env.example` 中的示例凭据全部被替换或清空。Compose 源码构建路径是生成时的仓库绝对路径；换服务器时复制仓库并修改该非秘密路径，保留既有凭据，不重新生成生产密钥。

部署目录应仅由运维账户/容器运行时访问；不要用 `chmod -R 600` 修改 DB/Storage 数据目录。宿主机防火墙只公开80/443和必要的受限SSH端口。不要把完整 `docker compose config` 输出贴到日志或聊天（含凭据），校验用 `config --quiet`。

## 首次部署顺序（有环境、允许真实测试之后）

```sh
export XY_DEPLOY_DIR=/workspace/xy-env/selfhost
./deploy/selfhost/compose.sh --profile app --profile tools config --quiet
./deploy/selfhost/compose.sh pull
./deploy/selfhost/compose.sh up -d --wait
./deploy/selfhost/compose.sh --profile tools build xy-migrate
./deploy/selfhost/compose.sh --profile tools run --rm xy-migrate \
  node --import tsx scripts/selfhost-migrate.ts status
./deploy/selfhost/compose.sh --profile tools run --rm xy-migrate
```

默认 `up` 只启 Supabase，API/Worker 在 `app` profile，迁移在 `tools` profile，因此不会在空库上运行应用。迁移工具检查 Auth/Storage/服务角色及 pgmq 可用性、持有会话级 advisory lock、每份SQL单独事务、写入SHA-256账本，重跑跳过已完成项；失败回滚当前文件。检测历史文件修改、缺失或乱序时拒绝。已有应用表但无该工具账本时拒绝自动接管，需要人工核对真实迁移记录；不能伪造基线或重跑旧DDL。不会导入测试账号或改历史迁移。

迁移成功后，采用固定 postgres-meta 镜像从实际数据库生成类型：

```sh
node deploy/selfhost/generate-types.mjs
pnpm --filter @loomic/shared build
pnpm --filter @loomic/shared test
pnpm typecheck
./deploy/selfhost/compose.sh --profile app build xy-api xy-worker
./deploy/selfhost/compose.sh --profile app up -d --wait xy-api xy-worker
```

类型脚本包含 `public,langgraph`，缺少必需 schema/表会拒绝覆盖。现有 shared 的 langgraph 类型测试失败仅能在真实迁移后按此修复，本轮没有手工伪造数据库类型。若数据库已被较新镜像初始化，请勿混用旧版本镜像或历史备份。

配置Nginx证书、安装生成的 `nginx.conf`，运行 `nginx -t` 后按运维方式 reload。静态站使用 `web.env` 的 `NEXT_PUBLIC_*` 构建，交给前端agent执行；构建会改变现有预览产物，须先认领。当前本轮未修改 apps/web、未覆盖4100/3001预览。

上线验收必须包括影子用户登录、主站TOTP/Turnstile、Auth refresh/expired、Storage上传与公网/签名URL、Realtime用户隔离、PGMQ租约、正常/故障停机、第三方模型工具调用。每个会收费的请求需用户明确允许，并核对 request ID 与主站费用。通过 `ready` 不能代替业务验收。

## 备份与恢复

`backup.mjs` 是停写的一致性备份，**会造成维护窗口**，仅在部署运维需要时执行；本轮没有运行真实备份。它停止正在运行的写入服务（保留DB），等待应用优雅停止；保存 postgres 和 `_supabase` 的自定义格式dump、角色SQL、Storage文件、DB自定义密钥配置、应用和Supabase环境文件、部署版本及恢复服务清单，另含 `deployment-config.tar.gz`（实际使用的Envoy脱敏配置、functions、pooler与DB顶层初始化SQL，不含DB数据目录）。手动和调度共享锁，停写失败标记阻止下一轮误报成功。全部成功生成SHA-256清单后才恢复原来运行的服务。失败保留部分结果和停机状态，人工检查 `resume.json` 后恢复，不把部分备份当成功。

```sh
node deploy/selfhost/backup.mjs --dir "$XY_DEPLOY_DIR" --output /workspace/xy-backups/backup-20261009
node deploy/selfhost/verify-backup.mjs /workspace/xy-backups/backup-20261009
```

备份包含数据库角色口令和应用解密密钥，必须加密后异地保存，不能提交Git或上传公开存储；本脚本创建的是权限受限的明文备份，**不宣称已经加密**。已补充 [运维自动化工具](XY_IMAGE_OPERATIONS_AUTOMATION.md)，通过restic加密异地保存/定向保留，并提供定时器及监控告警；目标和定时器尚未配置或启用。备份目的地与部署数据盘分离、设定保留周期、磁盘满告警。版本快照/备份清单仍需定期恢复演练，哈希通过不等于恢复成功。

恢复采用新目录/新服务器，先恢复到隔离环境，禁止直接覆盖正在使用的库：

1. 校验清单；使用相同版本仓库、Supabase镜像和数据库大版本。恢复 `.env`、`server.env`、`web.env`、Compose/部署元数据；不得生成替代密钥。校准新服务器的仓库路径和DNS，初期不开放公网。
2. 先把 `deployment-config.tar.gz` 解压到新部署目录，保留原相对路径、属主和权限，包括生成后的Envoy脱敏配置；不能只复制原vendor或重新prepare轮换密钥。使用备份保存的同版本初始化资产建立新的DB容器。仅启动DB，其他服务停止。对 `roles.sql` 与初始化角色做差异审计，保持supabase角色所有权；不要直接忽略角色冲突继续执行。
3. 在隔离目标中用对应版本 `pg_restore --exit-on-error` 恢复 `postgres.dump` 和 `supabase-internal.dump`。初始Supabase schema可能与备份重复，恢复前按该版本官方流程处理空库/初始化对象；本轮未提供自动清库或 `--clean` 命令，防止误覆盖。恢复过程必须核对退出码和对象数量。
4. 恢复Storage归档到 `volumes/storage`，恢复 `db-config` 到对应Docker卷，保留原权限/属主。若只恢复数据库，图片内容和加密密钥可能丢失，不能放行。
5. 校验迁移账本、RLS/RPC权限、Storage桶/文件数和抽样哈希；先启动Supabase，然后迁移 `status` 与应用。ready检查、实际登录/上传/下载、任务与计费核对全部通过后再切流量。发现未知计费状态仍人工核对，不自动重新生图。
6. 保留原服务/原备份供回退。版本回滚只回退兼容的应用镜像；不能直接降级已升级的数据库目录。

后续若引入持续备份/PITR、S3对象存储或多API实例，应单独设计并验收；当前交付是单机持久卷与维护窗口备份，不承诺零停机或高可用。

## 检查证据与已知限制

日志：`/workspace/xy-ops/agent03/selfhost/`。

- 后端212/212、前端127/127、workspace10/10；shared42/43，唯一失败为既有langgraph生成类型。全仓typecheck5/5，server/shared基础构建通过。
- 部署工具15项离线/本地测试通过（prepare2、backup4、operations8、Nginx1）；涵盖权限600、拒绝覆盖、Realtime DNS、完整静态备份、输出流失败、锁/恢复阻断、加密上传流程与告警。Nginx1项为真实本地代理31拒绝+17放行、WebSocket101回归；不连接真实主站。
- 官方Compose CLI v5.6.0经发布摘要校验后，仅执行静态 `config --quiet`，通过；此容器没有Docker Engine，未拉取/启动服务镜像，也未执行Dockerfile构建。
- 五份增量SQL在独立PGlite重复两次，已有计费边界、服务商归属/数量、就绪权限、Realtime publication、旧RPC权限与权限漂移断言通过。它使用最小夹具，**不是34份完整迁移或真实Supabase验收**。
- CI新增部署工具、真实本地Nginx策略、隔离SQL与生产镜像构建/非root依赖冒烟；其实际运行结果以PR检查为准。共享包现有类型红项仍未隐藏或伪造修复。
- 尚待真实环境：自建栈启动、完整迁移、真实类型生成、Nginx TLS、真实图片/登录/Realtime/队列、停机恢复、备份还原演练、目标服务器容量及告警送达。
- 10-09 agent01（P0 修正，host-studio 实验环境）：Nginx 策略测试改为 47 拒绝 + 15 放行 + HEAD 放行 + Realtime 升级 404，在容器里的 Debian nginx 上通过，旧模板会在 `GET /rest/v1` 处失败。隔离迁移检查加入 `20261009000004`，canvases 锁定和两种漂移检测通过。实验环境库已执行该迁移：越权上传 400、匿名列举 0 条、旧对象公开读取 400。边缘代理按新规则收窄后，readiness 8/8，三套端到端全部通过，期间 226 次图片读取都是 200。
- 10-09 agent01（M4/M6，host-studio 实验环境）：隔离迁移检查加入 `20261009000005`，暂存表权限、权限漂移、随任务级联删除、空字节拒绝都通过；实验环境库已执行，readiness 8/8。存储故障演练（`xy-ops/agent01/e2e/m6-storage.sh`）：停掉 storage 后生图，页面 4 秒内显示“保存中”、没有取消按钮；第 2 次补传返回 Service Unavailable，暂存行 attempts 1→2；storage 恢复后第 3 次补传成功，暂存行删除，任务 `succeeded`，主站只扣一次。参考图生图（`probe-m4-reference.mjs`）成功：上游收到 1 次 edits 调用，Worker 没有“参考图读取失败”日志。三套端到端全部通过。
- 10-09 agent01（“待核对”自动核对，host-studio 实验环境）：隔离迁移检查加入 `20261009000006`，列和部分索引存在；实验环境库已执行，readiness 8/8，三套端到端通过。核对演练（`xy-ops/agent01/e2e/reconcile.sh`）：主站计费的 Gemini 安全拦截任务在 286 秒后按用量记录改为“已扣费”，页面同步更新；主站没见过的请求 ID、已过 25 小时的任务在下一轮改为“未扣费”。
- 10-09 agent01（双用户数据隔离，host-studio 实验环境）：`xy-ops/agent01/e2e/isolation.sh` 让 lab-broke 建一套临时数据（项目、画布、会话、消息、品牌套件、上传、技能），lab-a 通过 API、WebSocket、Supabase REST 和存储逐项读、改、删、引用。修复前 74 项里 6 项不合格：越权保存画布返回 200（实际没写入）、越权建会话/发消息返回 500、自己的项目能挂别人的品牌套件、上传和生图任务能带别人的项目/画布 ID（上传 500、生图 201）。另发现：任何 owner 能把别人加进自己的工作区，Agent 生图查“个人工作区”时没按 owner 过滤，角色对调后旧查询会选中别人的工作区。修复后 83 项全部通过，越权写入和引用一律 404；迁移 `20261009000007` 后加成员返回 403。`probe-agent-workspace.mjs`：画布 Agent 生图任务带画布和会话 ID，存进自己的工作区，画布上出现 1 张图。`project-assets` 按用户决定保持公开，知道完整路径就能读（含用户上传的参考图），列举返回 0 条。隔离迁移检查加入 `20261009000007`，readiness 8/8，三套端到端通过。

## 官方依据

- Supabase自建Docker：https://supabase.com/docs/guides/self-hosting/docker
- 固定配置源码：https://github.com/supabase/supabase/tree/ff80bb14991e68667c04f74248b954e8babe6fde/docker
- 固定postgres-meta类型生成接口：https://github.com/supabase/postgres-meta/blob/v0.99.0/src/server/routes/generators/typescript.ts

以上只作为实现依据，当前环境不具备真实自建栈的验收结果。

# XY-IMAGE 自建运维自动化

状态：离线实现与 fake 测试。没有初始化真实备份仓库、安装 timer、停止服务或发送外部告警。先阅读 `XY_IMAGE_SELFHOST.md`；本页补充上线前的执行配置，不代替真实恢复演练。

## 能力与限制

- `operations.mjs backup`：先验证远端 restic 仓库可访问，再调用维护窗口备份、校验本地哈希、加密上传、确认 snapshot ID、执行仓库 metadata check，然后按本项目 host/tag 保留周期执行 forget/prune。全部成功才删除本次明文暂存并记录成功时间。失败保留暂存，下一次不清理旧失败备份。
- `operations.mjs monitor`：检查本机 API ready、必要容器的状态/health、部署和备份盘可用空间、最近备份年龄及失败/恢复标志；状态变化立即通知，持续故障按 reminderMinutes 再通知，恢复发 resolved。投递失败返回非零且不标记已发送。通知仅包含固定故障代码、部署别名、时间，不发送路径、凭据或错误原文。
- 默认每天维护备份、每分钟监控。备份会中断业务；`Persistent=false` 故意禁止机器重启后立即补跑维护任务。错过备份由年龄检查告警。定时器不会自动重启服务、重跑生图或重复收费请求。
- 单机监控无法报告宿主机彻底断电、网络全断或监控进程本身停摆。生产仍须外部存活/告警送达检查；本次未虚构外部服务。
- 本地文件删除并非安全擦除；暂存盘应使用磁盘加密且限制访问。restic 密码需要在服务器以外离线托管；丢失密码无法恢复。`restic check` 默认是仓库元数据校验，不代表读取全部备份数据或完成恢复。

## 目标机前提

Linux systemd、Node 22、Docker Engine/Compose、tar、经来源校验并固定版本的 restic；独立持久盘、已初始化的加密远端 restic 仓库（S3 HTTPS、SFTP 或 REST HTTPS）以及可接收通用 JSON POST 的 HTTPS 告警入口。需确认远端属于不同故障域；HTTPS 地址本身不证明异地。脚本不会自动创建/清空仓库。

示例运维账户 `xy-ops` 需读部署目录/凭据、写部署目录锁和备份状态、访问 Docker。Docker 权限等价宿主机高权限，应使用受控运维账户。备份父目录和状态目录权限700，所有配置及密钥文件600。restic 的缓存和临时 pack 文件分别固定在 stateDir/restic-cache 与 stateDir/restic-tmp；运行前创建为700并拒绝软链接或宽权限目录，子进程显式设置 RESTIC_CACHE_DIR 和 TMPDIR，不依赖只读 /tmp。不要递归修改 PostgreSQL 数据文件属主/权限。

将 `deploy/selfhost/operations.example.json` 复制为 `/etc/xy-image/operations.json`（600），修改实际路径、唯一 host/tag、保留周期、空间和年龄阈值。确认真实异地目的地后才设 `offsiteConfirmed=true`；示例默认拒绝运行。示例阈值是运维配置起点，不是容量保证。

`/etc/xy-image/restic.env`（600）示例：

```dotenv
RESTIC_REPOSITORY=s3:https://实际对象存储地址/专用备份桶/xy-image
RESTIC_PASSWORD_FILE=/etc/xy-image/restic.password
AWS_ACCESS_KEY_ID=实际访问ID
AWS_SECRET_ACCESS_KEY=实际访问密钥
```

`restic.password`（600）存放足够强的独立仓库密码。不要复用数据库/JWT/应用密钥。只支持上述两项 RESTIC 配置和 AWS_ACCESS_KEY_ID、AWS_SECRET_ACCESS_KEY、AWS_SESSION_TOKEN、AWS_DEFAULT_REGION、AWS_REGION；禁止密码命令、明文 RESTIC_PASSWORD 和无加密模式。SFTP 用该运维账户的已验证 known_hosts/密钥；REST 后端可在受保护 repository URL 中配置其认证。凭据不放 Git、命令参数或聊天。

`/etc/xy-image/alert.json`（600）需要真实目的地：

```json
{"url":"https://实际告警接收地址","bearerToken":"可选真实认证值"}
```

接收方收到 `{source,host,status,problems,observedAt}`。这是通用 webhook 合同，不能直接假设兼容某个聊天平台专有格式；需要接收器适配。HTTP 2xx 只表示入口接受，仍需人工验证最终接收人收到通知。脚本不跟随跳转。

## 启用顺序

1. 在隔离目标按自建手册启动/迁移/验收，完成一次手动备份和恢复演练。用受保护环境初始化专用 restic 仓库并记录固定 restic 版本、仓库 ID、密码托管和存储保留策略。不要把仓库密码只放进该仓库自身。
2. 核对维护窗口，手工运行一次 `node /opt/xy-image/deploy/selfhost/operations.mjs backup /etc/xy-image/operations.json`。会停写，不应在真实环境许可前执行。确认上传、snapshot、保留和恢复完整性。
3. `node /opt/xy-image/deploy/selfhost/operations.mjs test-alert /etc/xy-image/operations.json` 会真实发通知；需要验证接收人收到，再跑一次 `monitor` 检查。
4. 将 `deploy/selfhost/systemd/` 内四个文件安装到 `/etc/systemd/system/`。模板默认仓库 `/opt/xy-image`、Node `/usr/bin/node`、运行数据 `/srv/xy-image` 和账户 `xy-ops`；部署不同必须同步修改 WorkingDirectory、ExecStart、ReadWritePaths 与配置路径。密码和SFTP文件也须该账户可读。核实 Node/restic/Docker 在 service PATH。
5. 用 `systemd-analyze verify` 检查目标机 unit，核对 `systemd-analyze calendar '*-*-* 03:00:00 UTC'` 对应的本地时间；例子是北京时间11:00，**应改成你的实际维护窗口**。再执行 `systemctl daemon-reload` 和 `systemctl enable --now xy-image-monitor.timer xy-image-backup.timer`。这会启用真实运维，当前没有执行。
6. 观察 `systemctl list-timers`、服务退出码和 `operations-state/backup.json`，验证故障/恢复告警。为宿主机失联、timer失败/未运行及备份目标容量配置独立外部检查。

默认保留7个有备份的日、4周、6月；按 restic 规则合并计算，可能不是简单17份。备份路径每次变化，因此 backup/forget 均用 `host,tags` 分组，forget 同时限定专用 host/tag，不按动态路径形成永不轮换的新组。不要对同一仓库并行执行其他 prune/forget/unlock；脚本保留 restic 原生锁，冲突失败退出。生产先审查同等参数的 `forget --dry-run` 输出，必要时采用对象存储不可变/离线副本保护；本次没有宣称已配置 WORM/PITR。

## 失败与人工恢复

- `.xy-backup.lock` 防止手动和定时本地备份重叠；`.xy-automation.lock` 防止两次上传/保留同时运行。进程正常失败会释放锁；崩溃留下的锁不自动删除。先查 owner.json 对应进程/主机及 `resume.json`，确认没有在运行的运维命令再处理。
- 停写之前写入部署目录 `.xy-backup-recovery.json`，完整本地备份并启动原服务成功后删除。只要此文件存在，后续本地备份拒绝执行，防止把已停机环境当成功备份。监控会告警。不要盲目删锁/标记或运行全栈 up；先核对文件里的原服务集合、数据库与失败原因，人工恢复并确认健康后才移除标记。
- 明文备份包含 `deployment-config.tar.gz`：仅收录 `volumes/api`（包括生成的Envoy脱敏模板）、`volumes/functions`、`volumes/pooler/pooler.exs`、`volumes/db` 顶层SQL；明确排除 PostgreSQL 的 data 目录。恢复时解压至原部署相对路径，保持原资产与配置。不能只复制vendor，不能重新prepare生成密钥。
- stdout/stderr只报告安全阶段与状态；详细状态文件600。不要为了排错把 `.env`、完整 compose config、dump、restic仓库URL或Webhook贴到公开日志。
- restic上传/校验/保留失败不会删除本地暂存，也不会自动再生图；备份脚本本地备份失败会保留写入服务停机状态。监控/告警失效时按 service 非零退出处理，不能当成功。

## 离线检查

`node --test deploy/selfhost/*.test.mjs`。测试使用本地假Docker/命令执行器、假HTTP响应和合成秘密，不连接远端仓库/主站/告警。临时文件默认仓库父目录 `.xy-selfhost-tests`（当前容器 `/workspace/.xy-selfhost-tests`），可通过绝对 `XY_SELFHOST_TEST_ROOT` 覆盖，测试结束删除各自目录。覆盖输出流失败、锁冲突、恢复阻断、静态资产排除数据目录、远端失败保留、定向retention、告警去重/恢复/投递失败。

仍待真实验证：目标机unit解析与权限、restic版本/后端认证、真实上传/读回/容量/保留、完整恢复、维护窗口通知、告警最终送达、外部失联监测。任何一个不能由fake测试代替。

## 官方实现依据

- https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html
- https://restic.readthedocs.io/en/stable/040_backup.html
- https://restic.readthedocs.io/en/stable/060_forget.html
- https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html

开发已读取上述项目官方源码文档（restic doc/030、040、060与JSON输出实现、systemd timer手册），来源仅用于工具行为核对。

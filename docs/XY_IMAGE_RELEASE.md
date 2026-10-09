# XY-IMAGE 发布收尾与上线验收记录

2026-10-09（北京时间），agent03。用户授权：「现在开始收尾。然后提交全部未提交且不冲突的内容，然后推送远端仓库并合并」。

## 代码集成范围

合并源分支 `feat/server-agent03`，目标远端 `origin/main`。包含此前未推送的前端 `aa5e63f`、自定义服务商前端 `ba61a39`、workspace测试修正 `c7dcf6f`、后端 `6e67855`，以及本轮自建/收尾增量。最终提交和合并状态以Git历史与GitHub PR为准；不把代码合并记为已部署上线。

本轮不修改前端界面，不覆盖现有预览产物，不修改 xy2api/Loomic 源码，不初始化生产数据库、不执行真实主站或付费模型调用，也不启用定时器/发送外部告警。私有凭据、数据卷、备份、截图和本地运维日志不提交。

## 收尾修复

- API 退出等待已接收的 WebSocket Agent 运行与最终消息落库；排空期间拒绝新任务、保留在途浏览器RPC，断线不重复执行。
- Worker 停止信号与心跳写入的竞态封口；ACK失败不把成功任务改为失败；重投归档终态任务，已知charged保持，pending才转unknown。
- 生成Compose保留Realtime网络别名，官方Envoy DNS及tenant Host路由一致。
- 公网Auth采用方法/路径/完整查询允许列表，保留一次性verify、refresh、GET user、logout和预检；禁止影子用户设置本地密码及password/PKCE等替代登录入口。内部Admin仍走私网。
- 备份立即处理输出流错误，手动/调度互斥，失败保留恢复标记；包含实际Envoy脱敏模板、pooler和初始化SQL，排除DB数据目录。
- 新增restic加密异地保存/限定host-tag保留、systemd调度及状态告警；缓存/临时目录固定在受限可写stateDir，拒绝软链接及过宽权限。
- selfhost测试使用可配置仓库外目录；备份测试使用真实prepare产物。CI增加部署工具、真实本地Nginx策略、隔离PostgreSQL迁移及生产镜像构建/非root依赖冒烟。

## 已有验证证据

本地最终日志在 `/workspace/xy-ops/agent03/finalize/`，不进入Git。

| 检查 | 结果 | 边界 |
| --- | --- | --- |
| server测试 | 30文件，212/212 | 本地回归含真实TCP/WebSocket关闭；上游模拟 |
| web测试 | 21文件，127/127 | 没有重新构建或覆盖前端预览 |
| workspace测试 | 10/10 | 工作区约束 |
| 部署工具 | 15/15，0skip | prepare2、backup4、operations8、Nginx1 |
| Nginx策略 | 31拒绝、17放行、WebSocket101 | 真实本地Nginx1.28.3+fake上游；无生产TLS |
| 类型检查 | 5/5 | 使用当前生成类型 |
| server/shared基础构建 | 3/3 | 与真正Docker镜像构建分开 |
| 增量SQL | 5份重复2次与权限/计费断言通过 | 独立PGlite夹具，非34份完整Supabase迁移 |
| Compose | 固定官方CLI config静态验证 | 不启动真实服务 |
| shared测试 | 42/43 | 原有langgraph生成类型失败，未skip或手写伪造修复 |
| 本轮源码Biome | 仅pgmq-client.ts原有7项诊断 | 未全仓重排，不宣称全仓lint绿 |
| vendor原样保留 | 官方Edge函数源码含4行既有行尾空格 | 不改带SHA-256的官方资产；差异空白检查排除此目录 |
| 秘密/冲突检查 | 提交前检查文件范围、差异及凭据模式 | 官方vendor示例及合成测试值可存在；不等同完整历史安全认证 |

`pnpm test` 仍会因shared既有项非零退出。后端CI原来不运行该生成类型测试，本轮没有用continue-on-error掩盖新失败。生产放行前必须从完整迁移后的自建库导出 `public,langgraph`，包含user_chat_providers，再让全测试通过。

远端CI在本轮推送后执行，结果看GitHub检查与工作区交接记录；本地容器无Docker Engine，不冒称已经在本地构建生产镜像。CI只使用临时数据库和本地假上游，不调用主站或付费服务，不自动部署。

## 上线前仍须完成

以下为空白待验收项，不能仅凭代码合并勾选。

- [ ] 服务器、持久盘、三个HTTPS origin、DNS/TLS、出口网络和独立备份目的地落实。
- [ ] 固定目标架构镜像及摘要，真实启动完整自建栈；执行全部34份迁移并验证账本、权限、存储桶、PGMQ、Realtime。
- [ ] 生成真实数据库类型，解决shared失败，全部测试和类型检查通过。
- [ ] 生产配置构建前端，检查CORS、WebSocket、Storage公网/签名URL、字体、账户与默认模型。
- [ ] 主站登录/TOTP/Turnstile、刷新/过期/撤销与Key同步联调；至少两用户验证数据隔离及所有容器日志无凭据。
- [ ] Turnstile 的 hostname 白名单含生图站域名；主站内容审计拦截后提示修改输入、不扣费、Key 仍可用（OpenAI、Gemini 各一次）。
- [ ] 获准后检查三条生图路径、第三方对话/工具调用与request ID费用对账；超时/断线/停止不重复发送。
- [ ] 真实队列租约、网络失败、SIGKILL、整栈退出/恢复及预期初期容量验证。
- [ ] 配置并测试定时备份、加密异地上传/保留、内部及外部告警送达；明确维护窗口。
- [ ] 在隔离目标完整恢复DB、Storage、静态配置与密钥，完成业务复核和应用回退演练。
- [ ] 小范围内测通过、上线负责人签收后开放生产入口。

每次验收记录：环境/版本、执行时间、执行人、检查项、通过或失败、脱敏证据路径、遗留问题及修复复测。禁止把密钥、验证码、原始请求头或备份内容贴进记录。

执行顺序：部署准备 → 完整迁移/类型 → 前后端及主站联调 → 权限/故障/容量 → 恢复/告警 → 内测 → 上线。单API实例约束保留；多实例、高可用、PITR、S3迁移和旧表删除可延期。

详细步骤：[自建手册](XY_IMAGE_SELFHOST.md)、[运维自动化](XY_IMAGE_OPERATIONS_AUTOMATION.md)、[业务验收](XY2API_OPERATIONS.md)。

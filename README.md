# GGUU AI IMAGE（XY-image）

接入 xy2api 主站的 AI 生图站：用主站账号登录，用自己的主站 Key 生图和对话，按次从主站余额扣费。基于 [Loomic](https://github.com/fancyboi999/Loomic) 二次开发。

**状态（2026-10-09）：功能开发完成。** 整套服务（自建 Supabase、API、Worker、前端、TLS 边缘）已在实验环境里跑通，上游用模拟服务，不产生费用；浏览器端到端、双用户隔离、计费、重启和故障、手机和容量演练都已通过。**还没有和真实主站联调，也没有部署到生产。** 上线前要做的事见 [发布说明与上线验收](docs/XY_IMAGE_RELEASE.md)。

## 功能

- **登录**：主站邮箱密码、TOTP 和 Turnstile；本站只建影子账号，不保存主站密码和令牌。
- **账户**：主站余额（美元）、Key 同步与选择、默认模型、生成记录（计费核对）。
- **生图室**：OpenAI Images 和 Gemini 两种协议，参考图，1K/2K 画质；按次扣费，发出后不自动重试。
- **画布**：Excalidraw 无限画布；图片存到 Storage，画布里只留标记；画布生图面板。
- **设计助手**：画布里的 Agent 对话，能拆解需求、生图并放到画布上；运行中可以停止；断线、服务重启时不丢消息、不重复扣费。
- **自定义对话模型服务商**：用户自己的 OpenAI 兼容服务，只用于对话，Key 加密保存，只允许 https 公网地址。
- **品牌套件、技能**；字体经后端代理加载（国内网络可用）。
- **手机**：底部导航，对话全屏。

## 计费规则（改代码前必读）

- 每次生图只发给主站一次，不自动重试，不自动重新生成。
- 结果不明的任务记为“待核对”，不当成功也不当失败；请求根本没发出去的记为未扣费。
- 余额读不到（`null`）不等于 $0。
- 详见 [运维与业务验收](docs/XY2API_OPERATIONS.md)。

## 结构

| 目录 | 内容 |
| --- | --- |
| `apps/server` | Fastify API 和 Worker（同一镜像，`SERVICE_MODE` 区分）；PGMQ 任务队列；xy2api 接入层 |
| `apps/web` | Next.js 15 静态导出，Excalidraw 0.18 |
| `packages/shared` | zod 契约、错误码、对话失败文案 |
| `supabase/migrations` | 38 份数据库迁移 |
| `deploy/` | 自建 Supabase 部署生成器、Nginx 模板、备份与告警；`deploy/xy2api-lab` 是 xy2api 契约实验室和模拟上游 |

源码保留 `@loomic/*` 包名，避免破坏依赖。

## 开发与检查

Node.js 22，pnpm 10.26.2。配置从 `.env.example` 复制到私有的 `.env.local`；不要提交真实密码、Key 或令牌。

```bash
pnpm install --frozen-lockfile
pnpm --filter @loomic/shared build
pnpm turbo run typecheck          # 8 项
pnpm --filter @loomic/server test # 441 项
pnpm --filter @loomic/web test    # 154 项
pnpm --filter @loomic/shared test # 45 项
pnpm test:workspace               # 10 项
pnpm test:selfhost                # 16 项通过，1 项跳过
pnpm --filter @loomic/server dev  # 同时启动 API 和 Worker，需要 Supabase 和集成配置
```

CI：每个 PR 跑后端和前端检查（包括生产镜像构建）；每天跑一次 xy2api 契约回放（已验证版本和 latest），主站发新版时及早发现接口变化。

## 文档

- [发布说明与上线验收](docs/XY_IMAGE_RELEASE.md)
- [自建部署手册](docs/XY_IMAGE_SELFHOST.md)、[备份与告警](docs/XY_IMAGE_OPERATIONS_AUTOMATION.md)
- [运维与业务验收](docs/XY2API_OPERATIONS.md)：计费、待核对、画布图片、重启
- [xy2api 版本兼容](docs/XY2API_COMPAT.md)、[契约实验室](deploy/xy2api-lab/README.md)
- [前端说明](docs/XY_IMAGE_FRONTEND.md)
- 历史交接：[后端交付记录](HANDOFF_RESULT.md)、[前端接口交接](docs/XY2API_FRONTEND_HANDOFF.md)、[agent03 后端](docs/XY_IMAGE_BACKEND_AGENT03.md)、[仓库来源](docs/REPOSITORY.md)

## 来源与许可

来源快照：Loomic `feat/xy2api-sso-billing@a5fe573`。本仓库使用独立的提交历史；xy2api 主站没有代码改动。原 Loomic 的 MIT License 和版权声明完整保留，见 [LICENSE](LICENSE)。

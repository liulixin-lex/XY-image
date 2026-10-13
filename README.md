# GGUU AI IMAGE（XY-image）

接入 xy2api 主站的 AI 生图站：用主站账号登录，用自己的主站 Key 生图和对话，按次从主站余额扣费。基于 [Loomic](https://github.com/fancyboi999/Loomic) 二次开发。

**状态（2026-10-13，v0.0.11）：正式站 [image.gguuai.com](https://image.gguuai.com) 已部署，接真实主站 gguuai.com。** 本版：界面文字做减法；落地页加入滚动联动、横向卷轴、吸顶和 3D 交互；示例图全部换成本站用 GPT Image 2.5 Sunburst 4K 生成的图。实验环境全量回归 29 项通过；正式站只读冒烟、落地页检查和压测通过（压测 0 失败，登录后接口约 810 次/秒、页面约 4,300 次/秒）。**还没有对外开放**：差内测、异地备份和告警渠道、CDN。详见 [发布说明与上线验收](docs/XY_IMAGE_RELEASE.md)。

## 功能

- **登录**：主站邮箱密码、TOTP 和 Turnstile；本站只建影子账号，不保存主站密码和令牌。
- **账户**：主站余额（美元）、Key 同步；能生图的 Key 默认全部启用，可以单独关掉、设默认；默认模型、生成记录（计费核对，分页、多选、删除）。
- **生图室**：所有启用的 Key 下的模型按 Key 分组可选，一次可以多个模型对比出图；OpenAI Images、Gemini、xAI 三种协议，参考图；画质 1K/2K/4K、质量 自动/低/中/高，按模型能力开放；一次张数不限（输错一位数的保护：单次 500 张，20 张以上要再点一次确认），每张单独请求，发给主站的并发也不限；提示词优化；局部重绘（在图上涂抹要改的地方）和扩图（OpenAI、Gemini 模型）；按次扣费，发出后不自动重试。
- **画布**：节点式无限画布（React Flow）：提示词卡片和图片连到生成节点出图，每个节点可用不同 Key 的模型，节点可以串联（上游的图做下游的参考图）、一键全部生成；连线可以断开、改接，不会连成回路；另有文字、形状、画框；图片存到 Storage，画布里只留标记；出的图由 Worker 放到画布上，关掉页面也不丢。
- **作品**：顶栏「作品」直接进作品页（所有出过的图，按日期分组的方格，可按来源筛选，滚动加载）；单张或多选删除（可撤销，24 小时后清理文件，画布和对话还在用的保留），多选打包下载、一起作参考；「画布」进画布项目。
- **生图模板和品牌**：28 个模板（电商、海报、社媒封面、品牌、写实摄影、插画、信息图、改图），填几个空写好提示词和参数；生图页可以选品牌套件，每张图带上它的配色和调性。
- **设计助手**：画布里的 Agent 对话，能拆解需求、生图并放到画布上；运行中可以停止；断线、服务重启时不丢消息、不重复扣费。
- **自定义对话模型服务商**：用户自己的 OpenAI 兼容服务，只用于对话，Key 加密保存，只允许 https 公网地址。
- **品牌套件、技能**：品牌套件可从标志取色；官方技能「生图提示词规范」，技能市场 16 个精选技能；字体经后端代理加载（国内网络可用）。
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
| `apps/web` | Next.js 15 静态导出，React Flow 12 节点画布，亮暗两套主题 |
| `packages/shared` | zod 契约、错误码、对话失败文案 |
| `supabase/migrations` | 49 份数据库迁移 |
| `deploy/` | 自建 Supabase 部署生成器、Nginx 模板、备份与告警；`deploy/xy2api-lab` 是 xy2api 契约实验室和模拟上游 |

源码保留 `@loomic/*` 包名，避免破坏依赖。

## 开发与检查

Node.js 22，pnpm 10.26.2。配置从 `.env.example` 复制到私有的 `.env.local`；不要提交真实密码、Key 或令牌。

```bash
pnpm install --frozen-lockfile
pnpm --filter @loomic/shared build
pnpm turbo run typecheck          # 8 项
pnpm --filter @loomic/server test # 748 项
pnpm --filter @loomic/web test    # 296 项
pnpm --filter @loomic/shared test # 60 项
pnpm test:workspace               # 10 项
pnpm test:selfhost                # 37 项通过，2 项跳过（真实 nginx，在 CI 里跑）
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

# XY-image

基于 [Loomic](https://github.com/fancyboi999/Loomic) 二次开发的图像创作项目，接入 xy2api 主站账号、用户 API Key 和主站计费。

**当前状态：后端已实现，前端适配及真实环境验收待完成，尚未生产上线。**

## 已实现

- 主站邮箱密码、TOTP 和 Turnstile 登录，Supabase 影子账号与会话联动。
- 用户 Key 加密同步、选择、模型能力检查和美元余额读取。
- OpenAI Images / Gemini 原生生图协议，参考图与 1K/2K 画质。
- 同步画布生图、异步 Worker 任务及用户级 Agent 对话。
- 余额与并发守卫、单轮生图限额、持久化防重放和计费状态记录。
- 停用旧平台凭据、本地积分、支付、视频及匿名运行入口。

前端仍保留上游界面，下一执行方需完成登录、账户、余额、模型选择与旧入口清理。仓库和包名不同：源码保留 `@loomic/*` 包名，避免破坏现有依赖。

## 开发与检查

Node.js 22，pnpm 10.26.2。配置从 `.env.example` 复制至私有 `.env.local`；不要提交真实密码、Key 或令牌。

```bash
pnpm install --frozen-lockfile
pnpm --filter @loomic/shared build
pnpm --filter @loomic/shared typecheck
pnpm --filter @loomic/server typecheck
pnpm --filter @loomic/server test
pnpm --filter @loomic/server dev
```

`dev` 同时启动 API 和 Worker，需要真实 Supabase 数据库及集成配置。GitHub 后端 CI 不需要生产凭据。已有服务端 108 项测试通过；shared 另有一项上游既有测试失败，详见交付记录。

## 文档

- [完整后端交付记录](HANDOFF_RESULT.md)
- [前端接口与 F1–F8 开发交接](docs/XY2API_FRONTEND_HANDOFF.md)
- [迁移、部署、真实付费预检与上线验收](docs/XY2API_OPERATIONS.md)
- [独立仓库来源与 GitHub 配置](docs/REPOSITORY.md)

## 来源与许可

来源快照：Loomic `feat/xy2api-sso-billing@a5fe573`。新仓库使用独立提交历史；xy2api 主站没有代码改动。原 Loomic 的 MIT License 和版权声明完整保留，见 [LICENSE](LICENSE)。

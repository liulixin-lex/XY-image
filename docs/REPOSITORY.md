# XY-image 仓库说明

- GitHub：`https://github.com/liulixin-lex/XY-image`，私有仓库。
- 本地目录：`/image/XY-image`，默认分支 `main`。
- 基于 `/image/Loomic` 的 `feat/xy2api-sso-billing@a5fe573` 当前提交快照创建；原项目与 xy2api 主站均未改动。
- 独立仓库采用新的提交历史；原 Loomic 545 个历史提交不导入。保留原 MIT LICENSE 和版权声明。
- GitHub 后端 CI 使用 Node 22、pnpm 10.26.2，执行 shared 构建/类型检查与 server 类型检查/测试；使用只读仓库权限，不需要生产 secrets。
- 当前 shared 测试有一项可在上游基线复现的 LangGraph 类型断言失败，故暂未加入此 CI。前端仍待下一执行方开发，其测试也不计作后端通过。
- 上游调试脚本 `scripts/debug-session.ts` 移除了内置 Supabase 凭据，改为从私有环境读取。真实 `.env`、凭据及构建产物不提交。
- 包名与源码仍使用 `@loomic/*`，前端仍显示原品牌；GitHub 仓库名变更不等同于前端品牌开发。

GitHub 项目代码已上传，不代表服务已部署。前端适配、真实 Supabase/xy2api 配置、付费预检及生产验收的剩余项见 HANDOFF_RESULT.md 和 docs/XY2API_OPERATIONS.md。

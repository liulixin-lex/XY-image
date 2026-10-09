# xy2api 契约实验室

在本机或 CI 里跑一套真实 xy2api（固定版本），加上 PostgreSQL、Redis 和一个模拟上游。用它建测试账号、录下 xy2api 的真实接口，交给 `contract.replay.test.ts` 回放。所有生图和对话都只到模拟上游，不会产生付费调用，也不连接 gguuai.com。

原理和升级流程见 [docs/XY2API_COMPAT.md](../../docs/XY2API_COMPAT.md)。

## 文件

| 文件 | 作用 |
| --- | --- |
| `lab.sh` | 入口：`up`、`seed`、`record`、`version`、`logs`、`down`、`all` |
| `compose.yml` | 模拟上游（单独使用时可接入其他 docker 网络） |
| `compose.gateway.yml` | xy2api、PostgreSQL、Redis，镜像 `ghcr.io/liulixin-lex/xy2api:${XY2API_TAG}` |
| `mock-upstream.mjs` | 零依赖模拟上游，提供 OpenAI 和 Gemini 两种格式，支持故障注入 |
| `seed.mjs` | 幂等建号：分组、上游账号、4 个测试用户及其 Key |
| `record-fixtures.mjs` | 录制 55 个场景和 `billing.json`，并脱敏 |
| `diff-fixtures.mjs` | 比较两套录制的结构差异，输出 Markdown |
| `plan-tags.mjs` | CI 用，决定要录哪些 tag |
| `lib.mjs` | 共用的 API 封装、TOTP 和登录逻辑 |

## 快速开始

需要 Docker（带 Compose v2）、Node 22 和 openssl。

```bash
export XY2API_TAG=0.2.5                       # 或 latest、0.2.2
export XY2API_LAB_ACCEPT_ADMIN_COMPLIANCE=1   # 见下方“合规承诺”
deploy/xy2api-lab/lab.sh all                  # 依次执行 up、seed、record
deploy/xy2api-lab/lab.sh version              # 正在运行的 xy2api 版本
deploy/xy2api-lab/lab.sh logs xy2api          # 最近 200 行日志（LOGS_TAIL 可调）
deploy/xy2api-lab/lab.sh down                 # 删除容器和数据卷
```

回放刚录好的结果：

```bash
XY2API_FIXTURES_DIR=<状态目录>/fixtures/<版本> \
  pnpm --filter @loomic/server exec vitest run src/features/xy2api/contract.replay.test.ts
```

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `XY2API_TAG` | 必填 | 镜像 tag，不带 `v`，例如 `0.2.5` |
| `XY2API_LAB_DIR` | `${RUNNER_TEMP:-~/.cache}/xy2api-lab-<tag>` | 状态目录（权限 700）：`lab.env`、`accounts.json`、`fixtures/` |
| `XY2API_PORT` / `MOCK_PORT` | 18180 / 18190 | 只监听 127.0.0.1。同时跑多个版本时要错开 |
| `XY2API_FIXTURES_OUT` | `<状态目录>/fixtures` | 录制输出的父目录，会在下面建 `<版本>/` 子目录 |
| `XY2API_LAB_ACCEPT_ADMIN_COMPLIANCE` | 未设置 | 设为 `1` 才会在实验室实例上接受合规承诺 |
| `MOCK_CHAT_MODELS` / `MOCK_IMAGE_MODELS` / `MOCK_GEMINI_MODELS` | 见 `mock-upstream.mjs` | 模拟上游认可的模型。不认识的图像或 Gemini 模型返回 404，与真实上游一致 |

`lab.env` 在第一次运行时生成（权限 600），里面是随机的数据库密码、JWT 密钥、TOTP 密钥、管理员密码和上游 Key。这个文件不提交，也不会打印到日志。

## 合规承诺

xy2api 0.2.x 要求管理员先接受部署合规承诺，否则管理接口一律返回 423，建号也就做不了。`seed.mjs` 会从实例读取当前承诺的原文和确认短语，只在设置了 `XY2API_LAB_ACCEPT_ADMIN_COMPLIANCE=1` 时提交确认，并且只针对这台一次性实验室实例。请先读过承诺再设置。CI 中对应的是仓库变量 `XY2API_LAB_ACCEPT_ADMIN_COMPLIANCE`。

## 测试账号

| 用户 | 余额 | 用途 |
| --- | --- | --- |
| `lab-a@xy-lab.test` | 50 | 正常路径、计费证据 |
| `lab-broke@xy-lab.test` | 0 | 余额不足 |
| `lab-2fa@xy-lab.test` | 50 | TOTP 登录 |
| `lab-off@xy-lab.test` | 1 | 录制时会被停用，用来测停用用户 |

每个用户各有 3 个 Key：`openai`、`gemini`、`faults`。`faults` 单独对应一个上游账号，因为故障场景会让账号进入冷却，不能影响其他场景。账号、密码和 Key 都写在 `accounts.json`（权限 600）。

## 模拟上游的故障指令

把指令写进提示词，或者写进最后一条用户消息：

| 指令 | 效果 |
| --- | --- |
| `[[mock:status=429]]` | 返回该 HTTP 状态码，错误体为 OpenAI 或 Gemini 格式 |
| `[[mock:safety]]` | 内容审核拒绝：OpenAI 返回 400，Gemini 返回 200 加 `blockReason` |
| `[[mock:empty]]` | 返回 200，但没有图片或内容 |
| `[[mock:delay=1500]]` | 延迟指定毫秒后再回复 |

`GET /__mock/requests` 返回最近 200 条请求摘要（只有方法、路径、模型、状态码，不含密钥），`DELETE` 清空。

## 脱敏

`record-fixtures.mjs` 写文件前会做这些处理：

- token 换成只含 `exp`/`iat` 的无签名 JWT；
- Key 换成 `sk-fixtureNNNN…`，长度不变；
- 密码、2FA 密钥和临时令牌换成占位符；
- TOTP 换成 `000000`；
- 图片缩成 8×8；
- 响应头只保留 `content-type`、`x-request-id`、`x-client-request-id`、`retry-after`。

测试邮箱都在 `xy-lab.test` 域下。新增录制场景后，提交前先 grep 一遍有没有遗漏。

## 排障

- **`503 No available compatible accounts`**：上游刚返回过 429、5xx 或空结果，账号正在冷却（约 1 分钟），等它过去即可。录制器每个故障场景前都会等账号恢复。
- **`423 ADMIN_COMPLIANCE_ACK_REQUIRED`**：没有设置 `XY2API_LAB_ACCEPT_ADMIN_COMPLIANCE=1`。
- **`up` 超时**：执行 `lab.sh logs xy2api`。常见原因是端口被占用，或者镜像 tag 不存在（tag 不带 `v`）。
- **查看合并后的 compose 配置**：用 `docker compose … config --quiet` 校验，不要打印完整配置，否则会带出密钥。

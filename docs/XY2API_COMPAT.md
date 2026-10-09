# xy2api 版本兼容

更新于 2026-10-09（agent01）。主站 xy2api 几天就发一个版本，本文说明本站如何做到主站升级不影响登录、Key 和生图，以及主站升级时要做什么。

## 一句话

本站对 xy2api 的依赖全部收在一个适配层里。读响应时宽容：不认识的字段一律忽略，缺了非关键字段就补默认值并记日志。运行中如果遇到没验证过的主站版本，只告警不停服。一个版本要先在实验室里用真实 xy2api 镜像录下接口、回放通过适配层，才进入"已验证"列表。CI 每天对最新镜像做一遍。

## 依赖分层

| 层 | 接口 | 谁定义格式 | 代码 |
| --- | --- | --- | --- |
| A 网关标准接口 | `/v1/models`、`/v1/images/generations`、`/v1/images/edits`、`/v1/chat/completions`、`/v1/responses`、`/v1beta/models/{m}:generateContent` | OpenAI / Gemini 官方格式，xy2api 透传 | `generation/providers/xy2api-*.ts`、`client.listModels` |
| B 主站 Web API | `/api/v1/auth/*`、`/api/v1/settings/public`、`/api/v1/keys`、`/api/v1/user/totp/*` | xy2api 自定义，最可能变化 | `features/xy2api/client.ts` |
| C xy2api 专有网关扩展 | `/v1/usage` | xy2api 自定义 | `client.getUsage` |

B 层用到的 Key 和用量接口：`GET /api/v1/keys`（列表）、`GET /api/v1/keys/:id`（列表给掩码时补取，`client.getKey`）、`GET /api/v1/usage`（“待核对”自动核对，`client.findUsage`，参数 `page`、`page_size`、`start_date`、`end_date`、`timezone`、`api_key_id`）。0.2.2 和 0.2.5 的源码里这几个接口和参数相同。

规则：

- 只有 `client.ts` 认识 B、C 两层的路径和 JSON；错误归类集中在 `errors.ts`。其他代码只用这两处导出的类型。新功能优先用 A 层。
- 后端不调用主站管理接口（`/api/v1/admin/*`）。只有实验室的建号脚本会调用。
- 网关请求只发送一次，不自动重试。`unknown` 表示"待核对"，`balance: null` 不等于余额为 0。兼容层不改变这些计费规则。

## 宽容读取

`client.ts` 用 zod 解析，但不开 strict 模式：

- **不认识的字段忽略**。只有真正用到的字段才是必需的，比如用户 id 和邮箱、`access_token`、Key 的 id 和明文。
- **可选字段补默认值，并记录漂移**。`user.status` 缺失时按 `active` 处理。`refresh_token` 缺失时保留旧的。`expires_in` 缺失时先读 JWT 的 `exp`，读不到再按 900 秒处理。每次补值都调用 `reportWireDrift()`，日志格式是 `[xy2api-compat] wire drift scope=… detail=…`，同一个键 10 分钟内最多打印一条，计数照常累加。
- **信封宽容**。`code` 为 `0` 或 `"0"` 都算成功。没有 `code` 但响应体是对象时，照常接受并记录漂移。响应体不是对象时报 `INVALID_RESPONSE`。
- **列表逐条解析**。Key 列表里坏掉的条目会跳过并记录漂移，不会让整页失败。分页依次看 `pages`、`total`，都没有时以短页为准。
- **掩码 Key**。0.2.2 和 0.2.5 的列表都返回完整 Key。如果以后列表只给掩码（含 `*`、`•`、`…`、`...`，或长度小于 16），同步时逐个调用 `GET /api/v1/keys/:id` 取完整值（每次同步最多 20 个，三个并发）。单个接口也只给掩码时，沿用上次同步存下的完整 Key：xy2api 不会改同一个 Key ID 背后的值，万一改了，下一步拉模型列表会失败，Key 照常标为不可用。都没有时标为 `key_unavailable` 并告警，绝不拿掩码去请求网关。日志：`arrived masked from the key list`、`using the copy from the last full sync`。
- **用量记录**。按请求 ID 找用量记录时，记录缺 `request_id` 字段算“无法判断”（记录漂移 `usage.list request_id_missing`），只有完整翻完、每条都能读才算“没有记录”。日期按 UTC 传，并前后各多查一天，防止新版本不认 `timezone` 参数时漏掉跨日记录。
- **错误识别**。先看错误 id。id 是通用值（比如 `FORBIDDEN`）时，再按消息文本兜底，覆盖余额不足、Key 停用、Key 无效、用户停用、IP 拒绝五种情况。
- **模型列表**。`{data:[{id}]}` 和 `{models:[{name}]}` 两种格式都接受。
- **验证码**。主站启用了本站不支持的验证码类型（`*captcha*_enabled` 中除腾讯、阿里外的任何一种）时，直接提示"请联系管理员"，不发注定失败的登录请求。

## 版本探针

`compat.ts` 在启动时和之后每 30 分钟读一次 `/api/v1/settings/public` 里的 `version`：

- 版本在 `XY2API_VERIFIED_VERSIONS` 里：打 info 日志。
- 版本不在列表里：打 warn 日志 `[xy2api-compat] … unverified`。如果比所有已验证版本都新，`ahead=true`。

只告警、不拦截是有意的。主站升级不该让本站停服，靠宽容读取、漂移日志和 CI 预警兜住。看到 unverified 告警或漂移日志，就按下面的升级流程录一遍。

## 契约实验室与回放

- `deploy/xy2api-lab/`：真实 xy2api 镜像、PostgreSQL、Redis 加一个模拟上游。全程不产生付费调用。用法见 [实验室手册](../deploy/xy2api-lab/README.md)。
- `record-fixtures.mjs` 录制 55 个场景，覆盖登录、2FA、刷新、退出、Key 各种状态、模型、用量、生图、改图、Gemini、对话和 6 种上游故障。另外写一份 `billing.json`，按 xy2api 用量记录说明每个请求有没有被扣费。录制结果会脱敏：token 换成无签名占位符，Key、密码、TOTP 换成占位值，图片缩成 8×8。
- `apps/server/src/features/xy2api/contract.replay.test.ts` 把每个版本的录制结果交给真实的 `Xy2apiClient`、OpenAI SDK 和 Gemini 解析路径回放，检查以下几点：
  - 登录、2FA、刷新、Key、模型发现、余额都能读出来。
  - 每个网关错误都落到预期的错误码。新录到的错误场景如果没写预期，测试直接失败。
  - 报"未扣费"的场景，必须与 `billing.json` 一致。
  - 主站实际扣了费的错误，绝不能报"未扣费"。
- `__fixtures__/` 下的版本目录必须与 `XY2API_VERIFIED_VERSIONS` 完全一致，由测试检查。

## 升级流程

**自动**：`.github/workflows/xy2api-contract.yml`。每天跑一次，也可以手动触发，PR 改到适配层或实验室时也会跑。每次录制并回放两个版本：最新的已验证版本和 `latest`，手动触发时还可以加一个指定 tag。运行摘要会写明版本是否已验证，以及与基线的结构差异。只因数据不同造成的差异，比如空数组、空值，会计数但不算漂移。

前提：给实验室建号就是在这台一次性实例上接受 xy2api 的管理员合规承诺。维护者读过承诺后，需要把仓库变量 `XY2API_LAB_ACCEPT_ADMIN_COMPLIANCE` 设为 `1`。没设置时，这个 workflow 会整体跳过。

**手工**：在生产主站升级、CI 报告未验证版本或日志出现漂移时执行。

1. `XY2API_TAG=<版本> XY2API_LAB_ACCEPT_ADMIN_COMPLIANCE=1 deploy/xy2api-lab/lab.sh all`
2. `node deploy/xy2api-lab/diff-fixtures.mjs apps/server/src/features/xy2api/__fixtures__/<最新已验证> <状态目录>/fixtures/<版本>`，先看结构上哪里变了。
3. `XY2API_FIXTURES_DIR=<状态目录>/fixtures/<版本> pnpm --filter @loomic/server exec vitest run src/features/xy2api/contract.replay.test.ts`
4. 失败就修适配层，直到新旧版本都通过。优先放宽读取，**不要按版本号写分支**。
5. 通过后，把录制目录复制到 `__fixtures__/<版本>`，把版本号加进 `XY2API_VERIFIED_VERSIONS`，提交。
6. 旧版本的录制保留，直到确认生产主站不再运行它。删除时目录和列表一起删。
7. `lab.sh down`

## 已验证版本

| 版本 | 说明 |
| --- | --- |
| 0.2.2 | 适配层最初对照的源码提交 `9717116f1` 就是这个版本 |
| 0.2.5 | 兼容层落地时的最新版本，也是当时的 `latest` |

两个版本的录制只有一处不同：Gemini 请求不存在的模型时，返回的状态码不一样（见下文）。

**生产主站 gguuai.com 跑的是 0.2.5**（2026-10-09 读 `/api/v1/settings/public` 确认）。主站每次升级后都要重新读一次 `version`；如果不在列表里，先录制。

同一接口还显示，生产主站开着 Turnstile、内容审计（`risk_control_enabled`）和 TOTP，两种国内验证码都没开。下面的"内容审计"和"Turnstile"两条与上线直接相关。

## 实测行为（0.2.2 与 0.2.5 相同，除非另行注明）

- **冷却**：上游返回 429、5xx 或空的 200 后，xy2api 会让该上游账号冷却约 1 分钟。冷却期间同组所有请求都返回 `503 No available compatible accounts`，管理端的 clear-rate-limit 和 clear-error 都解不开。上游 400（包括安全拒绝）和未知模型不会触发冷却。本站不自动重试，这类错误提示"主站繁忙"。
- **计费**：生图按张收费，按分组配置的 1K/2K/4K 单价计价，不传尺寸时按 2K 算。
- **Gemini 安全拦截会扣费**：返回 200 加 `promptFeedback.blockReason` 时，主站按 1 张计费。本站把这种情况标为"待核对"（`billing: unknown`），并保存 request id。OpenAI 路径的安全拒绝（400）不扣费。
- **余额不足**：OpenAI 路径返回 403 `INSUFFICIENT_BALANCE`；Gemini 路径返回 403 `PERMISSION_DENIED`，消息是 "Insufficient account balance"，需要靠消息兜底识别。余额为 0 的账号连 `/v1/models` 和 `/v1beta/models` 也返回这个 403（先查余额，再看 Key），但 `/v1/usage` 正常返回 `balance: 0`。
- **未知模型**：xy2api 不校验模型名，会直接转发。OpenAI 生图返回 502 "Upstream request failed"。Gemini 在 0.2.2 透传上游的 404，在 0.2.5 则由计费预检返回 503 "Billing service temporarily unavailable"。两种情况都不扣费，也不冷却。本站只发送从该 Key 的 `/v1/models` 发现到的模型。
- **`/v1/models`**：返回 xy2api 内置的静态列表，不能证明上游真有这个模型。
- **Request id**：客户端传的 `X-Client-Request-ID` 会被忽略。xy2api 自己生成一个，放在响应头里返回；用量记录的 `request_id` 是 `client:<该值>`，可以用来对账。
- **会话**：refresh token 每次刷新都会换新，旧的立即失效。退出登录后 access JWT 仍可使用，有效期 24 小时，所以本站不能依赖主站退出让会话失效。
- **用量**：新账号的 `/v1/usage` 不返回 `model_stats`（Go 的 omitempty）。
- **内容审计（0.2.5，生产已开）**：提示词命中规则后，xy2api 在转发前拦截，不扣费。OpenAI 路径（生图、chat、responses）返回 `{"error":{"message":…,"type":"content_policy_violation"}}`；Gemini 路径只返回 `{"error":{"code":403,"message":…,"status":"PERMISSION_DENIED"}}`，只能靠消息识别。状态码默认 403，但管理员可以改成 400–599 之间任意值；提示文案也可以改，默认是"内容审计命中风险规则，请调整输入后重试"。主站可以开启自动封禁：同一用户被拦截满一定次数（默认 10 次）后停用账号。实验室用关键词 `xylabblockedword` 触发（`seed.mjs`），四条路径都有录制。
- **Turnstile**：xy2api 只检查 `success`，不校验 hostname，`remoteip` 填的是请求方 IP。本站代用户登录时，这个 IP 是本站后端的出口 IP。Cloudflare 的 site key 设置里，hostname 白名单必须包含生图站域名，否则前端拿不到 token。上线验收时要实测一次。
- **管理接口**：0.2.x 要先接受管理员合规承诺，否则返回 423 `ADMIN_COMPLIANCE_ACK_REQUIRED`。这只影响实验室建号。

## 回放发现并已修复的问题

- OpenAI SDK 只保留响应体里的 `error` 字段，丢掉了 xy2api 顶层的错误 id，导致 403 余额不足被归为 `upstream_unknown`。现在在 fetch 层保留原始错误体。
- Gemini 路径的余额不足被归为 `key_unavailable`。现在按消息文本兜底识别。
- Gemini 安全拦截实际扣了费，原来却报"未扣费"。现在改为"待核对"，并记录 request id。
- 实验室录制曾把测试账号密码写进 fixture。现在录制器会把密码和 TOTP 换成占位值。
- **余额为 0 的新用户被告知"先选 Key"**（lab e2e 发现，影响生产）：Key 同步时 `/v1/models` 返回 403 余额不足，同步把它当成 Key 失效。结果所有 Key 都不能生图，没有默认 Key，余额显示"未选 Key"，充值后也要手动同步。现在模型发现失败时，只有 Key 级证据（`key_unavailable`、`key_ip_restricted`、`xy2api_reauth_required`）才让 Key 失效。其他情况（余额不足、识别不了的 403、5xx、网络错误）保留该 Key 上次发现的模型（分组没变时）；从未发现过的，按平台回退到目录。Key 仍可选、自动设为默认，余额显示 $0，生图返回 402 并引导充值，不建任务、不扣费。对话模型只能靠发现，余额不足时 `/api/models` 报 `insufficient_balance`。用户充值后，`GET /api/account` 读到正余额会自动重新同步（每用户至少间隔 15 秒，进程内记录，其他实例在下次登录或手动同步时补上），前端随后重新拉对话模型。
- **内容审计的 403 被当成 Key 失效**（影响生产）：被拦截后，`image-runner` 会把用户的 Key 标为不可用，用户之后每次生图都要先重新同步 Key。现在的规则是：`content_policy_violation` 一律归为 `safety_filter`，不看状态码；只有能明确识别的 Key 问题才归为 `key_unavailable`；识别不了的 403 和其他 4xx 归为新码 `request_rejected`，不会让 Key 失效，并把主站给的原因脱敏后（去掉 `sk-…` 和长 token，最多 120 字）显示给用户。Gemini 路径的 Key 类错误也改为按消息识别（已过期、分组不可用、无订阅、额度用完、认证失败过多）。

## 错误归类原则

- 只有拿到明确证据（错误 id 或已知消息），才把错误归为 `key_unavailable` 或 `key_ip_restricted`，因为这两类会让 Key 失效。Key 同步发现模型时同理：拿不到模型列表不等于 Key 坏了。
- 内容审计和安全拦截一律归为 `safety_filter`，按状态码、type 或消息任意一项识别。
- 识别不了的拒绝归为 `request_rejected`，提示用户到主站查看，不改动 Key 或账号状态。新版本出现新的错误 id 时，回放测试"every recorded gateway error has an expected mapping"会失败，提醒补规则。

## 待办

- 主站还没响应就超时的“待核对”任务没有请求 ID（xy2api 不接受客户端自带的 ID），仍需用户到主站核对。若以后 xy2api 接受客户端请求 ID，可在发请求前生成并保存，再交给 `billing-reconciler.ts` 核对。
- 每日契约 CI 已于 10-09 开启（仓库变量 `XY2API_LAB_ACCEPT_ADMIN_COMPLIANCE=1`）。

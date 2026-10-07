# xy2api 后端接口交接：供前端开发接续

依据 2026-10-07 交接规范及用户追加指示：本分支仅实现后端，`apps/web` 没有改动。现有页面尚未适配，不能作为完整生图站发布。前端请按原规范 F1–F8 实施，以下以已实现后端为准。

## 连接与会话

浏览器只调用 Loomic API；主站仅用于打开注册、找回密码、充值、Key 管理、用量页面。API 与 Worker 使用同一 Supabase 项目和同一 `LOOMIC_SECRET_KEY`。

前端构建环境：

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<public-anon-key>
NEXT_PUBLIC_SERVER_BASE_URL=https://draw-api.example.com
NEXT_PUBLIC_XY2API_WEB_URL=https://api.example.com
```

请由前端执行方更新 `apps/web/.env.local.example`、`lib/env.ts`、`next.config.ts`；本次没有修改这些文件。后端 `LOOMIC_WEB_ORIGIN` 必须等于浏览器页面的 origin。允许该 origin 读取 `Retry-After`。

除公开登录配置、登录和健康检查外，本文接口均带 `Authorization: Bearer <Supabase access_token>`。不能发送主站 JWT 或主站 API Key。普通 Supabase 用户即使登录成功也不能访问，需要影子账号的 `app_metadata.provider = xy2api` 和有效映射。

受保护接口返回 401 时触发一次 `loomic:auth-expired`，本地退出并跳转 `/login?reason=expired`；避免重复跳转和退出递归。登录接口的 `invalid_credentials` 401 是表单错误，直接展示。

## 登录

| 方法与路径 | 请求 | 成功响应 |
| --- | --- | --- |
| GET `/api/auth/xy2api/config` | 无 | `{ siteName, turnstileEnabled, turnstileSiteKey, captchaUnsupported, registerUrl, forgotPasswordUrl, egressIp }` |
| POST `/api/auth/xy2api/login` | `{ email, password, turnstileToken? }` | `{ status: "ok", tokenHash }` 或 `{ status: "2fa_required", challenge, maskedEmail }` |
| POST `/api/auth/xy2api/login/2fa` | `{ challenge, code: "123456" }` | `{ status: "ok", tokenHash }` |
| POST `/api/auth/xy2api/logout` | 带 Supabase 令牌，无 body | 204，无响应体 |

取得 `tokenHash` 后执行：

```ts
const { data, error } = await supabase.auth.verifyOtp({
  type: "magiclink",
  token_hash: result.tokenHash,
});
// Check error, fetchViewer with data.session.access_token, then navigate /home.
```

`challenge` 为 5 分钟有效的加密挑战；只放组件内存，成功后不可重放。密码、挑战和一次性 tokenHash 均不写 Local Storage 或日志。浏览器仅保留 supabase-js 自身的会话。

开启 Turnstile 时使用配置中的公钥，提交 `turnstileToken`。`captchaUnsupported=true` 时禁用登录并提示联系管理员。注册和忘记密码使用配置返回的 URL，新标签页打开。删除独立 Magic Link/Google 登录入口。

登录错误统一为 `{ error: { code, message } }`：`invalid_credentials` 401、`account_disabled` 403、`captcha_failed` 400、`two_factor_invalid` 400、`rate_limited` 429、`xy2api_unavailable` 503。429 读取 `Retry-After` 秒数。每个 IP 或邮箱 5 分钟最多 10 次尝试。

退出时先尽力调用后端 logout，再执行 `supabase.auth.signOut()`；不要因后端短暂故障阻止本地退出。

## 账户、余额和 Key

GET `/api/account`：

```json
{
  "user": { "xy2apiUserId": 7, "email": "creator@example.com", "username": "Creator" },
  "balance": { "amount": 12.5, "unit": "USD", "source": "wallet", "planName": "" },
  "preferences": {
    "user_id": "<Supabase user UUID>",
    "image_key_id": 12,
    "chat_key_id": 12,
    "default_image_model": "gpt-image-2",
    "default_chat_model": "gpt-5.4"
  },
  "links": {
    "recharge": "https://api.example.com/purchase",
    "keys": "https://api.example.com/keys",
    "usage": "https://api.example.com/usage"
  }
}
```

`balance` 可以是 `null`，表示无可用生图 Key 或余额读取暂不可用，不能显示为 $0。preferences 的四个选择字段也可为 null。**响应 preferences 是 snake_case，更新请求是 camelCase**。显示真实邮箱/用户名，不能显示合成邮箱。余额按用户及所选生图 Key 缓存 15 秒；挂载、窗口重新可见、生图完成时刷新，必要时 15 秒后再取一次。低于 $1 保留三位小数。

GET `/api/account/keys` 返回 `{ keys, preferences }`。keys 中每项只有：

```ts
type KeyMetadata = {
  keyId: number; name: string; maskedKey: string; status: string;
  groupName: string | null; platform: string | null;
  imageCapable: boolean; imageModels: string[]; chatModels: string[];
  pricing: Record<string, unknown>; quota: number; quotaUsed: number;
  expiresAt: string | null; hasIpRestriction: boolean;
  invalidReason: string | null; syncedAt: string;
};
```

`pricing` 是主站元数据，P0 不用它算账单或展示预估价。Key 的 IP 限制提示使用 auth/config 的 `egressIp`；值为空则提示联系管理员确认出口 IP。空列表提供「去主站创建」链接。

- POST `/api/account/keys/sync` 无 body，返回 `{ ok: true }`；随后重取账户、Key 列表及两类模型。同步失败保留当前选择，401 要重新登录。
- PUT `/api/account/preferences` 请求 `{ imageKeyId?, chatKeyId?, defaultImageModel?, defaultChatModel? }`，返回 `{ preferences }`。ID 为正整数，不接受 null。只发送发生变化的字段。对话模型偏好填写裸 ID（如 `gpt-5.4`），不加 `openai:`。
- 切换生图 Key 后重取 `/api/image-models`；切换对话 Key 后重取 `/api/models`。不允许选择其他用户的 Key 或不可用模型。
- P1 `/api/account/keys/create` 尚未实现，不展示该按钮。

## 模型和生图

GET `/api/models`：`{ models: [{ id: "openai:gpt-5.4", name: "gpt-5.4", provider: "openai" }] }`。

GET `/api/image-models`：

```json
{
  "models": [{
    "id": "gpt-image-2", "displayName": "GPT Image 2",
    "description": "OpenAI 图像生成与多图编辑", "provider": "xy2api-openai",
    "accessible": true, "creditCost": 0, "minTier": "free",
    "priceUsd": null, "maxQuality": "hd"
  }]
}
```

两个接口都需要令牌，仅返回当前 Key 能力；没有可用 Key 会报错，不回退到平台模型。`creditCost=0`、`minTier=free` 是兼容字段，不能理解成免费调用。实际扣费发生在主站。模型 ID 可能是 `*-preview` 别名，必须原样回传；切换 Key 后旧选择不在列表则选第一项。列表为空时禁用生成。

画质只显示 `standard`「1K 标准」和 `hd`「2K 高清」。`maxQuality=standard` 时禁用 2K。提交 `ultra` 会失败；超出模型能力的 hd 会降为 standard。默认目录：

| 模型 | 最大画质 | 参考图上限 |
| --- | --- | --- |
| gpt-image-2 | hd | 10 |
| gpt-image-1.5 | standard | 10 |
| gemini-3-pro-image / preview 别名 | hd | 14 |
| gemini-3.1-flash-image / preview 别名 | hd | 14 |
| gemini-2.5-flash-image / preview 别名 | hd | 14 |
| grok-imagine-image | standard | 0 |

目录可以由部署配置覆盖；后端始终重新校验能力。参考图接受 PNG/JPEG/WebP 的 data URL 或当前 Supabase 项目的 Storage URL，单张最多 10 MiB；普通公网图片 URL 需先走已有素材上传流程。HTTP 请求体最多 20 MiB。

同步画布接口 POST `/api/agent/generate-image` 保留：

```json
{ "prompt": "一颗红苹果，纯白背景", "model": "gpt-image-2", "quality": "hd", "aspectRatio": "1:1", "inputImages": [] }
```

返回 `{ url, assetId, prompt, mimeType, width, height }`，前端按原流程插入画布。model/quality/比例/参考图可省略，prompt 长度 1–4000。比例支持 `1:1`、`16:9`、`9:16`、`4:3`、`3:4`。调用可能持续十分钟；客户端和代理不能使用过短超时。**超时不自动重发，也不因 UI 重新挂载而重发。**

异步接口 POST `/api/jobs/image-generation` 使用 snake_case：`{ prompt, model?, quality?, aspect_ratio?, input_images?, project_id?, canvas_id?, session_id?, thread_id? }`。成功 201 `{ job }`。GET `/api/jobs/:jobId` 及 GET `/api/jobs` 保持原响应；POST `/api/jobs/:jobId/cancel` 只对未开始任务有效。HTTP 任务响应增加 `billing_status` 和 `xy2api_request_id`，没有密钥信息。停止 Agent 不代表已发送请求被取消或退款。

默认每用户 queued + running 最多 2 项，每轮 Agent 最多 6 次生图。队列和同步画布共用守卫。成功 `status=succeeded`、`billing_status=charged`；失败通常进入 `dead_letter`。`pending`/`unknown` 表示需核对主站用量，不能根据任务失败就认定没扣费。`storage_failed` 表示上游已生成，可能已扣费，不能自动重试生成。任务结果仍有 `asset_id`、`signed_url`、`object_path`、尺寸和 MIME；该 URL 来自已有公开 project-assets 桶。

## Agent 与错误处理

`POST /api/agent/runs` 必须登录；WebSocket 仍用 `/api/ws?token=<Supabase access_token>`。只可运行或恢复自己有权访问的画布。每次 `agent.run` 可以带最新 Supabase `accessToken`；连接每 30 秒复核，关闭码 4001 应触发会话过期处理。反向代理日志也应只记录路径，不能记录查询串。

保留原事件流、任务轮询/Realtime 和 `canvas.sync`。`billing.error` 新增错误码及可选 `balance`、`rechargeUrl`；这两个字段可能不存在，可从 `/api/account` 补全。Agent 无可用对话 Key 时发出 billing.error 并停止。模型从工作区选择与当前 Key 能力中解析；不能恢复平台公用 Key。

| error.code | 前端处理 |
| --- | --- |
| insufficient_balance | 「主站余额不足」，打开 links.recharge |
| key_unavailable / key_quota_exhausted | 引导同步、切换 Key 或到主站调整 |
| key_ip_restricted | 显示出口 IP，打开主站 Key 管理 |
| xy2api_reauth_required / 受保护接口 401 | 本地退出并返回登录 |
| model_not_accessible | 重新读取当前模型列表 |
| concurrency_limit | 等待现有任务结束 |
| run_image_limit | 告知本轮已达上限，需要新一轮 |
| rate_limited / upstream_busy | 提示稍后由用户主动尝试，不自动重发生成 |
| invalid_input / safety_filter | 展示安全错误文案，引导修改输入 |
| upstream_too_large | 降低画质后由用户主动提交 |
| upstream_unknown | 「可能已扣费」，先去主站核对用量 |
| storage_failed | 「图片已生成但保存失败」，联系管理员核对用量 |

请按 code 分流，不只按 HTTP 状态码：网关类错误通过安全映射后可能使用 502。登录与账户管理的暂时故障使用 503。HTTP 错误、`billing.error`、任务 `error_code` 都要接到错误 UI。

## F1–F8 待办与联调门槛

1. 实现上述 API 客户端、授权参数和会话过期事件。
2. 替换登录表单，覆盖普通登录、TOTP、Turnstile、错误密码和限流。
3. 注册跳转主站，保留回调页；下线 Google/Magic Link 的直接入口。
4. 接入后端退出和防重入过期处理。
5. 用真实美元余额替换积分、套餐徽章、每日领取；接入全部错误入口。
6. 完成账户与 Key 设置、同步、选择、出口 IP 提示和主站链接。
7. 授权动态模型列表，仅 1K/2K；切 Key 后重置失效选择。
8. 下线视频、4K、定价订阅和本地注册入口。旧 credits/payments/video 接口已经不再提供；原有前端仍引用它们，必须完成替换。

前端模型接手后执行原规范第 9 节：web 类型检查不新增基线错误，更新登录测试，web build 产出 out，并用真实账号验证两种生图协议和 Agent。真实主站生成次数、余额变化、request ID 必须人工逐条核对。浏览器仅保留 Supabase 会话，不能出现主站 Key/JWT。

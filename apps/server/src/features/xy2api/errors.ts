export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

// Ids that only describe the transport/category (Gemini `error.status`, OpenAI
// `error.type`) and say nothing about *why* xy2api refused. When that is all a
// response carries, the message is the only signal left — e.g. xy2api 0.2.5
// answers Gemini-format insufficient balance with
// 403 {"error":{"code":403,"status":"PERMISSION_DENIED","message":"Insufficient account balance"}}.
const GENERIC_ERROR_IDS = new Set([
  "UNKNOWN",
  "PERMISSION_DENIED",
  "UNAUTHENTICATED",
  "INVALID_ARGUMENT",
  "FAILED_PRECONDITION",
  "NOT_FOUND",
  "INTERNAL",
  "UNAVAILABLE",
  "RESOURCE_EXHAUSTED",
  "api_error",
  "invalid_request_error",
  "authentication_error",
  "permission_error",
]);
// Wording from xy2api's Gemini-format key auth (api_key_auth_google.go, 0.2.5),
// which drops the ids its OpenAI-format twin sends.
const MESSAGE_ERROR_IDS: [RegExp, string][] = [
  [/insufficient (account )?balance/i, "INSUFFICIENT_BALANCE"],
  [/api key is disabled/i, "API_KEY_DISABLED"],
  [/invalid api key/i, "INVALID_API_KEY"],
  [/api key is required/i, "API_KEY_REQUIRED"],
  [/api key (已过期|has expired|expired)/i, "API_KEY_EXPIRED"],
  [/专属分组不再允许|group is not allowed/i, "GROUP_NOT_ALLOWED"],
  [/no active subscription/i, "SUBSCRIPTION_NOT_FOUND"],
  [/额度已用完|quota (is )?(exhausted|exceeded)/i, "API_KEY_QUOTA_EXHAUSTED"],
  [/too many invalid authentication attempts/i, "INVALID_AUTH_RATE_LIMITED"],
  [/user associated with api key not found/i, "USER_NOT_FOUND"],
  [/user (account )?is not active/i, "USER_INACTIVE"],
  [/^access denied/i, "ACCESS_DENIED"],
  // xy2api risk control (content moderation). Gemini-format blocks carry only
  // the admin-configurable block message; this matches the default
  // "内容审计命中风险规则，请调整输入后重试" and common English wording.
  [
    /内容审计|风险规则|content (moderation|policy)/i,
    "content_policy_violation",
  ],
];

const SAFETY_PATTERN = /safety|content_policy|moderation/i;

// Positive evidence that this key (or its group/subscription) cannot be used:
// the only refusals allowed to mark a key invalid. Ids from xy2api 0.2.5
// middleware/api_key_auth.go.
const KEY_UNUSABLE_IDS = new Set([
  "INVALID_API_KEY",
  "API_KEY_DISABLED",
  "API_KEY_EXPIRED",
  "API_KEY_REQUIRED",
  "GROUP_DELETED",
  "GROUP_DISABLED",
  "GROUP_NOT_ALLOWED",
  "SUBSCRIPTION_NOT_FOUND",
  "SUBSCRIPTION_INVALID",
]);

// Main-site text shown to the user for refusals we cannot classify. xy2api
// messages are operator/system wording, but strip anything key-like anyway.
function mainSiteDetail(message: string): string {
  return message
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\bsk-[\w-]{6,}/gi, "sk-***")
    .replace(/[A-Za-z0-9_+/=-]{32,}/g, "***")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export function extractXy2apiErrorId(_status: number, body: unknown): string {
  const b = record(body);
  const e = record(b.error);
  let id = "UNKNOWN";
  for (const value of [b.reason, b.code, e.code, e.type, b.error, e.status]) {
    if (typeof value === "string" && value) {
      id = value;
      break;
    }
  }
  if (!GENERIC_ERROR_IDS.has(id)) return id;
  const message = [b.message, e.message].find(
    (value): value is string => typeof value === "string",
  );
  const matched = message
    ? MESSAGE_ERROR_IDS.find(([pattern]) => pattern.test(message))
    : undefined;
  return matched?.[1] ?? id;
}

export const gatewayMessages = {
  key_unavailable: "当前 Key 不可用，请到设置页同步或切换 Key",
  xy2api_reauth_required: "登录已过期，请重新登录",
  key_ip_restricted: "当前 Key 设置了 IP 限制，请在主站放行生图站出口 IP",
  insufficient_balance: "主站余额不足，请充值后重试",
  model_not_accessible: "当前 Key 无权使用此模型",
  key_quota_exhausted: "当前 Key 额度已用完，请切换 Key 或去主站调整",
  rate_limited: "请求过于频繁，请稍后再试",
  invalid_input: "生成参数无效，请检查输入",
  safety_filter: "内容未通过审核，请修改提示词",
  request_rejected: "主站拒绝了这次请求，请到主站查看账号和 Key 状态",
  upstream_busy: "主站暂时繁忙，请稍后再试",
  upstream_too_large: "图片响应过大，请降低画质后重试",
  upstream_unknown: "请求中断，可能已扣费，请先到主站用量页核对",
  run_image_limit: "本轮生图次数已达上限，请开启新一轮对话",
  concurrency_limit: "当前生图任务已达上限，请等待完成",
  storage_failed: "图片已生成但保存失败，请联系管理员并到主站核对用量",
  storage_retrying: "图片已生成并扣费，正在重新保存，稍后会出现在生成记录里",
} as const;
export type GatewayCode = keyof typeof gatewayMessages;
export type GatewayFailure = {
  code: GatewayCode;
  retryable: boolean;
  billing: "not_charged" | "unknown";
  userMessage: string;
  /** xy2api X-Client-Request-ID; usage records are keyed "client:<id>" */
  requestId?: string;
};

export function mapGatewayError(input: {
  status?: number | undefined;
  body?: unknown;
  responseReceived?: boolean;
}): GatewayFailure {
  const { status, body } = input;
  const id = extractXy2apiErrorId(status ?? 0, body);
  const b = record(body);
  const e = record(b.error);
  const message = String(b.message ?? e.message ?? "");
  let code: GatewayCode = "upstream_unknown";
  let retryable = false;
  const known = Boolean(
    status && (input.responseReceived ?? body !== undefined),
  );
  if (known) {
    // xy2api risk control blocks with error type content_policy_violation and
    // an admin-chosen status (default 403, any of 400-599).
    if (id === "content_policy_violation") code = "safety_filter";
    else if (status === 401 && ["USER_INACTIVE", "USER_NOT_FOUND"].includes(id))
      code = "xy2api_reauth_required";
    else if ((status === 401 || status === 403) && KEY_UNUSABLE_IDS.has(id))
      code = "key_unavailable";
    else if (status === 403 && id === "ACCESS_DENIED")
      code = "key_ip_restricted";
    else if (status === 403 && id === "INSUFFICIENT_BALANCE")
      code = "insufficient_balance";
    else if (
      status === 403 &&
      (id === "permission_error" || e.type === "permission_error")
    )
      code = "model_not_accessible";
    else if (
      status &&
      status >= 400 &&
      status < 500 &&
      status !== 401 &&
      status !== 429 &&
      SAFETY_PATTERN.test(`${id} ${String(e.type ?? "")} ${message}`)
    )
      code = "safety_filter";
    // Only positive evidence may mark a key unusable (image-runner calls
    // markKeyInvalid for key_unavailable). An unrecognised 403 is a refusal
    // with a reason we do not know yet — show the main site's own words.
    else if (status === 403) code = "request_rejected";
    else if (
      status === 429 &&
      [
        "API_KEY_QUOTA_EXHAUSTED",
        "insufficient_quota",
        "USAGE_LIMIT_EXCEEDED",
      ].includes(id)
    )
      code = "key_quota_exhausted";
    else if (status === 429) {
      code = "rate_limited";
      retryable = true;
    } else if (status === 400 || status === 413 || status === 422)
      code = "invalid_input";
    else if (status === 404)
      // e.g. "Images API is not supported for this platform": the key's group
      // cannot serve this endpoint/model.
      code = "model_not_accessible";
    else if (status === 502 && /Upstream response too large/i.test(message))
      code = "upstream_too_large";
    else if (status && status >= 500) {
      code = "upstream_busy";
      retryable = true;
    } else if (status === 401) code = "key_unavailable";
    else code = "request_rejected";
  }
  const detail = code === "request_rejected" ? mainSiteDetail(message) : "";
  return {
    code,
    retryable,
    billing: known ? "not_charged" : "unknown",
    userMessage: detail
      ? `主站拒绝了这次请求：${detail}`
      : gatewayMessages[code],
  };
}

export class BillingGuardError extends Error {
  constructor(
    readonly code: GatewayCode,
    readonly statusCode = 400,
    message: string = gatewayMessages[code],
  ) {
    super(message);
    this.name = "BillingGuardError";
  }
}

/**
 * Not a failure: the image is charged and held in xy2api_pending_deliveries
 * because storage refused it. The worker retries the upload after
 * `retryInSeconds` (M6); xy2api is never called again.
 */
export class DeliveryPendingError extends BillingGuardError {
  constructor(readonly retryInSeconds: number) {
    super("storage_retrying", 502);
    this.name = "DeliveryPendingError";
  }
}

export class GatewayError extends BillingGuardError {
  constructor(readonly failure: GatewayFailure) {
    super(
      failure.code,
      failure.code === "insufficient_balance"
        ? 402
        : failure.code === "xy2api_reauth_required"
          ? 401
          : 502,
      failure.userMessage,
    );
  }
}

export class Xy2apiError extends Error {
  constructor(
    readonly status: number,
    readonly id: string,
    readonly retryAfter = 60,
  ) {
    super("主站请求失败，请稍后再试");
    this.name = "Xy2apiError";
  }
}

export function sanitizeGatewayError(error: unknown): GatewayError {
  if (error instanceof GatewayError) return error;
  const e = record(error);
  return new GatewayError(
    mapGatewayError({
      status: typeof e.status === "number" ? e.status : undefined,
      body: e.error ? { error: e.error } : undefined,
    }),
  );
}

/**
 * xy2api answered this call (its X-Client-Request-ID arrived), so a 待核对
 * outcome can be settled later from the usage list (billing-reconciler.ts).
 * Keeps the mapped failure and adds the id.
 */
export function withRequestId(
  error: unknown,
  requestId: string | null | undefined,
): GatewayError {
  const gateway = sanitizeGatewayError(error);
  return requestId && !gateway.failure.requestId
    ? new GatewayError({ ...gateway.failure, requestId })
    : gateway;
}

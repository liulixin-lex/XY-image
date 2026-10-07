export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export function extractXy2apiErrorId(_status: number, body: unknown): string {
  const b = record(body);
  const e = record(b.error);
  for (const value of [b.reason, b.code, e.code, e.type, b.error, e.status]) {
    if (typeof value === "string") return value;
  }
  return "UNKNOWN";
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
  upstream_busy: "主站暂时繁忙，请稍后再试",
  upstream_too_large: "图片响应过大，请降低画质后重试",
  upstream_unknown: "请求中断，可能已扣费，请先到主站用量页核对",
  run_image_limit: "本轮生图次数已达上限，请开启新一轮对话",
  concurrency_limit: "当前生图任务已达上限，请等待完成",
  storage_failed: "图片已生成但保存失败，请联系管理员并到主站核对用量",
} as const;
export type GatewayCode = keyof typeof gatewayMessages;
export type GatewayFailure = {
  code: GatewayCode;
  retryable: boolean;
  billing: "not_charged" | "unknown";
  userMessage: string;
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
    if (status === 401 && ["USER_INACTIVE", "USER_NOT_FOUND"].includes(id))
      code = "xy2api_reauth_required";
    else if (
      status === 401 &&
      ["INVALID_API_KEY", "API_KEY_DISABLED"].includes(id)
    )
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
    else if (status === 403) code = "key_unavailable";
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
    } else if (status === 400)
      code = /safety|content_policy|moderation/i.test(`${id} ${message}`)
        ? "safety_filter"
        : "invalid_input";
    else if (status === 502 && /Upstream response too large/i.test(message))
      code = "upstream_too_large";
    else if (status && status >= 500) {
      code = "upstream_busy";
      retryable = true;
    } else code = "key_unavailable";
  }
  return {
    code,
    retryable,
    billing: known ? "not_charged" : "unknown",
    userMessage: gatewayMessages[code],
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

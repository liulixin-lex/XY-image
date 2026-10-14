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

// Upstream moderation refusals that xy2api passes through as a plain 400
// invalid_request_error, e.g. OpenAI's Chinese wording seen on gguuai.com
// group 20 (2026-10-11): "非常抱歉，该提示可能违反了我们的内容政策。…".
const SAFETY_PATTERN =
  /safety|content.?policy|policy.?violation|moderation|内容政策|违反.{0,12}政策|内容审核|内容安全/i;

// xy2api has no upstream account in the key's group that can serve this
// model at all (gguuai.com group 74, 2026-10-11: 503 "No available Gemini
// accounts: no available accounts supporting model: gemini-nano-banana-2.1
// (channel pricing restriction)"). Retrying never helps until the main site
// adds an account, so it must not read as "主站暂时繁忙". The bare "No
// available compatible accounts" is different: every account is cooling down
// after upstream errors (recorded in __fixtures__/*/gateway.images.after_*),
// which passes — that one stays upstream_busy.
const NO_ACCOUNT_PATTERN =
  /no available accounts? supporting model|channel pricing restriction/i;

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
  return scrub(message, 120);
}

function scrub(message: string, max: number): string {
  return message
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\bsk-[\w-]{6,}/gi, "sk-***")
    .replace(/[A-Za-z0-9_+/=-]{32,}/g, "***")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
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
  model_unavailable: "主站这个分组暂时出不了这个模型，请换一个模型或 Key",
  key_quota_exhausted: "当前 Key 额度已用完，请切换 Key 或去主站调整",
  rate_limited: "请求过于频繁，请稍后再试",
  invalid_input: "生成参数无效，请检查输入",
  safety_filter: "内容未通过审核，有时是误判，可以改一下提示词再试",
  request_rejected: "主站拒绝了这次请求，请到主站查看账号和 Key 状态",
  upstream_busy: "主站暂时繁忙，请稍后再试",
  upstream_too_large: "图片响应过大，请降低画质后重试",
  upstream_unknown: "请求中断，图片可能已经生成，请先到主站用量页核对",
  xy2api_unavailable: "暂时连不上主站，这次没有发出请求",
  run_image_limit: "本轮生图次数已达上限，请开启新一轮对话",
  concurrency_limit: "当前生图任务已达上限，请等待完成",
  storage_failed: "图片已生成但保存失败，请联系管理员并到主站核对用量",
  storage_retrying: "图片已生成，正在重新保存，稍后会出现在生成记录里",
} as const;
export type GatewayCode = keyof typeof gatewayMessages;
/**
 * What came back on the wire, for the failure log line only (L1). Never
 * holds the key or the prompt; `message` is cut and scrubbed like
 * mainSiteDetail.
 */
export type GatewayDiagnostics = {
  status?: number;
  /** xy2api error id/type, e.g. INSUFFICIENT_BALANCE, invalid_request_error */
  errorId?: string;
  message?: string;
  cfRay?: string;
  server?: string;
  contentType?: string;
  /** false: the answer did not carry xy2api's X-Client-Request-ID */
  answeredByXy2api?: boolean;
  elapsedMs?: number;
};
export type GatewayFailure = {
  code: GatewayCode;
  retryable: boolean;
  billing: "not_charged" | "unknown";
  userMessage: string;
  /** xy2api X-Client-Request-ID; usage records are keyed "client:<id>" */
  requestId?: string;
  diagnostics?: GatewayDiagnostics;
};

/**
 * The request never reached the main site, so nothing was charged: a known
 * outcome, not 待核对. See neverSent and ORIGIN_NOT_REACHED.
 */
function unavailableFailure(): GatewayFailure {
  return {
    code: "xy2api_unavailable",
    retryable: true,
    billing: "not_charged",
    userMessage: gatewayMessages.xy2api_unavailable,
  };
}

// Cloudflare answers for the main site when it could not reach it at all:
// web server down (521), connection timed out (522), origin unreachable
// (523), TLS to the origin failed (525, 526), origin DNS or route error
// (530). The request never got to xy2api. 520 and 524 did reach it (it
// answered oddly or too slowly) and stay unknown.
const ORIGIN_NOT_REACHED = new Set([521, 522, 523, 525, 526, 530]);
const ORIGIN_REACHED_NO_ANSWER = new Set([520, 524]);

// Failures before any byte of the request left this server.
const NEVER_SENT_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

/**
 * True when a fetch failed before the request was sent: connection refused,
 * DNS failure, connect timeout, TLS handshake failure. fetch reports them as
 * "fetch failed" with the system error as its cause (an AggregateError when
 * several addresses were tried); the OpenAI client wraps that once more.
 * A reset or a timeout after connecting is not here: the request may have
 * arrived, and the outcome stays unknown (待核对). The one reset that is here
 * comes before TLS was set up, so no byte of the request can have left:
 * the private route to the main site (deploy/selfhost/xy2api-route.mjs)
 * accepts the connection and closes it like this when it reaches neither the
 * main site nor Cloudflare.
 */
export function neverSent(error: unknown): boolean {
  const queue: unknown[] = [error];
  for (let seen = 0; queue.length > 0 && seen < 16; seen++) {
    const current = queue.shift();
    if (!current || typeof current !== "object") continue;
    const { code, cause, errors, message } = current as {
      code?: unknown;
      cause?: unknown;
      errors?: unknown;
      message?: unknown;
    };
    if (typeof code === "string" && NEVER_SENT_CODES.has(code)) return true;
    if (
      code === "ECONNRESET" &&
      typeof message === "string" &&
      message.includes("before secure TLS connection was established")
    )
      return true;
    queue.push(cause);
    if (Array.isArray(errors)) queue.push(...errors);
  }
  return false;
}

export function mapGatewayError(input: {
  status?: number | undefined;
  body?: unknown;
  responseReceived?: boolean;
  /**
   * Whether the answer carried xy2api's X-Client-Request-ID. xy2api sets it
   * on every response, its own refusals included; a 5xx without it came
   * from something in between (Cloudflare cutting a request after ~125 s,
   * gguuai.com 2026-10-11) while xy2api may still be generating — and
   * billing. Such a 5xx is 待核对, never "not charged". Leave undefined when
   * the caller cannot see the headers.
   */
  answeredByXy2api?: boolean;
}): GatewayFailure {
  const { status, body } = input;
  if (status && ORIGIN_NOT_REACHED.has(status)) return unavailableFailure();
  const id = extractXy2apiErrorId(status ?? 0, body);
  const b = record(body);
  const e = record(b.error);
  const message = String(b.message ?? e.message ?? "");
  let code: GatewayCode = "upstream_unknown";
  let retryable = false;
  let known = Boolean(
    status && (input.responseReceived ?? body !== undefined),
  );
  // A 2xx is never a refusal: if it carries no usable image, xy2api may
  // still have billed it (0.3.0 answers an upstream's empty image list with
  // 200 and records the usage), so it is 待核对, never "not charged".
  if (status && status >= 200 && status < 300) known = false;
  if (known) {
    // xy2api risk control blocks with error type content_policy_violation and
    // an admin-chosen status (default 403, any of 400-599).
    if (id === "content_policy_violation") code = "safety_filter";
    else if (NO_ACCOUNT_PATTERN.test(message)) code = "model_unavailable";
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
    else if (
      status &&
      status >= 500 &&
      (ORIGIN_REACHED_NO_ANSWER.has(status) || input.answeredByXy2api === false)
    )
      // Cut in between: xy2api may finish and bill after we stopped waiting.
      known = false;
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

/**
 * The log-safe facts of one failed gateway answer (L1): status, xy2api's
 * error id, the first 200 characters of its message, and the edge headers
 * that tell a Cloudflare cut from an xy2api refusal. Feed it the parsed
 * JSON body when there is one, else the raw text.
 */
export function gatewayDiagnostics(input: {
  status?: number | undefined;
  headers?: Headers | Record<string, string | undefined> | undefined;
  body?: unknown;
  text?: string | undefined;
  requestId?: string | undefined;
  startedAt?: number;
}): GatewayDiagnostics {
  const header = (name: string) => {
    const h = input.headers;
    if (!h) return undefined;
    const value =
      typeof (h as Headers).get === "function"
        ? (h as Headers).get(name)
        : (h as Record<string, string | undefined>)[name];
    return value ? value.slice(0, 80) : undefined;
  };
  const b = record(input.body);
  const e = record(b.error);
  const raw =
    [b.message, e.message, b.error].find(
      (value): value is string => typeof value === "string" && value !== "",
    ) ?? input.text;
  const message = raw ? scrub(raw, 200) : undefined;
  const cfRay = header("cf-ray");
  const server = header("server");
  const contentType = header("content-type");
  return {
    ...(input.status ? { status: input.status } : {}),
    ...(input.body !== undefined
      ? { errorId: extractXy2apiErrorId(input.status ?? 0, input.body) }
      : {}),
    ...(message ? { message } : {}),
    ...(cfRay ? { cfRay } : {}),
    ...(server ? { server } : {}),
    ...(contentType ? { contentType } : {}),
    ...(input.headers ? { answeredByXy2api: Boolean(input.requestId) } : {}),
    ...(input.startedAt ? { elapsedMs: Date.now() - input.startedAt } : {}),
  };
}

/** One line for the worker log; empty when nothing was captured. */
export function describeDiagnostics(d: GatewayDiagnostics | undefined): string {
  if (!d) return "";
  const parts = [
    d.status ? `status=${d.status}` : "",
    d.errorId ? `id=${d.errorId}` : "",
    d.answeredByXy2api === false ? "no-xy2api-request-id" : "",
    d.cfRay ? `cf-ray=${d.cfRay}` : "",
    d.server ? `server=${d.server}` : "",
    d.contentType ? `type=${d.contentType.split(";")[0]}` : "",
    d.elapsedMs !== undefined ? `after=${(d.elapsedMs / 1000).toFixed(1)}s` : "",
    d.message ? `msg=${JSON.stringify(d.message)}` : "",
  ];
  return parts.filter(Boolean).join(" ");
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
  /**
   * Raised inside a chat stream after text or tool arguments had already
   * reached the page (agent/tool-call-stream.ts); never resent.
   */
  afterOutput?: boolean;
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
  if (typeof e.status !== "number" && neverSent(error))
    return new GatewayError(unavailableFailure());
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
  diagnostics?: GatewayDiagnostics,
): GatewayError {
  const gateway = sanitizeGatewayError(error);
  const failure = {
    ...gateway.failure,
    ...(requestId && !gateway.failure.requestId ? { requestId } : {}),
    ...(diagnostics && !gateway.failure.diagnostics ? { diagnostics } : {}),
  };
  return failure.requestId === gateway.failure.requestId &&
    failure.diagnostics === gateway.failure.diagnostics
    ? gateway
    : new GatewayError(failure);
}

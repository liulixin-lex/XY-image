import { describe, expect, it } from "vitest";
import {
  GatewayError,
  describeDiagnostics,
  extractXy2apiErrorId,
  gatewayDiagnostics,
  mapGatewayError,
  neverSent,
  sanitizeGatewayError,
  withRequestId,
} from "./errors.js";

describe("gateway errors", () => {
  it.each([
    [401, { code: "INVALID_API_KEY" }, "key_unavailable", false],
    [401, { code: "API_KEY_DISABLED" }, "key_unavailable", false],
    [401, { code: "USER_INACTIVE" }, "xy2api_reauth_required", false],
    [401, { code: "USER_NOT_FOUND" }, "xy2api_reauth_required", false],
    [403, { code: "ACCESS_DENIED" }, "key_ip_restricted", false],
    [403, { code: "API_KEY_EXPIRED" }, "key_unavailable", false],
    [403, { code: "GROUP_NOT_ALLOWED" }, "key_unavailable", false],
    [403, { code: "SUBSCRIPTION_NOT_FOUND" }, "key_unavailable", false],
    [403, { code: "GROUP_DISABLED" }, "key_unavailable", false],
    [403, { code: "INSUFFICIENT_BALANCE" }, "insufficient_balance", false],
    [
      403,
      { error: { type: "permission_error" } },
      "model_not_accessible",
      false,
    ],
    [429, { code: "API_KEY_QUOTA_EXHAUSTED" }, "key_quota_exhausted", false],
    [
      429,
      { error: { code: "insufficient_quota" } },
      "key_quota_exhausted",
      false,
    ],
    [429, { code: "USAGE_LIMIT_EXCEEDED" }, "key_quota_exhausted", false],
    [429, { error: "rate limit exceeded" }, "rate_limited", true],
    [400, { error: { type: "invalid_request_error" } }, "invalid_input", false],
    [
      400,
      { error: { code: "content_policy_violation" } },
      "safety_filter",
      false,
    ],
    [
      502,
      { error: { message: "Upstream response too large" } },
      "upstream_too_large",
      false,
    ],
    [502, { error: { message: "busy" } }, "upstream_busy", true],
    [503, { error: { message: "busy" } }, "upstream_busy", true],
    [
      504,
      { error: { code: 504, status: "UNAVAILABLE" } },
      "upstream_busy",
      true,
    ],
  ])("maps %s %j", (status, body, code, retryable) => {
    expect(mapGatewayError({ status: status as number, body })).toMatchObject({
      code,
      retryable,
      billing: "not_charged",
    });
  });
  it("marks a lost response as unknown without retry", () => {
    expect(mapGatewayError({})).toMatchObject({
      code: "upstream_unknown",
      billing: "unknown",
      retryable: false,
    });
    expect(mapGatewayError({ status: 502 })).toMatchObject({
      billing: "unknown",
    });
  });
  it("prioritizes reason and excludes server messages from output", () => {
    expect(
      extractXy2apiErrorId(401, { reason: "TOKEN_REVOKED", code: "OTHER" }),
    ).toBe("TOKEN_REVOKED");
    expect(
      JSON.stringify(
        mapGatewayError({
          status: 400,
          body: { message: "synthetic-sensitive-text" },
        }),
      ),
    ).not.toContain("synthetic-sensitive-text");
  });

  // xy2api risk control (on at gguuai.com): recorded shapes, see
  // __fixtures__/<version>/gateway.*.moderation_blocked.json
  const moderationMessage = "内容审计命中风险规则，请调整输入后重试";
  it.each([
    [
      403,
      {
        error: { message: moderationMessage, type: "content_policy_violation" },
      },
    ],
    [
      403,
      {
        error: {
          code: 403,
          message: moderationMessage,
          status: "PERMISSION_DENIED",
        },
      },
    ],
    // block_status is admin-configurable (400-599)
    [451, { error: { message: "blocked", type: "content_policy_violation" } }],
    [503, { error: { message: "blocked", type: "content_policy_violation" } }],
  ])("maps a %s moderation block to safety_filter", (status, body) => {
    expect(mapGatewayError({ status, body })).toMatchObject({
      code: "safety_filter",
      billing: "not_charged",
    });
  });

  it("never treats an unrecognised refusal as an unusable key", () => {
    // Custom moderation wording on the Gemini path, or a future xy2api rule:
    // must not reach markKeyInvalid (image-runner) via key_unavailable.
    const failure = mapGatewayError({
      status: 403,
      body: {
        error: {
          code: 403,
          message: "该请求不符合本站规则",
          status: "PERMISSION_DENIED",
        },
      },
    });
    expect(failure).toMatchObject({
      code: "request_rejected",
      billing: "not_charged",
    });
    expect(failure.userMessage).toBe(
      "主站拒绝了这次请求：该请求不符合本站规则",
    );
    expect(mapGatewayError({ status: 409, body: {} })).toMatchObject({
      code: "request_rejected",
      userMessage: "主站拒绝了这次请求，请到主站查看账号和 Key 状态",
    });
    expect(
      mapGatewayError({ status: 401, body: { code: "SOMETHING_NEW" } }).code,
    ).toBe("key_unavailable");
  });

  it("sanitizes the main-site reason it shows", () => {
    const { userMessage } = mapGatewayError({
      status: 403,
      body: {
        error: {
          message: `denied for sk-${"a".repeat(40)}\n token ${"Z".repeat(40)} ${"x".repeat(200)}`,
        },
      },
    });
    expect(userMessage).not.toMatch(/sk-a{6}|Z{32}|\n/);
    expect(userMessage.length).toBeLessThanOrEqual(
      "主站拒绝了这次请求：".length + 120,
    );
  });

  it.each([
    [403, "API key 已过期", "key_unavailable"],
    [403, "API Key 所属专属分组不再允许当前用户使用", "key_unavailable"],
    [403, "No active subscription found for this group", "key_unavailable"],
    [429, "API key 额度已用完", "key_quota_exhausted"],
    [
      429,
      "Too many invalid authentication attempts; retry later",
      "rate_limited",
    ],
    [401, "User associated with API key not found", "xy2api_reauth_required"],
  ])("maps Gemini-format %s %s", (status, message, code) => {
    const google = status === 429 ? "RESOURCE_EXHAUSTED" : "PERMISSION_DENIED";
    expect(
      mapGatewayError({
        status,
        body: { error: { code: status, message, status: google } },
      }).code,
    ).toBe(code);
  });

  it.each([413, 422])("maps %s to invalid_input", (status) => {
    expect(mapGatewayError({ status, body: {} }).code).toBe("invalid_input");
  });

  it("calls a request that never left not charged, and keeps the rest unknown", () => {
    const system = (code: string) =>
      Object.assign(new Error(`connect ${code}`), { code });
    const fetchFailed = (cause: unknown) =>
      new TypeError("fetch failed", { cause });
    // fetch reports the system error as its cause; the OpenAI client wraps
    // that once more; several addresses give an AggregateError.
    const refused = fetchFailed(system("ECONNREFUSED"));
    expect(neverSent(refused)).toBe(true);
    expect(neverSent({ name: "APIConnectionError", cause: refused })).toBe(
      true,
    );
    expect(
      neverSent(fetchFailed(new AggregateError([system("ECONNREFUSED")]))),
    ).toBe(true);
    expect(neverSent(fetchFailed(system("ENOTFOUND")))).toBe(true);
    expect(neverSent(fetchFailed(system("UND_ERR_CONNECT_TIMEOUT")))).toBe(
      true,
    );
    expect(neverSent(fetchFailed(system("CERT_HAS_EXPIRED")))).toBe(true);
    // The request may have arrived: still unknown.
    expect(neverSent(fetchFailed(system("ECONNRESET")))).toBe(false);
    expect(neverSent(fetchFailed(system("UND_ERR_HEADERS_TIMEOUT")))).toBe(
      false,
    );
    expect(neverSent(new Error("This operation was aborted"))).toBe(false);

    expect(sanitizeGatewayError(refused).failure).toMatchObject({
      code: "xy2api_unavailable",
      billing: "not_charged",
      retryable: true,
    });
    expect(
      sanitizeGatewayError(fetchFailed(system("ECONNRESET"))).failure,
    ).toMatchObject({ code: "upstream_unknown", billing: "unknown" });
  });

  it("calls Cloudflare's origin-not-reached pages not charged", () => {
    for (const status of [521, 522, 523, 525, 526, 530])
      expect(mapGatewayError({ status })).toMatchObject({
        code: "xy2api_unavailable",
        billing: "not_charged",
      });
    // 520 and 524: the origin got the request.
    for (const status of [520, 524, 502, 504])
      expect(mapGatewayError({ status })).toMatchObject({ billing: "unknown" });
  });
  // gguuai.com group 20, 2026-10-11 (FINDINGS G1): OpenAI's own refusal
  // passed through as a plain 400 invalid_request_error.
  it.each([
    "非常抱歉，该提示可能违反了我们的内容政策。如果你认为此判断有误，请重试或修改提示语。",
    "Your request was rejected as a result of our safety system.",
    "This request violates our content policy.",
    "policy_violation: image rejected",
  ])("maps an upstream moderation 400 to safety_filter: %s", (message) => {
    expect(
      mapGatewayError({
        status: 400,
        body: {
          error: { code: "400", message, type: "invalid_request_error" },
        },
        answeredByXy2api: true,
      }),
    ).toMatchObject({ code: "safety_filter", billing: "not_charged" });
  });

  // gguuai.com group 74, 2026-10-11 (FINDINGS G2).
  it("calls a group without an account for the model model_unavailable, not busy", () => {
    const failure = mapGatewayError({
      status: 503,
      body: {
        error: {
          type: "api_error",
          message:
            "No available Gemini accounts: no available accounts supporting model: gemini-nano-banana-2.1 (channel pricing restriction)",
        },
      },
      answeredByXy2api: true,
    });
    expect(failure).toMatchObject({
      code: "model_unavailable",
      retryable: false,
      billing: "not_charged",
    });
    expect(failure.userMessage).toContain("换一个模型");
    // Every account cooling down after upstream errors: passes, stays busy.
    expect(
      mapGatewayError({
        status: 503,
        body: {
          error: { message: "No available compatible accounts", type: "api_error" },
        },
        answeredByXy2api: true,
      }),
    ).toMatchObject({ code: "upstream_busy", retryable: true });
  });

  // gguuai.com 2026-10-11 (FINDINGS G7): a 4K request cut after ~125 s came
  // back as a JSON 5xx without xy2api's request id; xy2api finished 73 s
  // later and billed $0.10.
  it("keeps a 5xx that did not come from xy2api 待核对", () => {
    const body = { error: { message: "Bad gateway", type: "upstream_error" } };
    for (const status of [500, 502, 503, 504])
      expect(
        mapGatewayError({ status, body, answeredByXy2api: false }),
      ).toMatchObject({
        code: "upstream_unknown",
        billing: "unknown",
        retryable: false,
      });
    // xy2api's own 5xx (its id came back): a refusal, nothing billed.
    expect(
      mapGatewayError({ status: 502, body, answeredByXy2api: true }),
    ).toMatchObject({ code: "upstream_busy", billing: "not_charged" });
    // 520 / 524 reached the origin whatever the body says.
    for (const status of [520, 524])
      expect(
        mapGatewayError({ status, body: {}, answeredByXy2api: false }),
      ).toMatchObject({ code: "upstream_unknown", billing: "unknown" });
    // Definite 4xx refusals stay not charged even through an intermediary.
    expect(
      mapGatewayError({ status: 429, body: {}, answeredByXy2api: false }),
    ).toMatchObject({ code: "rate_limited", billing: "not_charged" });
  });

  it("logs the failed answer without keys and keeps it on the failure", () => {
    const diagnostics = gatewayDiagnostics({
      status: 502,
      headers: new Headers({
        "cf-ray": "8f00aa11bb22cc33-SJC",
        server: "cloudflare",
        "content-type": "application/json; charset=utf-8",
      }),
      body: {
        error: {
          message: `upstream failed for sk-${"a".repeat(40)} ${"x".repeat(300)}`,
          type: "upstream_error",
        },
      },
      startedAt: Date.now() - 125_100,
    });
    expect(diagnostics).toMatchObject({
      status: 502,
      errorId: "upstream_error",
      cfRay: "8f00aa11bb22cc33-SJC",
      server: "cloudflare",
      answeredByXy2api: false,
    });
    expect(diagnostics.message).not.toMatch(/sk-a{6}/);
    expect(diagnostics.message?.length).toBeLessThanOrEqual(200);
    const line = describeDiagnostics(diagnostics);
    expect(line).toMatch(
      /^status=502 id=upstream_error no-xy2api-request-id cf-ray=8f00aa11bb22cc33-SJC server=cloudflare type=application\/json after=12\d\.\ds msg="upstream failed for sk-\*\*\*/,
    );
    const failure = withRequestId(
      new GatewayError(
        mapGatewayError({ status: 502, body: {}, answeredByXy2api: false }),
      ),
      undefined,
      diagnostics,
    ).failure;
    expect(failure.diagnostics).toBe(diagnostics);
    expect(failure.billing).toBe("unknown");
    // HTML error pages are kept as text.
    expect(
      gatewayDiagnostics({ status: 524, text: "<html>A timeout occurred</html>" })
        .message,
    ).toBe("<html>A timeout occurred</html>");
  });
});

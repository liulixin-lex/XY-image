import { describe, expect, it } from "vitest";
import { extractXy2apiErrorId, mapGatewayError } from "./errors.js";

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
});

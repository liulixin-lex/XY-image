import { describe, expect, it } from "vitest";
import { GatewayError, mapGatewayError } from "../xy2api/errors.js";
import { ChatProviderError } from "./errors.js";
import { chatRunError } from "./run-error.js";

// The chat transport turns a main-site refusal into a GatewayError; the
// OpenAI client then throws a connection error with it as the cause.
const wrapped = (status: number, body: unknown) =>
  Object.assign(new Error("Connection error."), {
    name: "APIConnectionError",
    cause: new GatewayError(mapGatewayError({ status, body })),
  });

describe("chatRunError", () => {
  it("keeps a main-site moderation block for the page", () => {
    // xy2api 0.2.5 (fixture gateway.chat.moderation_blocked)
    const error = wrapped(403, {
      error: {
        message: "内容审计命中风险规则，请调整输入后重试",
        type: "content_policy_violation",
      },
    });
    expect(chatRunError(error)).toEqual({
      code: "run_failed",
      message: "内容未通过审核，请修改提示词",
      details: { gatewayCode: "safety_filter" },
    });
  });

  it("keeps an upstream safety refusal and a balance refusal", () => {
    expect(
      chatRunError(
        wrapped(400, {
          error: {
            message: "Your request was rejected by the safety system.",
            code: "content_policy_violation",
          },
        }),
      ).details,
    ).toEqual({ gatewayCode: "safety_filter" });
    expect(
      chatRunError(
        wrapped(403, {
          code: "INSUFFICIENT_BALANCE",
          message: "insufficient balance",
        }),
      ),
    ).toMatchObject({ details: { gatewayCode: "insufficient_balance" } });
  });

  it("stays generic when the outcome is unknown or the cause is not the main site", () => {
    const unknown = Object.assign(new Error("Connection error."), {
      cause: new GatewayError(mapGatewayError({})),
    });
    expect(chatRunError(unknown)).toEqual({
      code: "run_failed",
      message: "请求处理失败，请稍后再试",
    });
    expect(chatRunError(new Error("socket hang up"))).toEqual({
      code: "run_failed",
      message: "请求处理失败，请稍后再试",
    });
  });

  it("leaves the user's own provider errors as they were", () => {
    expect(
      chatRunError(
        Object.assign(new Error("x"), {
          cause: new ChatProviderError("provider_auth_failed"),
        }),
        true,
      ),
    ).toMatchObject({ code: "provider_auth_failed" });
    expect(chatRunError(wrapped(403, {}), true)).toMatchObject({
      code: "provider_unavailable",
    });
  });
});

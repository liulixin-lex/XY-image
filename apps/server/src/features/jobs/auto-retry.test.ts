import { describe, expect, it } from "vitest";
import { mapGatewayError } from "../xy2api/errors.js";
import { AUTO_RETRY_MAX_AGE_MS, autoRetryDecision } from "./auto-retry.js";

const now = Date.parse("2026-10-14T12:00:00Z");
const createdAt = new Date(now - 60_000).toISOString();
const busy = mapGatewayError({
  status: 503,
  body: { error: { message: "No available compatible accounts" } },
  responseReceived: true,
});

describe("autoRetryDecision", () => {
  it("retries a busy refusal twice with growing, jittered waits", () => {
    const first = autoRetryDecision({ failure: busy, sends: 1, maxRetries: 2, createdAt, now, random: () => 0 });
    const second = autoRetryDecision({ failure: busy, sends: 2, maxRetries: 2, createdAt, now, random: () => 1 });
    expect(first).toMatchObject({ delaySeconds: 20, nextSend: 2 });
    expect(second).toMatchObject({ delaySeconds: 90, nextSend: 3 });
    expect(autoRetryDecision({ failure: busy, sends: 3, maxRetries: 2, createdAt, now })).toBeUndefined();
  });
  it("keeps billing words out of what the job shows", () => {
    const message = autoRetryDecision({ failure: busy, sends: 1, maxRetries: 2, createdAt, now })?.message ?? "";
    expect(message).toMatch(/主站繁忙.*自动重试/);
    expect(message).not.toMatch(/扣费|收费/);
  });
  it.each([
    ["a cut in between (待核对)", mapGatewayError({ status: 502, body: {}, responseReceived: true, answeredByXy2api: false })],
    ["an unknown outcome", mapGatewayError({})],
    ["a 2xx without an image", mapGatewayError({ status: 200, body: {}, responseReceived: true })],
    ["a content refusal", mapGatewayError({ status: 400, body: { error: { message: "content policy" } }, responseReceived: true })],
    ["a bad request", mapGatewayError({ status: 400, body: {}, responseReceived: true })],
    ["no balance", mapGatewayError({ status: 403, body: { error: { code: "INSUFFICIENT_BALANCE" } }, responseReceived: true })],
  ])("never resends %s", (_, failure) => {
    expect(autoRetryDecision({ failure, sends: 1, maxRetries: 2, createdAt, now })).toBeUndefined();
  });
  it("retries 429 and a request that never left", () => {
    const limited = mapGatewayError({ status: 429, body: {}, responseReceived: true });
    expect(autoRetryDecision({ failure: limited, sends: 1, maxRetries: 2, createdAt, now })).toBeDefined();
    const unsent = { code: "xy2api_unavailable" as const, billing: "not_charged" as const, retryable: true };
    expect(autoRetryDecision({ failure: unsent, sends: 1, maxRetries: 2, createdAt, now })).toBeDefined();
  });
  it("waits out the main site's task limit without spending a send", () => {
    const throttled = { ...mapGatewayError({ status: 429, body: {}, responseReceived: true }), throttleSeconds: 5 };
    const decision = autoRetryDecision({ failure: throttled, sends: 7, maxRetries: 2, createdAt, now, random: () => 0 });
    expect(decision).toMatchObject({ delaySeconds: 5, throttled: true, nextSend: 7 });
    expect(decision?.message).toMatch(/自动发送/);
    const old = new Date(now - AUTO_RETRY_MAX_AGE_MS - 1).toISOString();
    expect(autoRetryDecision({ failure: throttled, sends: 1, maxRetries: 2, createdAt: old, now })).toBeUndefined();
  });

  it("lets old jobs and a disabled setting fail", () => {
    const old = new Date(now - AUTO_RETRY_MAX_AGE_MS - 1).toISOString();
    expect(autoRetryDecision({ failure: busy, sends: 1, maxRetries: 2, createdAt: old, now })).toBeUndefined();
    expect(autoRetryDecision({ failure: busy, sends: 1, maxRetries: 0, createdAt, now })).toBeUndefined();
  });
});

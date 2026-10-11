import { describe, expect, it, vi } from "vitest";
import { Xy2apiClient } from "./client.js";
import { XY2API_USER_AGENT } from "../../utils/user-agent.js";

const response = (data: unknown) =>
  new Response(JSON.stringify({ code: 0, data }));
describe("xy2api client", () => {
  it("logs in using a stable UA without forwarding client IP", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      response({
        access_token: "synthetic-access",
        refresh_token: "synthetic-refresh",
        expires_in: 1000,
        user: { id: 1, email: "test@example.com", status: "active" },
      }),
    );
    const result = await new Xy2apiClient("https://example.com", fetcher).login(
      { email: "test@example.com", password: "synthetic-password" },
    );
    expect(result.kind).toBe("ok");
    expect(fetcher.mock.calls[0]?.[1].headers).toEqual({
      "User-Agent": XY2API_USER_AGENT,
      Accept: "application/json",
      "Content-Type": "application/json",
    });
  });
  it("handles two factor challenge", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      response({
        requires_2fa: true,
        temp_token: "synthetic-temp",
        user_email_masked: "t***@example.com",
      }),
    );
    expect(
      await new Xy2apiClient("https://example.com", fetcher).login({
        email: "test@example.com",
        password: "synthetic",
      }),
    ).toEqual({
      kind: "2fa",
      tempToken: "synthetic-temp",
      maskedEmail: "t***@example.com",
    });
  });
  it.each([
    [401, "INVALID_CREDENTIALS"],
    [429, "rate limit exceeded"],
  ])("sanitizes failure %i", async (status, id) => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ reason: id, message: "synthetic-secret" }),
          { status, headers: { "Retry-After": "32" } },
        ),
      );
    await expect(
      new Xy2apiClient("https://example.com", fetcher).login({
        email: "test@example.com",
        password: "synthetic",
      }),
    ).rejects.toMatchObject({
      status,
      id,
      retryAfter: 32,
      message: "主站请求失败，请稍后再试",
    });
  });
  const remoteKey = (id: number, key = `sk-${"a".repeat(40)}${id}`) => ({
    id,
    key,
    name: `key-${id}`,
    status: "active",
  });
  it("reads every page", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ items: [remoteKey(1)], pages: 2 }))
      .mockResolvedValueOnce(response({ items: [remoteKey(2)], pages: 2 }));
    const keys = await new Xy2apiClient(
      "https://example.com",
      fetcher,
    ).listKeys("synthetic");
    expect(keys.map((key) => key.id)).toEqual([1, 2]);
    expect(keys[0]).toMatchObject({ masked: false, quota: 0, quota_used: 0 });
    expect(fetcher.mock.calls[1]?.[0]).toContain("page=2");
  });
  it("skips unparseable keys, flags masked ones, and paginates by total", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      response({
        items: [{ id: 1 }, remoteKey(2, "sk-abcd…wxyz"), remoteKey(3)],
        total: 3,
      }),
    );
    const keys = await new Xy2apiClient(
      "https://example.com",
      fetcher,
    ).listKeys("synthetic");
    expect(keys.map((key) => [key.id, key.masked])).toEqual([
      [2, true],
      [3, false],
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("reads one key by id and flags a masked one", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(remoteKey(7)))
      .mockResolvedValueOnce(response(remoteKey(7, "sk-****")))
      .mockResolvedValueOnce(response(remoteKey(8)));
    const client = new Xy2apiClient("https://example.com", fetcher);
    expect(await client.getKey("synthetic", 7)).toMatchObject({
      id: 7,
      masked: false,
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://example.com/api/v1/keys/7",
    );
    expect((await client.getKey("synthetic", 7)).masked).toBe(true);
    // A different key in the answer is never trusted.
    await expect(client.getKey("synthetic", 7)).rejects.toMatchObject({
      id: "INVALID_RESPONSE",
    });
  });
});

describe("xy2api usage lookup", () => {
  const usageRow = (id: number, requestId: unknown) => ({
    id,
    request_id: requestId,
    actual_cost: 0.04,
  });
  const lookup = {
    requestId: "req-1",
    from: new Date("2026-10-08T23:00:00Z"),
    to: new Date("2026-10-10T01:00:00Z"),
  };
  it("finds the row by client request id within UTC days", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response({ items: [usageRow(1, "client:other")], pages: 2 }),
      )
      .mockResolvedValueOnce(
        response({ items: [usageRow(2, "client:req-1")], pages: 2 }),
      );
    const result = await new Xy2apiClient(
      "https://example.com",
      fetcher,
    ).findUsage("synthetic", { ...lookup, apiKeyId: 9 });
    expect(result).toEqual({ kind: "found", usageId: 2, actualCost: 0.04 });
    const url = new URL(fetcher.mock.calls[0]?.[0]);
    expect(url.pathname).toBe("/api/v1/usage");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      page: "1",
      start_date: "2026-10-08",
      end_date: "2026-10-10",
      timezone: "UTC",
      api_key_id: "9",
    });
  });
  it("reports absent only after reading every page", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(response({ items: [usageRow(1, "client:x")] }));
    const client = new Xy2apiClient("https://example.com", fetcher);
    expect(await client.findUsage("synthetic", lookup)).toEqual({
      kind: "absent",
    });
    expect(
      new URL(fetcher.mock.calls[0]?.[0]).searchParams.has("api_key_id"),
    ).toBe(false);
  });
  it("draws no conclusion past the page cap or without request ids", async () => {
    const full = Array.from({ length: 100 }, (_, i) =>
      usageRow(i, `client:${i}`),
    );
    const capped = vi.fn(async () => response({ items: full, pages: 9 }));
    expect(
      await new Xy2apiClient("https://example.com", capped).findUsage(
        "synthetic",
        { ...lookup, maxPages: 2 },
      ),
    ).toEqual({ kind: "incomplete" });
    expect(capped).toHaveBeenCalledTimes(2);
    const drifted = vi
      .fn()
      .mockResolvedValue(response({ items: [{ id: 1 }], pages: 1 }));
    expect(
      await new Xy2apiClient("https://example.com", drifted).findUsage(
        "synthetic",
        lookup,
      ),
    ).toEqual({ kind: "incomplete" });
  });
});

describe("xy2api usage lookup by shape", () => {
  const row = (over: Record<string, unknown>) => ({
    id: 1,
    request_id: "client:aaa",
    model: "gpt-image-2",
    image_size: "4K",
    user_agent: "GGUU-AI-Image/0.0.5",
    created_at: "2026-10-11T15:30:33Z",
    actual_cost: 0.1,
    ...over,
  });
  const shape = {
    apiKeyId: 24546,
    model: "gpt-image-2",
    imageSize: "4K",
    after: new Date("2026-10-11T15:25:00Z"),
    before: new Date("2026-10-11T15:59:20Z"),
    exclude: new Set(["ok-twin"]),
  };
  it("finds the one row of the job's shape", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      response({
        items: [
          row({ id: 2, request_id: "client:862ee3fc" }),
          // a twin that succeeded: its id is already on another job
          row({ id: 3, request_id: "client:ok-twin" }),
          row({ id: 4, request_id: "client:x1", image_size: "2K" }),
          row({ id: 5, request_id: "client:x2", model: "gpt-image-2.5-flare" }),
          row({ id: 6, request_id: "client:x3", user_agent: "curl/8.0" }),
          row({ id: 7, request_id: "client:x4", created_at: "2026-10-11T16:30:00Z" }),
          // sent before 0.0.5
          row({ id: 8, request_id: "client:old", user_agent: "LoomicServer/1.0", created_at: "2026-10-10T10:00:00Z" }),
        ],
        pages: 1,
      }),
    );
    const client = new Xy2apiClient("https://example.com", fetcher);
    expect(await client.findUsageByShape("synthetic", shape)).toEqual({
      kind: "found",
      usageId: 2,
      actualCost: 0.1,
      requestId: "862ee3fc",
    });
    expect(
      Object.fromEntries(new URL(fetcher.mock.calls[0]?.[0]).searchParams),
    ).toMatchObject({
      start_date: "2026-10-10",
      end_date: "2026-10-12",
      api_key_id: "24546",
      timezone: "UTC",
    });
  });
  it("is ambiguous with two rows and inconclusive without the fields", async () => {
    const two = vi.fn().mockResolvedValue(
      response({
        items: [row({ id: 2 }), row({ id: 3, request_id: "client:bbb" })],
        pages: 1,
      }),
    );
    expect(
      await new Xy2apiClient("https://example.com", two).findUsageByShape(
        "synthetic",
        shape,
      ),
    ).toEqual({ kind: "ambiguous", candidates: 2 });
    const drifted = vi
      .fn()
      .mockResolvedValue(response({ items: [{ id: 1, request_id: "client:a" }], pages: 1 }));
    expect(
      await new Xy2apiClient("https://example.com", drifted).findUsageByShape(
        "synthetic",
        shape,
      ),
    ).toEqual({ kind: "incomplete" });
    const none = vi.fn().mockResolvedValue(response({ items: [], pages: 0 }));
    expect(
      await new Xy2apiClient("https://example.com", none).findUsageByShape(
        "synthetic",
        shape,
      ),
    ).toEqual({ kind: "absent" });
  });
});

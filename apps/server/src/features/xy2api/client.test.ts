import { describe, expect, it, vi } from "vitest";
import { Xy2apiClient } from "./client.js";

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
      "User-Agent": "LoomicServer/1.0",
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
  it("reads every page", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ items: [{ id: 1 }], pages: 2 }))
      .mockResolvedValueOnce(response({ items: [{ id: 2 }], pages: 2 }));
    expect(
      await new Xy2apiClient("https://example.com", fetcher).listKeys(
        "synthetic",
      ),
    ).toEqual([{ id: 1 }, { id: 2 }]);
    expect(fetcher.mock.calls[1]?.[0]).toContain("page=2");
  });
});

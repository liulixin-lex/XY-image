import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AccountService } from "./account-service.js";
import { Xy2apiClient } from "./client.js";
import { Xy2apiError } from "./errors.js";
import { createSecretBox } from "./secret-box.js";
import type { AccountRow, AccountStore } from "./store.js";

function setup() {
  const rows = new Map<string, AccountRow>();
  const box = createSecretBox(randomBytes(32).toString("base64"));
  const store: AccountStore = {
    get: vi.fn(async (id) => rows.get(id) ?? null),
    find: vi.fn(
      async (id) =>
        [...rows.values()].find((row) => row.xy2api_user_id === id) ?? null,
    ),
    save: vi.fn(async (row) => {
      rows.set(row.user_id, { ...rows.get(row.user_id), ...row } as AccountRow);
    }),
    createShadow: vi.fn(async () => "shadow-id"),
    loginLink: vi.fn(async () => ({
      userId: "shadow-id",
      tokenHash: "one-time-hash",
    })),
  };
  const client = new Xy2apiClient("https://example.com");
  const service = new AccountService(store, client, box, {
    ssoEmailDomain: "sso.example.com",
  });
  const login = {
    kind: "ok" as const,
    user: { id: 7, email: "real@example.com", status: "active" },
    tokens: {
      access_token: "synthetic-access",
      refresh_token: "synthetic-refresh",
      expires_in: 1,
    },
  };
  return { rows, box, store, client, service, login };
}

describe("linked accounts", () => {
  it("requires login after an encryption-key rotation", async () => {
    const { service, login, rows, box } = setup();
    await service.completeLogin({
      ...login,
      tokens: { ...login.tokens, expires_in: 3600 },
    });
    vi.spyOn(box, "openSecret").mockImplementation(() => {
      throw new Error("Cannot decrypt");
    });
    await expect(service.getAccessToken("shadow-id")).rejects.toMatchObject({
      code: "xy2api_reauth_required",
    });
    expect(rows.get("shadow-id")?.session_state).toBe("reauth_required");
  });
  it("revokes a token rejected after an expiration refresh", async () => {
    const { service, login, client, rows } = setup();
    await service.completeLogin({
      ...login,
      tokens: { ...login.tokens, expires_in: 3600 },
    });
    vi.spyOn(client, "refresh").mockResolvedValue({
      ...login.tokens,
      expires_in: 3600,
    });
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Xy2apiError(401, "TOKEN_EXPIRED"))
      .mockRejectedValueOnce(new Xy2apiError(401, "TOKEN_REVOKED"));
    await expect(
      service.withAccess("shadow-id", operation),
    ).rejects.toMatchObject({ code: "xy2api_reauth_required" });
    expect(rows.get("shadow-id")?.session_state).toBe("reauth_required");
  });
  it("creates a shadow user once and encrypts both tokens", async () => {
    const { service, login, store, rows, box } = setup();
    expect(await service.completeLogin(login)).toBe("one-time-hash");
    await service.completeLogin(login);
    expect(store.createShadow).toHaveBeenCalledTimes(1);
    expect(store.createShadow).toHaveBeenCalledWith(
      "u7@sso.example.com",
      7,
      "real@example.com",
    );
    const row = rows.get("shadow-id");
    expect(row?.access_token_enc).not.toContain("synthetic-access");
    expect(box.openSecret(row?.refresh_token_enc ?? "")).toBe(
      "synthetic-refresh",
    );
  });
  it("coalesces concurrent refresh requests", async () => {
    const { service, login, client } = setup();
    await service.completeLogin(login);
    const refresh = vi.spyOn(client, "refresh").mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {
        access_token: "next-access",
        refresh_token: "next-refresh",
        expires_in: 3600,
      };
    });
    expect(
      await Promise.all(
        Array.from({ length: 12 }, () => service.getAccessToken("shadow-id")),
      ),
    ).toEqual(Array(12).fill("next-access"));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it("revokes a failed refresh but keeps a transient outage active", async () => {
    const { service, login, client, rows } = setup();
    await service.completeLogin(login);
    const refresh = vi
      .spyOn(client, "refresh")
      .mockRejectedValue(new Xy2apiError(429, "rate limit exceeded"));
    await expect(service.getAccessToken("shadow-id")).rejects.toThrow();
    expect(rows.get("shadow-id")?.session_state).toBe("active");
    refresh.mockRejectedValue(new Xy2apiError(401, "REFRESH_TOKEN_INVALID"));
    await expect(service.getAccessToken("shadow-id")).rejects.toThrow();
    expect(rows.get("shadow-id")?.session_state).toBe("reauth_required");
  });
});

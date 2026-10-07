import { randomBytes } from "node:crypto";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { loadServerEnv } from "../config/env.js";
import { createXy2apiServices } from "../features/xy2api/services.js";
import { memoryDatabase } from "../features/xy2api/test-support.js";
import { registerAccountRoutes } from "./account.js";

describe("public account metadata", () => {
  it("returns real identity and masked keys without tokens or encrypted columns", async () => {
    const env = loadServerEnv(
      {},
      {
        XY2API_BASE_URL: "https://example.com",
        LOOMIC_SECRET_KEY: randomBytes(32).toString("base64"),
        SSO_EMAIL_DOMAIN: "sso.example.com",
      },
    );
    const db = memoryDatabase({
      xy2api_accounts: [
        {
          user_id: "user-1",
          xy2api_user_id: 7,
          email: "real@example.com",
          username: "Creator",
          session_state: "active",
          access_token_enc: "private-access-ciphertext",
          refresh_token_enc: "private-refresh-ciphertext",
        },
      ],
    });
    const services = createXy2apiServices(env, () => db.admin);
    vi.spyOn(services.accounts, "getAccessToken").mockResolvedValue(
      "private-upstream-token",
    );
    vi.spyOn(services.client, "listKeys").mockResolvedValue([
      {
        id: 7,
        key: "synthetic-private-api-key",
        name: "Image",
        status: "active",
        quota: 0,
        quota_used: 0,
        group: {
          id: 1,
          name: "Image",
          platform: "openai",
          status: "active",
          allow_image_generation: true,
        },
      },
    ]);
    vi.spyOn(services.client, "listModels").mockResolvedValue(["gpt-image-2"]);
    const usage = vi
      .spyOn(services.client, "getUsage")
      .mockResolvedValue({ balance: 12.5, mode: "wallet" });
    await services.keys.syncKeys("user-1");
    const app = Fastify();
    registerAccountRoutes(app, {
      ...services,
      env,
      auth: {
        authenticate: async () => ({
          id: "user-1",
          accessToken: "synthetic-supabase-token",
          email: "u7@sso.example.com",
          userMetadata: {},
        }),
      },
    });
    try {
      const account = await app.inject({ method: "GET", url: "/api/account" });
      const keys = await app.inject({
        method: "GET",
        url: "/api/account/keys",
      });
      expect(account.statusCode).toBe(200);
      expect(account.json()).toMatchObject({
        user: { email: "real@example.com" },
        balance: { amount: 12.5, unit: "USD" },
      });
      expect(keys.json().keys[0]).toMatchObject({
        keyId: 7,
        maskedKey: "synthe…-key",
      });
      for (const text of [account.body, keys.body]) {
        for (const secret of [
          "secret_enc",
          "access_token",
          "refresh_token",
          "private-upstream-token",
          "synthetic-private-api-key",
          "private-access-ciphertext",
          "private-refresh-ciphertext",
        ])
          expect(text).not.toContain(secret);
      }
      await app.inject({ method: "GET", url: "/api/account" });
      expect(usage).toHaveBeenCalledTimes(1);
      await app.inject({ method: "POST", url: "/api/account/keys/sync" });
      await app.inject({ method: "GET", url: "/api/account" });
      expect(usage).toHaveBeenCalledTimes(2);
    } finally {
      await app.close();
    }
  });
});

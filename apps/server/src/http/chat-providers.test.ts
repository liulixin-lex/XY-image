import { randomBytes } from "node:crypto";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadServerEnv } from "../config/env.js";
import { createXy2apiServices } from "../features/xy2api/services.js";
import { memoryDatabase } from "../features/xy2api/test-support.js";
import { registerAccountRoutes } from "./account.js";
import { registerChatProviderRoutes } from "./chat-providers.js";
import { registerModelRoutes } from "./models.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(cleanups.splice(0).map((f) => f()));
});
function fixture() {
  const env = loadServerEnv(
    {},
    {
      XY2API_BASE_URL: "https://main.example.com",
      LOOMIC_SECRET_KEY: randomBytes(32).toString("base64"),
      SSO_EMAIL_DOMAIN: "sso.example.com",
    },
  );
  const db = memoryDatabase({});
  const services = createXy2apiServices(env, () => db.admin);
  vi.spyOn(services.providers.network, "listModels").mockResolvedValue([
    "org/model:free",
  ]);
  const auth = {
    authenticate: async (request: { headers: Record<string, unknown> }) =>
      request.headers.authorization
        ? {
            id: String(request.headers.authorization),
            email: "u@sso.example.com",
            userMetadata: {},
            accessToken: "synthetic-access",
          }
        : null,
  };
  const app = Fastify();
  registerChatProviderRoutes(app, { auth, providers: services.providers });
  registerModelRoutes(app, {
    auth,
    keys: services.keys,
    providers: services.providers,
  });
  registerAccountRoutes(app, { ...services, env, auth });
  cleanups.push(async () => {
    await app.close();
    await services.providers.network.close();
  });
  return { app, ...services };
}
const headers = { authorization: "11111111-1111-4111-8111-111111111111" };
const body = {
  name: "Mine",
  protocol: "openai_compatible",
  baseUrl: "https://api.example.com/v1",
  apiKey: "synthetic-private-key",
};

describe("chat provider HTTP contract", () => {
  it("authenticates every entry, returns wrapped DTOs, owner-safe 404, and merged models without a main key", async () => {
    const f = fixture();
    for (const [method, url] of [
      ["GET", "/api/chat-providers"],
      ["POST", "/api/chat-providers"],
      ["PATCH", "/api/chat-providers/missing"],
      ["DELETE", "/api/chat-providers/missing"],
      ["POST", "/api/chat-providers/missing/refresh-models"],
      ["GET", "/api/models"],
      ["GET", "/api/account/preferences"],
    ] as const) {
      expect((await f.app.inject({ method, url })).statusCode).toBe(401);
    }
    const create = await f.app.inject({
      method: "POST",
      url: "/api/chat-providers",
      headers,
      payload: body,
    });
    expect(create.statusCode).toBe(201);
    expect(create.body).not.toContain(body.apiKey);
    expect(create.body).not.toContain("secret_enc");
    const id = create.json().provider.id;
    const listed = await f.app.inject({ url: "/api/chat-providers", headers });
    expect(listed.json().providers).toHaveLength(1);
    expect(listed.headers["cache-control"]).toBe("no-store");
    const models = await f.app.inject({ url: "/api/models", headers });
    expect(models.json()).toMatchObject({
      xy2api: { available: false, error: "key_unavailable" },
      models: [
        {
          id: `custom:${id}:org/model:free`,
          source: "custom",
          providerId: id,
          billing: "external",
        },
      ],
    });
    expect(
      (await f.app.inject({ url: "/api/account/preferences", headers })).json()
        .preferences,
    ).toHaveProperty("default_chat_provider_id", null);
    expect(
      (
        await f.app.inject({
          method: "PUT",
          url: "/api/account/preferences",
          headers,
          payload: {
            defaultChatProviderId: id,
            defaultChatModel: "org/model:free",
          },
        })
      ).json().preferences.default_chat_provider_id,
    ).toBe(id);
    const foreign = await f.app.inject({
      method: "DELETE",
      url: `/api/chat-providers/${id}`,
      headers: { authorization: "other-user" },
    });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json().error.code).toBe("provider_not_found");
    const patched = await f.app.inject({
      method: "PATCH",
      url: `/api/chat-providers/${id}`,
      headers,
      payload: { enabled: false },
    });
    expect(patched.json().provider.enabled).toBe(false);
    expect(
      (await f.app.inject({ url: "/api/models", headers })).json().models,
    ).toEqual([]);
    const refreshed = await f.app.inject({
      method: "POST",
      url: `/api/chat-providers/${id}/refresh-models`,
      headers,
    });
    expect(refreshed.json().provider.lastError).toBeNull();
    expect(
      (
        await f.app.inject({
          method: "DELETE",
          url: `/api/chat-providers/${id}`,
          headers,
        })
      ).statusCode,
    ).toBe(204);
  });
  it("returns form errors and per-user Retry-After without leaking request credentials", async () => {
    const f = fixture();
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const invalid = await f.app.inject({
      method: "POST",
      url: "/api/chat-providers",
      headers,
      payload: { ...body, name: "" },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe("invalid_request");
    for (let i = 0; i < 9; i++)
      await f.app.inject({
        method: "POST",
        url: "/api/chat-providers",
        headers,
        payload: body,
      });
    const rate = await f.app.inject({
      method: "POST",
      url: "/api/chat-providers",
      headers,
      payload: body,
    });
    expect(rate.statusCode).toBe(429);
    expect(rate.json().error.code).toBe("rate_limited");
    expect(Number(rate.headers["retry-after"])).toBeGreaterThan(0);
    expect(JSON.stringify(log.mock.calls)).not.toContain(body.apiKey);
  });
});

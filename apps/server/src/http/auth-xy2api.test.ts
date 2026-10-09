import { randomBytes } from "node:crypto";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadServerEnv } from "../config/env.js";
import { Xy2apiError } from "../features/xy2api/errors.js";
import { createXy2apiServices } from "../features/xy2api/services.js";
import { memoryDatabase } from "../features/xy2api/test-support.js";
import { registerXy2apiAuthRoutes } from "./auth-xy2api.js";

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
function setup() {
  const env = loadServerEnv(
    {},
    {
      XY2API_BASE_URL: "https://example.com",
      LOOMIC_SECRET_KEY: randomBytes(32).toString("base64"),
      SSO_EMAIL_DOMAIN: "sso.example.com",
    },
  );
  const db = memoryDatabase({});
  const services = createXy2apiServices(env, () => db.admin);
  vi.spyOn(services.client, "getPublicSettings").mockResolvedValue({
    site_name: "测试主站",
  });
  vi.spyOn(services.accounts, "completeLogin").mockResolvedValue(
    "one-time-shadow-hash",
  );
  const result = {
    kind: "ok" as const,
    tokens: {
      access_token: "synthetic-upstream-access",
      refresh_token: "synthetic-upstream-refresh",
      expires_in: 3600,
    },
    user: { id: 1, email: "user@example.com", status: "active" },
  };
  const login = vi.spyOn(services.client, "login").mockResolvedValue(result);
  const app = Fastify();
  apps.push(app);
  registerXy2apiAuthRoutes(app, {
    ...services,
    env,
    auth: { authenticate: async () => null },
  });
  return { app, ...services, login, result };
}
describe("xy2api authentication HTTP routes", () => {
  it("returns only a one-time shadow token hash", async () => {
    const fixture = setup();
    const response = await fixture.app.inject({
      method: "POST",
      url: "/api/auth/xy2api/login",
      payload: {
        email: "USER@example.com",
        password: "synthetic-password",
        turnstileToken: "captcha-fixture",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      tokenHash: "one-time-shadow-hash",
    });
    expect(response.body).not.toContain("synthetic-upstream");
    expect(fixture.login).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "synthetic-password",
      turnstile_token: "captcha-fixture",
    });
    expect(response.headers["cache-control"]).toBe("no-store");
  });
  it("encrypts, expires, and consumes the two-factor challenge", async () => {
    const fixture = setup();
    fixture.login.mockResolvedValue({
      kind: "2fa",
      tempToken: "synthetic-temp-token",
      maskedEmail: "u***@example.com",
    });
    const verify = vi
      .spyOn(fixture.client, "login2fa")
      .mockResolvedValue(fixture.result);
    const start = await fixture.app.inject({
      method: "POST",
      url: "/api/auth/xy2api/login",
      payload: { email: "user@example.com", password: "synthetic" },
    });
    expect(start.body).not.toContain("synthetic-temp-token");
    const challenge = start.json().challenge as string;
    const request = {
      method: "POST" as const,
      url: "/api/auth/xy2api/login/2fa",
      payload: { challenge, code: "123456" },
    };
    expect((await fixture.app.inject(request)).statusCode).toBe(200);
    expect((await fixture.app.inject(request)).statusCode).toBe(400);
    expect(verify).toHaveBeenCalledTimes(1);
    const expired = fixture.box.sealSecret(
      JSON.stringify({
        tempToken: "fixture",
        email: "user@example.com",
        exp: Date.now() - 1,
      }),
    );
    expect(
      (
        await fixture.app.inject({
          ...request,
          payload: { challenge: expired, code: "123456" },
        })
      ).statusCode,
    ).toBe(400);
  });
  it("limits attempts by both IP and normalized email", async () => {
    const fixture = setup();
    fixture.login.mockRejectedValue(
      new Xy2apiError(401, "INVALID_CREDENTIALS"),
    );
    for (let index = 0; index < 10; index++) {
      const response = await fixture.app.inject({
        method: "POST",
        url: "/api/auth/xy2api/login",
        remoteAddress: `192.0.2.${index + 1}`,
        payload: { email: "user@example.com", password: "synthetic" },
      });
      expect(response.statusCode).toBe(401);
    }
    const blocked = await fixture.app.inject({
      method: "POST",
      url: "/api/auth/xy2api/login",
      remoteAddress: "192.0.2.100",
      payload: { email: "USER@example.com", password: "synthetic" },
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
    expect(fixture.login).toHaveBeenCalledTimes(10);
  });
  it("does not count successful sign-ins from a shared office IP", async () => {
    const fixture = setup();
    for (let index = 0; index < 30; index++) {
      const response = await fixture.app.inject({
        method: "POST",
        url: "/api/auth/xy2api/login",
        remoteAddress: "198.51.100.7",
        payload: { email: "user@example.com", password: "synthetic" },
      });
      expect(response.statusCode).toBe(200);
    }
  });
  it("allows 50 failed guesses per IP across different emails", async () => {
    const fixture = setup();
    fixture.login.mockRejectedValue(
      new Xy2apiError(401, "INVALID_CREDENTIALS"),
    );
    const attempt = (index: number) =>
      fixture.app.inject({
        method: "POST",
        url: "/api/auth/xy2api/login",
        remoteAddress: "198.51.100.8",
        payload: { email: `user${index}@example.com`, password: "synthetic" },
      });
    for (let index = 0; index < 50; index++)
      expect((await attempt(index)).statusCode).toBe(401);
    expect((await attempt(50)).statusCode).toBe(429);
    expect(fixture.login).toHaveBeenCalledTimes(50);
  });
  it.each([
    ["a main-site outage", new Xy2apiError(503, "SERVICE_UNAVAILABLE")],
    ["a main-site rate limit", new Xy2apiError(429, "RATE_LIMITED")],
    ["a network failure", new TypeError("fetch failed")],
  ])("does not count %s against the user", async (_label, failure) => {
    const fixture = setup();
    fixture.login.mockRejectedValue(failure);
    for (let index = 0; index < 12; index++) {
      const response = await fixture.app.inject({
        method: "POST",
        url: "/api/auth/xy2api/login",
        remoteAddress: "198.51.100.9",
        payload: { email: "user@example.com", password: "synthetic" },
      });
      expect(fixture.login).toHaveBeenCalledTimes(index + 1);
    }
  });
  it("counts wrong two-factor codes but not a correct one", async () => {
    const fixture = setup();
    fixture.login.mockResolvedValue({
      kind: "2fa",
      tempToken: "synthetic-temp-token",
      maskedEmail: "u***@example.com",
    });
    const verify = vi
      .spyOn(fixture.client, "login2fa")
      .mockRejectedValue(new Xy2apiError(400, "TOTP_INVALID"));
    const start = () =>
      fixture.app.inject({
        method: "POST",
        url: "/api/auth/xy2api/login",
        payload: { email: "user@example.com", password: "synthetic" },
      });
    const code = async () =>
      (
        await fixture.app.inject({
          method: "POST",
          url: "/api/auth/xy2api/login/2fa",
          payload: {
            challenge: (await start()).json().challenge,
            code: "123456",
          },
        })
      ).statusCode;
    for (let index = 0; index < 9; index++) expect(await code()).toBe(400);
    verify.mockResolvedValueOnce(fixture.result);
    expect(await code()).toBe(200);
    expect(await code()).toBe(400);
    // Ten wrong codes for this email: even the password step is refused now.
    expect((await start()).statusCode).toBe(429);
    expect(verify).toHaveBeenCalledTimes(11);
  });
});

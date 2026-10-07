import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
describe("integration route boundary", () => {
  it("requires authentication and removes retired entry points", async () => {
    const app = buildApp({
      auth: { authenticate: async () => null },
      env: {
        xy2apiBaseUrl: "https://example.com",
        secretKey: randomBytes(32).toString("base64"),
        ssoEmailDomain: "sso.example.com",
      },
    });
    apps.push(app);
    for (const path of [
      "/api/viewer",
      "/api/models",
      "/api/image-models",
      "/api/account",
      "/api/account/keys",
    ]) {
      expect(
        (await app.inject({ method: "GET", url: path })).statusCode,
        path,
      ).toBe(401);
    }
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/agent/runs",
          payload: {},
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/agent/generate-image",
          payload: {},
        })
      ).statusCode,
    ).toBe(401);
    for (const path of [
      "/api/credits/admin/" + "set" + "-plan",
      "/api/jobs/video-generation",
      "/api/agent/generate-video",
    ]) {
      expect(
        (await app.inject({ method: "POST", url: path, payload: {} }))
          .statusCode,
        path,
      ).toBe(404);
    }
    expect(
      (await app.inject({ method: "GET", url: "/api/video-models" }))
        .statusCode,
    ).toBe(404);
  });
});

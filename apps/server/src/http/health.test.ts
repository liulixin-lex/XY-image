import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { ServerEnv } from "../config/env.js";
import { registerHealthRoutes } from "./health.js";
describe("health and readiness separation", () => {
  it.each([true, false])(
    "reports actual dependency availability %s",
    async (ok) => {
      const app = Fastify();
      await registerHealthRoutes(
        app,
        { version: "test" } as ServerEnv,
        async () => ({ ok, checks: { database: ok } }),
      );
      try {
        expect((await app.inject("/api/health")).statusCode).toBe(200);
        const ready = await app.inject("/api/ready");
        expect(ready.statusCode).toBe(ok ? 200 : 503);
        expect(ready.headers["cache-control"]).toBe("no-store");
      } finally {
        await app.close();
      }
    },
  );
  it("fails closed without disclosing dependency errors", async () => {
    const app = Fastify();
    await registerHealthRoutes(
      app,
      { version: "test" } as ServerEnv,
      async () => {
        throw new Error("postgres://secret");
      },
    );
    try {
      const reply = await app.inject("/api/ready");
      expect(reply.statusCode).toBe(503);
      expect(reply.body).not.toContain("secret");
    } finally {
      await app.close();
    }
  });
});

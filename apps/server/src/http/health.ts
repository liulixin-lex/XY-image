import { healthResponseSchema } from "@loomic/shared";
import type { FastifyInstance } from "fastify";
import type { ServerEnv } from "../config/env.js";
import type { ReadinessResult } from "../supabase/readiness.js";
export async function registerHealthRoutes(
  app: FastifyInstance,
  env: ServerEnv,
  probe?: () => Promise<ReadinessResult>,
) {
  app.get("/api/health", async (_request, reply) =>
    reply.code(200).send(
      healthResponseSchema.parse({
        ok: true,
        service: "loomic-server",
        version: env.version,
      }),
    ),
  );
  app.get("/api/ready", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const result = (await probe?.()) ?? {
        ok: false,
        checks: { configured: false },
      };
      return reply.code(result.ok ? 200 : 503).send(result);
    } catch {
      return reply
        .code(503)
        .send({ ok: false, checks: { dependencies: false } });
    }
  });
}

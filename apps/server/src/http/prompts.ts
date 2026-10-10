import type { FastifyInstance } from "fastify";

import {
  optimizePromptRequestSchema,
  optimizePromptResponseSchema,
} from "@loomic/shared";

import type { PromptOptimizer } from "../features/prompts/prompt-optimizer.js";
import { BillingGuardError } from "../features/xy2api/errors.js";
import type { RequestAuthenticator } from "../supabase/user.js";
import { RequestLimiter } from "../utils/request-limiter.js";
import { sendAccountError } from "./account.js";

/**
 * POST /api/prompts/optimize: the studio's "优化提示词". One chat request per
 * click on the user's own chat model; a small per-user cap keeps a stuck
 * button from spending their balance.
 */
export function registerPromptRoutes(
  app: FastifyInstance,
  options: { auth: RequestAuthenticator; optimizer: PromptOptimizer },
) {
  const limiter = new RequestLimiter(12);
  app.post(
    "/api/prompts/optimize",
    { bodyLimit: 32 * 1024 },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      try {
        const user = await options.auth.authenticate(request);
        if (!user) throw new BillingGuardError("xy2api_reauth_required", 401);
        const input = optimizePromptRequestSchema.parse(request.body);
        const retry = limiter.take(user.id);
        if (retry) {
          reply.header("Retry-After", retry);
          throw new BillingGuardError("rate_limited", 429);
        }
        const result = await options.optimizer.optimize(user.id, input);
        return reply.code(200).send(optimizePromptResponseSchema.parse(result));
      } catch (error) {
        return sendAccountError(reply, error);
      }
    },
  );
}

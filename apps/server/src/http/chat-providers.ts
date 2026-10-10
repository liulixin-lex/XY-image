import type { FastifyInstance } from "fastify";
import { ChatProviderError } from "../features/chat-providers/errors.js";
import type { ChatProviderService } from "../features/chat-providers/service.js";
import { BillingGuardError } from "../features/xy2api/errors.js";
import type { RequestAuthenticator } from "../supabase/user.js";
import { RequestLimiter } from "../utils/request-limiter.js";
import { isZodError } from "../utils/zod-error.js";
import { sendAccountError } from "./account.js";

export function registerChatProviderRoutes(
  app: FastifyInstance,
  options: {
    auth: RequestAuthenticator;
    providers: ChatProviderService;
  },
) {
  const limiter = new RequestLimiter(10);
  app.register(async (routes) => {
    routes.setErrorHandler((error, _request, reply) => {
      if (
        isZodError(error) ||
        (!(error instanceof ChatProviderError) &&
          error &&
          typeof error === "object" &&
          "statusCode" in error &&
          error.statusCode === 400)
      )
        return reply.code(400).send({
          error: {
            code: "invalid_request",
            message: "服务商设置格式不正确，请检查输入",
          },
        });
      return sendAccountError(reply, error);
    });
    for (const operation of [
      {
        method: "GET" as const,
        url: "/api/chat-providers",
        action: "list" as const,
      },
      {
        method: "POST" as const,
        url: "/api/chat-providers",
        action: "create" as const,
      },
      {
        method: "PATCH" as const,
        url: "/api/chat-providers/:id",
        action: "patch" as const,
      },
      {
        method: "DELETE" as const,
        url: "/api/chat-providers/:id",
        action: "delete" as const,
      },
      {
        method: "POST" as const,
        url: "/api/chat-providers/:id/refresh-models",
        action: "refresh" as const,
      },
    ])
      routes.route<{ Params: { id?: string } }>({
        ...operation,
        bodyLimit: 64 * 1024,
        async handler(request, reply) {
          reply.header("Cache-Control", "no-store");
          const user = await options.auth.authenticate(request);
          if (!user) throw new BillingGuardError("xy2api_reauth_required", 401);
          const id = request.params.id ?? "";
          if (operation.action === "list")
            return { providers: await options.providers.list(user.id) };
          if (operation.action === "delete") {
            await options.providers.delete(user.id, id);
            return reply.code(204).send();
          }
          const retry = limiter.take(user.id);
          if (retry) {
            reply.header("Retry-After", retry);
            throw new ChatProviderError("rate_limited", 429);
          }
          if (operation.action === "create") {
            const provider = await options.providers.create(
              user.id,
              request.body as Parameters<ChatProviderService["create"]>[1],
            );
            return reply.code(201).send({ provider });
          }
          if (operation.action === "patch")
            return {
              provider: await options.providers.patch(
                user.id,
                id,
                request.body as Parameters<ChatProviderService["patch"]>[2],
              ),
            };
          return { provider: await options.providers.refresh(user.id, id) };
        },
      });
  });
}

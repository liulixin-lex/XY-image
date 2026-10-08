import type { FastifyInstance } from "fastify";
import type { ChatProviderService } from "../features/chat-providers/service.js";
import { BillingGuardError } from "../features/xy2api/errors.js";
import type { KeyService } from "../features/xy2api/key-service.js";
import type { RequestAuthenticator } from "../supabase/user.js";
import { sendAccountError } from "./account.js";

export function registerModelRoutes(
  app: FastifyInstance,
  options: {
    auth: RequestAuthenticator;
    keys: KeyService;
    providers: ChatProviderService;
  },
) {
  app.get("/api/models", async (request, reply) => {
    try {
      reply.header("Cache-Control", "no-store");
      const user = await options.auth.authenticate(request);
      if (!user) throw new BillingGuardError("xy2api_reauth_required", 401);
      const providers = await options.providers.list(user.id);
      let xy2api: { available: boolean; error?: string } = { available: true };
      let mainModels: string[] = [];
      try {
        mainModels = (await options.keys.resolveChatCredential(user.id))
          .chatModels;
      } catch (error) {
        if (error instanceof BillingGuardError && error.statusCode === 401)
          throw error;
        xy2api = {
          available: false,
          error:
            error instanceof BillingGuardError
              ? error.code
              : "xy2api_unavailable",
        };
      }
      return {
        models: [
          ...mainModels.map((id) => ({
            id: `openai:${id}`,
            name: id,
            provider: "openai",
            source: "xy2api",
            billing: "xy2api",
          })),
          ...providers
            .filter((p) => p.enabled)
            .flatMap((p) =>
              p.models.map((id) => ({
                id: `custom:${p.id}:${id}`,
                name: id,
                provider: "openai",
                source: "custom",
                providerId: p.id,
                providerName: p.name,
                billing: "external",
              })),
            ),
        ],
        xy2api,
      };
    } catch (error) {
      return sendAccountError(reply, error);
    }
  });
}

import type { FastifyInstance } from "fastify";
import { BillingGuardError } from "../features/xy2api/errors.js";
import type { KeyService } from "../features/xy2api/key-service.js";
import type { RequestAuthenticator } from "../supabase/user.js";
import { sendAccountError } from "./account.js";
export function registerModelRoutes(
  app: FastifyInstance,
  options: { auth: RequestAuthenticator; keys: KeyService },
) {
  app.get("/api/models", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);
      if (!user) throw new BillingGuardError("xy2api_reauth_required", 401);
      const credential = await options.keys.resolveChatCredential(user.id);
      return {
        models: credential.chatModels.map((id) => ({
          id: `openai:${id}`,
          name: id,
          provider: "openai",
        })),
      };
    } catch (error) {
      return sendAccountError(reply, error);
    }
  });
}

import type { FastifyInstance } from "fastify";
import { findImageModel } from "../features/xy2api/catalog.js";
import { BillingGuardError } from "../features/xy2api/errors.js";
import type { KeyService } from "../features/xy2api/key-service.js";
import type { RequestAuthenticator } from "../supabase/user.js";
import { sendAccountError } from "./account.js";
export function registerImageModelRoutes(
  app: FastifyInstance,
  options: { auth: RequestAuthenticator; keys: KeyService },
) {
  app.get("/api/image-models", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);
      if (!user) throw new BillingGuardError("xy2api_reauth_required", 401);
      const credential = await options.keys.resolveImageCredential(user.id);
      return {
        models: credential.imageModels.flatMap((id) => {
          const model = findImageModel(options.keys.catalog, id);
          return model
            ? [
                {
                  id,
                  displayName: model.displayName,
                  description: model.description,
                  provider:
                    model.protocol === "gemini"
                      ? "xy2api-gemini"
                      : "xy2api-openai",
                  accessible: true,
                  creditCost: 0,
                  minTier: "free",
                  priceUsd: null,
                  maxQuality: model.maxQuality,
                },
              ]
            : [];
        }),
      };
    } catch (error) {
      return sendAccountError(reply, error);
    }
  });
}

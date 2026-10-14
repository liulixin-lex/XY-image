import type { FastifyInstance } from "fastify";
import type { ServerEnv } from "../config/env.js";
import {
  IMAGE_PROVIDER_BY_PROTOCOL,
  findImageModel,
  supportsMaskEdit,
} from "../features/xy2api/catalog.js";
import { BillingGuardError } from "../features/xy2api/errors.js";
import type { KeyService } from "../features/xy2api/key-service.js";
import type { RequestAuthenticator } from "../supabase/user.js";
import { sendAccountError } from "./account.js";
export function registerImageModelRoutes(
  app: FastifyInstance,
  options: {
    auth: RequestAuthenticator;
    keys: KeyService;
    /** The site's own output format, shown as 「默认」 next to 格式 (第 66 条). */
    env?: Pick<ServerEnv, "imageOutputFormat" | "imageOutputCompression">;
  },
) {
  // GET /api/image-models — every model of every image key that is on
  // (第 56 条), grouped by key: the default key first, then newest first.
  // The same model can appear under two keys (two groups, two prices); the
  // page sends `key_id` with the model so the request uses the one picked.
  app.get("/api/image-models", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);
      if (!user) throw new BillingGuardError("xy2api_reauth_required", 401);
      const keys = await options.keys.imageKeys(user.id);
      return {
        ...(options.env
          ? {
              outputDefaults: {
                format: options.env.imageOutputFormat,
                compression: options.env.imageOutputCompression,
              },
            }
          : {}),
        keys: keys.map((key) => ({
          keyId: key.keyId,
          name: key.name,
          groupName: key.groupName,
          isDefault: key.isDefault,
        })),
        models: keys.flatMap((key) =>
          key.imageModels.flatMap((id) => {
            const model = findImageModel(options.keys.catalog, id);
            return model
              ? [
                  {
                    id,
                    keyId: key.keyId,
                    keyName: key.name,
                    groupName: key.groupName,
                    displayName: model.displayName,
                    description: model.description,
                    provider: IMAGE_PROVIDER_BY_PROTOCOL[model.protocol],
                    vendor: model.vendor,
                    accessible: true,
                    creditCost: 0,
                    minTier: "free",
                    priceUsd: null,
                    // What the picker may offer for this model; the server
                    // moves anything else to the closest supported value.
                    resolutions: model.resolutions,
                    qualities: model.qualities,
                    aspectRatios: model.aspectRatios,
                    maxRatio: model.maxRatio,
                    // 第 66 条: what 质量「自动」 amounts to, and the OpenAI
                    // output options (empty for models without them).
                    ...(model.autoQuality
                      ? { autoQuality: model.autoQuality }
                      : {}),
                    backgrounds: model.backgrounds,
                    outputFormats: model.outputFormats,
                    moderations: model.moderations,
                    supportsEdit: model.supportsEdit,
                    maxInputImages: model.supportsEdit
                      ? model.maxInputImages
                      : 0,
                    // 局部重绘 / 扩图 in the studio.
                    maskEdit: supportsMaskEdit(model),
                  },
                ]
              : [];
          }),
        ),
      };
    } catch (error) {
      return sendAccountError(reply, error);
    }
  });
}

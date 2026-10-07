import OpenAI from "openai";
import { loadServerEnv } from "../src/config/env.js";
import {
  findImageModel,
  loadImageCatalog,
  matchImageModels,
} from "../src/features/xy2api/catalog.js";
import { Xy2apiClient } from "../src/features/xy2api/client.js";
import {
  BillingGuardError,
  GatewayError,
  Xy2apiError,
  mapGatewayError,
  sanitizeGatewayError,
} from "../src/features/xy2api/errors.js";
import { generateImage } from "../src/generation/image-generation.js";
import { registerAllProviders } from "../src/generation/providers/register-all.js";
import { resolveImageProviderName } from "../src/generation/providers/registry.js";

async function main() {
  const env = loadServerEnv();
  const apiKey = process.env.PREFLIGHT_API_KEY;
  if (!apiKey) throw new Error("PREFLIGHT_API_KEY is required");
  const client = new Xy2apiClient(env.xy2apiBaseUrl);
  const models = await client.listModels(apiKey);
  const usage = await client.getUsage(apiKey);
  console.log(
    JSON.stringify({
      stage: "catalog",
      modelCount: models.length,
      balance: usage.balance ?? usage.remaining ?? null,
      unit: "USD",
    }),
  );
  const catalog = loadImageCatalog(env.imageModelsJson);
  const imageModels = matchImageModels(
    catalog,
    process.env.PREFLIGHT_KEY_PLATFORM ?? "",
    models,
  );
  if (!imageModels.length)
    throw new Error(
      "No image models discovered; configure PREFLIGHT_KEY_PLATFORM when the gateway omits image models",
    );
  registerAllProviders(env);
  for (const model of imageModels) {
    for (const quality of ["standard", "hd"] as const) {
      const started = Date.now();
      const result = await generateImage(
        resolveImageProviderName(model),
        {
          model,
          quality,
          prompt: "一颗红苹果，纯白背景，无文字",
          aspectRatio: "1:1",
        },
        { apiKey, baseUrl: env.xy2apiBaseUrl },
      );
      console.log(
        JSON.stringify({
          stage: "image",
          model,
          requestedQuality: quality,
          effectiveQuality:
            quality === "hd"
              ? findImageModel(catalog, model)?.maxQuality
              : "standard",
          elapsedMs: Date.now() - started,
          bytes: Buffer.from(result.url.split(",", 2)[1] ?? "", "base64")
            .length,
          mime: result.mimeType,
          requestId: result.requestId ?? null,
        }),
      );
    }
  }
  const model = env.chatModels.find((id) => models.includes(id));
  if (!model) throw new BillingGuardError("model_not_accessible");
  const sdk = new OpenAI({
    apiKey,
    baseURL: `${env.xy2apiBaseUrl}/v1`,
    maxRetries: 0,
    timeout: 60000,
    defaultHeaders: { "User-Agent": "LoomicServer/1.0" },
  });
  const started = Date.now();
  try {
    if (/^gpt-6[.-]/.test(model))
      await sdk.responses.create({ model, input: "请回复：连接正常" });
    else
      await sdk.chat.completions.create({
        model,
        messages: [{ role: "user", content: "请回复：连接正常" }],
        stream: false,
      });
  } catch (error) {
    throw sanitizeGatewayError(error);
  }
  console.log(
    JSON.stringify({
      stage: "chat",
      model,
      elapsedMs: Date.now() - started,
      ok: true,
    }),
  );
  console.log("预检完成，请在主站用量页逐条核对次数及 client:<requestId>。");
}

main().catch((error) => {
  if (error instanceof Xy2apiError)
    console.error(
      JSON.stringify({
        code: mapGatewayError({
          status: error.status,
          body: { code: error.id },
        }).code,
      }),
    );
  else if (error instanceof BillingGuardError || error instanceof GatewayError)
    console.error(JSON.stringify({ code: error.code, message: error.message }));
  else
    console.error(
      "Preflight configuration or response validation failed; check required environment and model discovery.",
    );
  process.exitCode = 1;
});

import { formatChatModelRef, parseChatModelRef } from "@loomic/shared";
import type { ServerEnv } from "../../config/env.js";
import { BillingGuardError } from "../xy2api/errors.js";
import type { KeyService } from "../xy2api/key-service.js";
import { ChatProviderError } from "./errors.js";
import type { ChatProviderService } from "./service.js";

export type ResolvedChat =
  | {
      source: "xy2api";
      ref: string;
      credentials: { apiKey: string; baseUrl: string };
    }
  | {
      source: "custom";
      ref: string;
      customChat: {
        model: string;
        providerId: string;
        baseUrl: string;
        transport: typeof fetch;
      };
    };

export async function resolveRunChatModel(options: {
  userId: string;
  override?: string;
  keys: KeyService;
  providers: ChatProviderService;
  env: Pick<ServerEnv, "xy2apiBaseUrl" | "agentModel">;
}): Promise<ResolvedChat> {
  const { userId, keys, providers, env } = options;
  if (options.override) {
    const ref = parseChatModelRef(options.override);
    if (ref?.source === "custom")
      return {
        source: "custom",
        ref: formatChatModelRef(ref),
        customChat: await providers.credential(
          userId,
          ref.providerId,
          ref.model,
        ),
      };
    if (!ref && /^(custom|openai):/.test(options.override))
      throw new ChatProviderError("invalid_request");
    const model = ref?.model ?? options.override; // Legacy bare main-site IDs remain accepted.
    const credential = await keys.resolveChatCredential(userId);
    if (!credential.chatModels.includes(model))
      throw new BillingGuardError("model_not_accessible", 403);
    return {
      source: "xy2api",
      ref: `openai:${model}`,
      credentials: { apiKey: credential.apiKey, baseUrl: env.xy2apiBaseUrl },
    };
  }
  const preferences = await keys.preferences(userId);
  if (preferences.default_chat_provider_id) {
    let enabled = false;
    try {
      enabled = (
        await providers.getOwned(userId, preferences.default_chat_provider_id)
      ).enabled;
    } catch (error) {
      if (
        !(error instanceof ChatProviderError) ||
        error.code !== "provider_not_found"
      )
        throw error;
    }
    if (enabled && preferences.default_chat_model) {
      const model = preferences.default_chat_model;
      return {
        source: "custom",
        ref: formatChatModelRef({
          source: "custom",
          providerId: preferences.default_chat_provider_id,
          model,
        }),
        customChat: await providers.credential(
          userId,
          preferences.default_chat_provider_id,
          model,
        ),
      };
    }
  }
  const credential = await keys.resolveChatCredential(userId);
  const preferred = !preferences.default_chat_provider_id
    ? preferences.default_chat_model
    : null;
  const model =
    preferred && credential.chatModels.includes(preferred)
      ? preferred
      : (credential.chatModels[0] ?? env.agentModel.replace(/^openai:/, ""));
  if (!model) throw new BillingGuardError("key_unavailable", 403);
  return {
    source: "xy2api",
    ref: `openai:${model}`,
    credentials: { apiKey: credential.apiKey, baseUrl: env.xy2apiBaseUrl },
  };
}

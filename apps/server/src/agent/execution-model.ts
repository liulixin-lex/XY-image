import {
  type ChatEffort,
  chatEffortSchema,
  chatModelFamily,
  parseChatModelRef,
} from "@loomic/shared";

import type { ServerEnv } from "../config/env.js";
import {
  type ResolvedChat,
  resolveRunChatModel,
} from "../features/chat-providers/model-resolver.js";
import type { ChatProviderService } from "../features/chat-providers/service.js";
import type { KeyService } from "../features/xy2api/key-service.js";
import { describeErrorForLog } from "../utils/error-sanitizer.js";
import type { ExecutionOptions } from "./deep-agent.js";

/**
 * 第 70 条 执行步骤模型, resolved per run from 设置 › 模型 (xy2api_preferences
 * agent_exec_model / agent_exec_effort):
 * - no model, or the chat model itself: the chat model, at the saved level
 *   or 低 (deep-agent.ts applies defaultExecutionEffort);
 * - another model: resolved like the chat model (main-site key or the
 *   user's own provider). One that can no longer be used (the key lost the
 *   model, the provider was switched off) never fails the run: the chat
 *   model takes the steps, logged as `[agent-model] execution model …`.
 */
export async function resolveExecution(options: {
  userId: string;
  chat: ResolvedChat;
  prefs: { agent_exec_model: string | null; agent_exec_effort: string | null };
  keys: KeyService;
  providers: ChatProviderService;
  env: Pick<ServerEnv, "xy2apiBaseUrl" | "agentModel">;
}): Promise<ExecutionOptions> {
  const parsed = chatEffortSchema.safeParse(options.prefs.agent_exec_effort);
  const effort: ChatEffort | undefined = parsed.success
    ? parsed.data
    : undefined;
  const wanted = options.prefs.agent_exec_model;
  if (!wanted || wanted === options.chat.ref) return effort ? { effort } : {};
  try {
    const resolved = await resolveRunChatModel({
      userId: options.userId,
      override: wanted,
      keys: options.keys,
      providers: options.providers,
      env: options.env,
    });
    if (resolved.source === "custom") {
      const ref = parseChatModelRef(resolved.ref);
      return {
        model: {
          source: "custom",
          customChat: resolved.customChat,
          providerId: ref?.source === "custom" ? ref.providerId : "custom",
        },
        ...(effort ? { effort } : {}),
      };
    }
    return {
      model: {
        source: "xy2api",
        ref: resolved.ref,
        credentials: resolved.credentials,
      },
      ...(effort ? { effort } : {}),
    };
  } catch (error) {
    console.warn(
      `[agent-model] execution model ${wanted.slice(0, 80)} is not usable (${describeErrorForLog(error)}); the chat model takes the steps at 低`,
    );
    return {};
  }
}

/**
 * 第 70 条 search_web's last resort: a Gemini chat model on the user's
 * main-site chat key (a Flash one when there is), for Gemini's Google
 * Search when every free source is empty. Undefined without a usable key.
 */
export async function searchFallbackFor(options: {
  userId: string;
  keys: KeyService;
  env: Pick<ServerEnv, "xy2apiBaseUrl" | "webSearchGeminiFallback">;
}): Promise<{ baseUrl: string; apiKey: string; model: string } | undefined> {
  if (options.env.webSearchGeminiFallback === "off") return undefined;
  try {
    const credential = await options.keys.resolveChatCredential(options.userId);
    const gemini = credential.chatModels.filter(
      (m) => chatModelFamily(m) === "gemini",
    );
    const model =
      gemini.find((m) => /flash/i.test(m) && !/lite|image/i.test(m)) ??
      gemini.find((m) => !/image/i.test(m));
    return model
      ? {
          baseUrl: options.env.xy2apiBaseUrl,
          apiKey: credential.apiKey,
          model,
        }
      : undefined;
  } catch {
    return undefined;
  }
}

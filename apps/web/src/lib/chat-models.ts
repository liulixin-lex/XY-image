/**
 * Chat models for the design agent: main-site models and models from the
 * user's own OpenAI-compatible providers (plan §6.4).
 *
 * Model ids, as `/api/models` lists them and the runtime accepts them:
 *   openai:<model>                main site, billed to the xy2api balance
 *   custom:<providerId>:<model>   the user's own provider, billed by it
 * Model names may contain ":" or "/", so only the first two colons split.
 * Parsing and formatting come from @loomic/shared so the web and the agent
 * runtime (model-resolver.ts) can never disagree on an id.
 */
import { type ChatModelRef, formatChatModelRef, parseChatModelRef } from "@loomic/shared";

import type { AccountPreferences, PreferencesPatch } from "./xy2api-api";

export { type ChatModelRef, formatChatModelRef, parseChatModelRef };

/**
 * The saved default as a model id. Preferences keep the bare model name plus
 * an optional provider id (null or missing = main site).
 */
export function preferredChatModelId(prefs: AccountPreferences | null | undefined): string | null {
  const model = prefs?.default_chat_model;
  if (!model) return null;
  const providerId = prefs.default_chat_provider_id;
  return formatChatModelRef(
    providerId ? { source: "custom", providerId, model } : { source: "xy2api", model },
  );
}

/**
 * Preferences update for a new default chat model. Older servers neither
 * list nor accept `defaultChatProviderId` (their schema is strict) and never
 * list custom models, so the field only goes out when the server has it or
 * the model is custom. Returns null for an id that is not a model ref.
 */
export function chatPreferencePatch(
  id: string,
  prefs: AccountPreferences | null | undefined,
): PreferencesPatch | null {
  const ref = parseChatModelRef(id);
  if (!ref) return null;
  const patch: PreferencesPatch = { defaultChatModel: ref.model };
  if (ref.source === "custom") patch.defaultChatProviderId = ref.providerId;
  else if (prefs?.default_chat_provider_id !== undefined) patch.defaultChatProviderId = null;
  return patch;
}

// ---------------------------------------------------------------------------
// /api/models
// ---------------------------------------------------------------------------

export type ChatModel = {
  id: string;
  name: string;
  provider: string;
  source: "xy2api" | "custom";
  /** Who charges for the chat: the main-site balance, or the user's provider. */
  billing: "xy2api" | "external";
  providerId: string | null;
  providerName: string | null;
};

export type ChatModelList = {
  models: ChatModel[];
  /**
   * Main-site chat key. When it is unusable the list still carries the
   * user's own providers, and `error` says why the main site is missing.
   */
  xy2api: { available: boolean; error: string | null };
};

type RawChatModel = {
  id: string;
  name: string;
  provider: string;
  source?: string;
  providerId?: string;
  providerName?: string;
  billing?: string;
};

export type RawChatModelList = {
  models?: RawChatModel[];
  xy2api?: { available?: boolean; error?: string | null };
};

/**
 * Accepts both shapes: the current `{ models }` (main site only, the request
 * fails as a whole without a chat key) and the merged list of plan §6.4.
 */
export function normalizeChatModelList(raw: RawChatModelList): ChatModelList {
  const models = (raw.models ?? []).map((item): ChatModel => {
    const ref = parseChatModelRef(item.id);
    const custom = item.source ? item.source === "custom" : ref?.source === "custom";
    return {
      id: item.id,
      name: item.name,
      provider: item.provider,
      source: custom ? "custom" : "xy2api",
      billing: item.billing === "xy2api" || item.billing === "external"
        ? item.billing
        : custom ? "external" : "xy2api",
      providerId: custom
        ? (item.providerId ?? (ref?.source === "custom" ? ref.providerId : null))
        : null,
      providerName: custom ? (item.providerName ?? null) : null,
    };
  });
  return {
    models,
    xy2api: {
      available: raw.xy2api?.available ?? true,
      error: raw.xy2api?.error ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Picker grouping
// ---------------------------------------------------------------------------

export type ChatModelGroup = {
  key: string;
  /** "主站" or the provider's name. */
  label: string;
  source: ChatModel["source"];
  models: ChatModel[];
};

/** Main site first, then each provider in the order the API lists them. */
export function groupChatModels(models: ChatModel[]): ChatModelGroup[] {
  const groups = new Map<string, ChatModelGroup>();
  const main: ChatModelGroup = { key: "xy2api", label: "主站", source: "xy2api", models: [] };
  for (const model of models) {
    if (model.source === "xy2api") {
      main.models.push(model);
      continue;
    }
    const key = `custom:${model.providerId ?? model.providerName ?? "unknown"}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, label: model.providerName || "我的服务商", source: "custom", models: [] };
      groups.set(key, group);
    }
    group.models.push(model);
  }
  return [...(main.models.length ? [main] : []), ...groups.values()];
}

/** One-line billing note for a model, shown where it is picked. */
export function chatBillingNote(model: ChatModel): string {
  return model.billing === "external"
    ? `对话费用由「${model.providerName || "你的服务商"}」收取，不从主站余额扣`
    : "对话费用从主站余额扣";
}

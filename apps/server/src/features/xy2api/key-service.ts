import type { ServerEnv } from "../../config/env.js";
import type { AdminSupabaseClient } from "../../supabase/admin.js";
import type { ChatProviderService } from "../chat-providers/service.js";
import type { AccountService } from "./account-service.js";
import {
  type ImageModel,
  findImageModel,
  matchImageModels,
} from "./catalog.js";
import type { RemoteKey, Xy2apiClient } from "./client.js";
import {
  BillingGuardError,
  type GatewayCode,
  Xy2apiError,
  mapGatewayError,
} from "./errors.js";
import type { SecretBox } from "./secret-box.js";
import {
  type KeyRow,
  type PreferencesRow,
  checkStoreError,
  integrationClient,
} from "./store.js";

export function isKeyUsable(row: KeyRow): boolean {
  return (
    row.status === "active" &&
    !row.invalid_reason &&
    (!row.expires_at || Date.parse(row.expires_at) > Date.now()) &&
    (row.quota <= 0 || row.quota_used < row.quota)
  );
}
// Model-discovery refusals that are evidence about the key (or its owner).
// Anything else — notably 403 INSUFFICIENT_BALANCE, which xy2api answers on
// /v1/models before looking at the key — says nothing about the key: it stays
// selectable with the models we last saw, and generation reports the real
// reason (402 + recharge) instead of "pick another key".
const KEY_LEVEL_DISCOVERY_FAILURES = new Set<GatewayCode>([
  "key_unavailable",
  "key_ip_restricted",
  "xy2api_reauth_required",
]);
// Minimum gap between automatic re-discovery attempts for one user.
const REDISCOVERY_GAP_MS = 15_000;

export type ImageCredential = {
  keyId: number;
  apiKey: string;
  platform: string;
  imageModels: string[];
};
export type ChatCredential = {
  keyId: number;
  apiKey: string;
  platform: string;
  chatModels: string[];
};

export class KeyService {
  private syncs = new Map<string, Promise<void>>();
  /**
   * Users whose last sync could not list models for some key, with the reason
   * and when it was last tried. In memory and best effort: on another
   * instance (or after a restart) the next login or manual sync re-runs it.
   */
  private deferredDiscovery = new Map<string, { code: string; at: number }>();
  constructor(
    private readonly getAdmin: () => AdminSupabaseClient,
    private readonly accounts: AccountService,
    private readonly client: Xy2apiClient,
    private readonly box: SecretBox,
    readonly catalog: ImageModel[],
    private readonly env: Pick<ServerEnv, "chatModels">,
    private readonly providers?: ChatProviderService,
  ) {}
  private db() {
    return integrationClient(this.getAdmin());
  }
  async rows(userId: string): Promise<KeyRow[]> {
    const { data, error } = await this.db()
      .from("xy2api_api_keys")
      .select("*")
      .eq("user_id", userId)
      .order("key_id");
    checkStoreError(error);
    return data ?? [];
  }
  async preferences(userId: string): Promise<PreferencesRow> {
    const { data, error } = await this.db()
      .from("xy2api_preferences")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    checkStoreError(error);
    return {
      ...(data ?? {
        user_id: userId,
        image_key_id: null,
        chat_key_id: null,
        default_image_model: null,
        default_chat_model: null,
      }),
      default_chat_provider_id: data?.default_chat_provider_id ?? null,
    };
  }
  syncKeys(userId: string): Promise<void> {
    const pending = this.syncs.get(userId);
    if (pending) return pending;
    const work = this.sync(userId);
    this.syncs.set(userId, work);
    void work.finally(() => this.syncs.delete(userId)).catch(() => {});
    return work;
  }
  private async sync(userId: string): Promise<void> {
    const remote = await this.accounts.withAccess(userId, (token) =>
      this.client.listKeys(token),
    );
    const previous = new Map(
      (await this.rows(userId)).map((row) => [row.key_id, row]),
    );
    const rows: KeyRow[] = [];
    let deferred: string | null = null;
    for (let index = 0; index < remote.length; index += 3) {
      for (const result of await Promise.all(
        remote
          .slice(index, index + 3)
          .map((key) => this.syncRow(userId, key, previous.get(key.id))),
      )) {
        rows.push(result.row);
        deferred ??= result.deferred;
      }
    }
    if (deferred) {
      if (this.deferredDiscovery.size > 10000) this.deferredDiscovery.clear();
      this.deferredDiscovery.set(userId, { code: deferred, at: Date.now() });
    } else this.deferredDiscovery.delete(userId);
    if (rows.length)
      checkStoreError(
        (await this.db().from("xy2api_api_keys").upsert(rows)).error,
      );
    const ids = new Set(rows.map((row) => row.key_id));
    const stale = (await this.rows(userId))
      .filter((row) => !ids.has(row.key_id))
      .map((row) => row.key_id);
    if (stale.length)
      checkStoreError(
        (
          await this.db()
            .from("xy2api_api_keys")
            .delete()
            .eq("user_id", userId)
            .in("key_id", stale)
        ).error,
      );
    const prefs = await this.preferences(userId);
    const image =
      rows.find(
        (row) =>
          row.key_id === prefs.image_key_id &&
          row.image_capable &&
          isKeyUsable(row),
      ) ?? rows.find((row) => row.image_capable && isKeyUsable(row));
    const chat =
      rows.find(
        (row) =>
          row.key_id === prefs.chat_key_id &&
          row.chat_models.length &&
          isKeyUsable(row),
      ) ??
      (image?.chat_models.length
        ? image
        : rows.find((row) => row.chat_models.length && isKeyUsable(row)));
    await this.savePreferences({
      ...prefs,
      image_key_id: image?.key_id ?? null,
      chat_key_id: chat?.key_id ?? null,
      default_image_model: image?.image_models.includes(
        prefs.default_image_model ?? "",
      )
        ? prefs.default_image_model
        : (image?.image_models[0] ?? null),
      default_chat_model: prefs.default_chat_provider_id
        ? prefs.default_chat_model
        : chat?.chat_models.includes(prefs.default_chat_model ?? "")
          ? prefs.default_chat_model
          : (chat?.chat_models[0] ?? null),
    });
  }
  private async syncRow(
    userId: string,
    key: RemoteKey,
    previous: KeyRow | undefined,
  ): Promise<{ row: KeyRow; deferred: string | null }> {
    const group = key.group;
    const platform = group?.platform ?? "";
    const supported = [
      "openai",
      "grok",
      "gemini",
      "antigravity",
      "composite",
    ].includes(platform);
    let models: string[] = [];
    let invalid: string | null = null;
    // Why model discovery could not run this time (key itself not at fault).
    let deferred: string | null = null;
    if (key.masked) {
      // TODO(xy2api-compat): if a future xy2api only returns masked keys from
      // the list endpoint, fetch the full key via GET /api/v1/keys/:id here.
      console.warn(
        `[xy2api] key ${key.id} arrived masked from the main site; marking unusable`,
      );
      invalid = "key_unavailable";
    } else if (
      key.status === "active" &&
      supported &&
      group?.status === "active"
    ) {
      try {
        models = await this.client.listModels(key.key);
      } catch (error) {
        const code =
          error instanceof Xy2apiError && [401, 403].includes(error.status)
            ? mapGatewayError({
                status: error.status,
                body: { code: error.id },
              }).code
            : null;
        if (code && KEY_LEVEL_DISCOVERY_FAILURES.has(code)) invalid = code;
        else {
          deferred =
            code ??
            (error instanceof Xy2apiError
              ? `${error.status} ${error.id}`
              : "network");
          console.warn(
            `[xy2api] key ${key.id} model discovery deferred (${deferred}); keeping last known models`,
          );
        }
      }
    }
    // Last discovery result for this key, while its group is unchanged.
    const lastKnown =
      deferred && previous?.group_id === (group?.id ?? null)
        ? previous
        : undefined;
    const imageModels = lastKnown?.image_models.length
      ? lastKnown.image_models
      : matchImageModels(this.catalog, platform, models);
    const chatSource = lastKnown?.chat_models ?? models;
    const row: KeyRow = {
      user_id: userId,
      key_id: key.id,
      name: key.name,
      masked_key:
        key.key.length > 10
          ? `${key.key.slice(0, 6)}…${key.key.slice(-4)}`
          : "••••••",
      secret_enc: this.box.sealSecret(key.key),
      status: key.status,
      group_id: group?.id ?? null,
      group_name: group?.name ?? null,
      platform: platform || null,
      subscription_type: group?.subscription_type ?? null,
      allow_image_generation: Boolean(group?.allow_image_generation),
      image_capable: false,
      pricing: {
        image_price_1k: group?.image_price_1k ?? null,
        image_price_2k: group?.image_price_2k ?? null,
        image_price_4k: group?.image_price_4k ?? null,
        rate_multiplier: group?.rate_multiplier ?? 1,
        image_rate_independent: group?.image_rate_independent ?? false,
        image_rate_multiplier: group?.image_rate_multiplier ?? 1,
      },
      image_models: imageModels,
      chat_models:
        group?.status === "active"
          ? this.env.chatModels.filter((id) => chatSource.includes(id))
          : [],
      quota: key.quota ?? 0,
      quota_used: key.quota_used ?? 0,
      expires_at: key.expires_at ?? null,
      has_ip_restriction: Boolean(
        key.ip_whitelist?.length || key.ip_blacklist?.length,
      ),
      invalid_reason: invalid,
      synced_at: new Date().toISOString(),
    };
    row.image_capable =
      isKeyUsable(row) &&
      group?.status === "active" &&
      supported &&
      (!["openai", "grok"].includes(platform) || row.allow_image_generation) &&
      imageModels.length > 0;
    return { row, deferred };
  }
  /**
   * Re-runs a sync whose model discovery was blocked, once the caller has
   * seen a sign it may now succeed (e.g. a positive balance after a recharge).
   * Returns true when a sync ran, so callers can drop cached state.
   */
  async retryDeferredDiscovery(userId: string): Promise<boolean> {
    const entry = this.deferredDiscovery.get(userId);
    if (!entry || Date.now() - entry.at < REDISCOVERY_GAP_MS) return false;
    entry.at = Date.now();
    try {
      await this.syncKeys(userId);
      console.info(
        `[xy2api] re-ran deferred key discovery for user ${userId} (was ${entry.code})`,
      );
      return true;
    } catch (error) {
      console.warn(
        `[xy2api] deferred key discovery retry failed: ${error instanceof Error ? error.name : "unknown"}`,
      );
      return false;
    }
  }
  /** Why the user's last sync could not list models, if it could not. */
  deferredDiscoveryReason(userId: string): string | null {
    return this.deferredDiscovery.get(userId)?.code ?? null;
  }
  private async selected(
    userId: string,
    keyId: number | null,
  ): Promise<KeyRow> {
    if (!keyId) throw new BillingGuardError("key_unavailable", 403);
    const { data, error } = await this.db()
      .from("xy2api_api_keys")
      .select("*")
      .eq("user_id", userId)
      .eq("key_id", keyId)
      .maybeSingle();
    checkStoreError(error);
    if (data?.invalid_reason === "key_ip_restricted")
      throw new BillingGuardError("key_ip_restricted", 403);
    if (data && data.quota > 0 && data.quota_used >= data.quota)
      throw new BillingGuardError("key_quota_exhausted", 429);
    if (!data || !isKeyUsable(data))
      throw new BillingGuardError("key_unavailable", 403);
    return data;
  }
  private async decryptKey(userId: string, sealed: string): Promise<string> {
    try {
      return this.box.openSecret(sealed);
    } catch {
      await this.accounts.markReauth(userId);
      throw new BillingGuardError("xy2api_reauth_required", 401);
    }
  }
  async resolveImageCredential(
    userId: string,
    keyId?: number,
  ): Promise<ImageCredential> {
    const row = await this.selected(
      userId,
      keyId ?? (await this.preferences(userId)).image_key_id,
    );
    if (!row.image_capable) throw new BillingGuardError("key_unavailable", 403);
    return {
      keyId: row.key_id,
      apiKey: await this.decryptKey(userId, row.secret_enc),
      platform: row.platform ?? "",
      imageModels: row.image_models,
    };
  }
  async resolveChatCredential(userId: string): Promise<ChatCredential> {
    const prefs = await this.preferences(userId);
    // Chat models are only known from discovery; when a $0 balance refused it,
    // send the user to recharge rather than to pick another key.
    if (
      !prefs.chat_key_id &&
      this.deferredDiscoveryReason(userId) === "insufficient_balance"
    )
      throw new BillingGuardError("insufficient_balance", 402);
    const row = await this.selected(userId, prefs.chat_key_id);
    if (!row.chat_models.length)
      throw new BillingGuardError("key_unavailable", 403);
    return {
      keyId: row.key_id,
      apiKey: await this.decryptKey(userId, row.secret_enc),
      platform: row.platform ?? "",
      chatModels: row.chat_models,
    };
  }
  async markKeyInvalid(userId: string, keyId: number, reason: string) {
    checkStoreError(
      (
        await this.db()
          .from("xy2api_api_keys")
          .update({ invalid_reason: reason, image_capable: false })
          .eq("user_id", userId)
          .eq("key_id", keyId)
      ).error,
    );
  }
  private async savePreferences(row: PreferencesRow) {
    checkStoreError(
      (await this.db().from("xy2api_preferences").upsert(row)).error,
    );
  }
  async updatePreferences(
    userId: string,
    input: {
      imageKeyId?: number | undefined;
      chatKeyId?: number | undefined;
      defaultImageModel?: string | undefined;
      defaultChatModel?: string | undefined;
      defaultChatProviderId?: string | null | undefined;
    },
  ) {
    const prefs = await this.preferences(userId);
    if (
      input.imageKeyId !== undefined ||
      input.defaultImageModel !== undefined
    ) {
      const row = await this.selected(
        userId,
        input.imageKeyId ?? prefs.image_key_id,
      );
      if (!row.image_capable)
        throw new BillingGuardError("key_unavailable", 403);
      const model =
        input.defaultImageModel ??
        (row.image_models.includes(prefs.default_image_model ?? "")
          ? prefs.default_image_model
          : row.image_models[0]);
      if (
        !model ||
        !row.image_models.includes(model) ||
        !findImageModel(this.catalog, model)
      )
        throw new BillingGuardError("model_not_accessible", 403);
      prefs.image_key_id = row.key_id;
      prefs.default_image_model = model;
    }
    if (input.chatKeyId !== undefined) {
      const row = await this.selected(userId, input.chatKeyId);
      if (!row.chat_models.length)
        throw new BillingGuardError("model_not_accessible", 403);
      prefs.chat_key_id = row.key_id;
    }
    if (
      input.defaultChatProviderId !== undefined ||
      input.defaultChatModel !== undefined ||
      (input.chatKeyId !== undefined && !prefs.default_chat_provider_id)
    ) {
      const providerId =
        input.defaultChatProviderId === undefined
          ? prefs.default_chat_provider_id
          : input.defaultChatProviderId;
      if (providerId) {
        if (!this.providers)
          throw new BillingGuardError("model_not_accessible", 403);
        const selected = await this.providers.validateModel(
          userId,
          providerId,
          input.defaultChatModel ??
            (prefs.default_chat_provider_id === providerId
              ? prefs.default_chat_model
              : null),
        );
        prefs.default_chat_provider_id = providerId;
        prefs.default_chat_model = selected.model;
      } else {
        const row = await this.selected(userId, prefs.chat_key_id);
        const model =
          input.defaultChatModel ??
          (!prefs.default_chat_provider_id &&
          row.chat_models.includes(prefs.default_chat_model ?? "")
            ? prefs.default_chat_model
            : row.chat_models[0]);
        if (!model || !row.chat_models.includes(model))
          throw new BillingGuardError("model_not_accessible", 403);
        prefs.default_chat_provider_id = null;
        prefs.default_chat_model = model;
      }
    }
    await this.savePreferences(prefs);
    return prefs;
  }
}

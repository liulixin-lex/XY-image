import type { ServerEnv } from "../../config/env.js";
import type { AdminSupabaseClient } from "../../supabase/admin.js";
import type { AccountService } from "./account-service.js";
import {
  type ImageModel,
  findImageModel,
  matchImageModels,
} from "./catalog.js";
import type { RemoteKey, Xy2apiClient } from "./client.js";
import { BillingGuardError, Xy2apiError, mapGatewayError } from "./errors.js";
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
  constructor(
    private readonly getAdmin: () => AdminSupabaseClient,
    private readonly accounts: AccountService,
    private readonly client: Xy2apiClient,
    private readonly box: SecretBox,
    readonly catalog: ImageModel[],
    private readonly env: Pick<ServerEnv, "chatModels">,
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
    return (
      data ?? {
        user_id: userId,
        image_key_id: null,
        chat_key_id: null,
        default_image_model: null,
        default_chat_model: null,
      }
    );
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
    const rows: KeyRow[] = [];
    for (let index = 0; index < remote.length; index += 3) {
      rows.push(
        ...(await Promise.all(
          remote
            .slice(index, index + 3)
            .map((key) => this.syncRow(userId, key)),
        )),
      );
    }
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
      default_chat_model: chat?.chat_models.includes(
        prefs.default_chat_model ?? "",
      )
        ? prefs.default_chat_model
        : (chat?.chat_models[0] ?? null),
    });
  }
  private async syncRow(userId: string, key: RemoteKey): Promise<KeyRow> {
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
    if (key.status === "active" && supported && group?.status === "active") {
      try {
        models = await this.client.listModels(key.key);
      } catch (error) {
        if (error instanceof Xy2apiError && [401, 403].includes(error.status))
          invalid = mapGatewayError({
            status: error.status,
            body: { code: error.id },
          }).code;
      }
    }
    const imageModels = matchImageModels(this.catalog, platform, models);
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
          ? this.env.chatModels.filter((id) => models.includes(id))
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
    return row;
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
    const row = await this.selected(
      userId,
      (await this.preferences(userId)).chat_key_id,
    );
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
    if (input.chatKeyId !== undefined || input.defaultChatModel !== undefined) {
      const row = await this.selected(
        userId,
        input.chatKeyId ?? prefs.chat_key_id,
      );
      const model =
        input.defaultChatModel ??
        (row.chat_models.includes(prefs.default_chat_model ?? "")
          ? prefs.default_chat_model
          : row.chat_models[0]);
      if (!model || !row.chat_models.includes(model))
        throw new BillingGuardError("model_not_accessible", 403);
      prefs.chat_key_id = row.key_id;
      prefs.default_chat_model = model;
    }
    await this.savePreferences(prefs);
    return prefs;
  }
}

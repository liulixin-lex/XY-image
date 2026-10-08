import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { SecretBox } from "../xy2api/secret-box.js";
import { ChatProviderError } from "./errors.js";
import type { ProviderNetwork } from "./network.js";
import type { ChatProviderStore } from "./store.js";
import { type ChatProviderRow, publicProvider } from "./types.js";
import { hasControlCharacters } from "./validation.js";

const modelName = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((v) => !hasControlCharacters(v));
const modelList = z
  .array(modelName)
  .min(1)
  .max(200)
  .transform((a) => [...new Set(a)]);
const name = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .refine((v) => !hasControlCharacters(v));
const apiKey = z
  .string()
  .trim()
  .min(4)
  .max(4096)
  .regex(/^[!-~]+$/);
export const createProviderSchema = z
  .object({
    name,
    protocol: z.literal("openai_compatible"),
    baseUrl: z.string().max(300),
    apiKey,
    models: modelList.optional(),
  })
  .strict();
export const patchProviderSchema = z
  .object({
    name: name.optional(),
    baseUrl: z.string().max(300).optional(),
    apiKey: apiKey.optional(),
    models: modelList.optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0);

type CreateInput = z.infer<typeof createProviderSchema>;
type PatchInput = z.infer<typeof patchProviderSchema>;
const aad = (userId: string, id: string) =>
  `loomic:chat-provider:v1:${userId}:${id}`;

export class ChatProviderService {
  private readonly locks = new Map<string, Promise<unknown>>();
  constructor(
    private readonly store: ChatProviderStore,
    private readonly box: SecretBox,
    readonly network: ProviderNetwork,
  ) {}
  private async withLock<T>(
    userId: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const previous = this.locks.get(userId) ?? Promise.resolve();
    const pending = previous.catch(() => {}).then(work);
    this.locks.set(userId, pending);
    try {
      return await pending;
    } finally {
      if (this.locks.get(userId) === pending) this.locks.delete(userId);
    }
  }
  async list(userId: string) {
    return (await this.store.list(userId)).map(publicProvider);
  }
  async getOwned(userId: string, id: string) {
    if (!z.uuid().safeParse(id).success)
      throw new ChatProviderError("provider_not_found", 404);
    const row = await this.store.get(userId, id);
    if (!row) throw new ChatProviderError("provider_not_found", 404);
    return row;
  }
  private open(row: ChatProviderRow) {
    try {
      return this.box.openSecret(row.secret_enc, aad(row.user_id, row.id));
    } catch {
      throw new ChatProviderError("provider_auth_failed");
    }
  }
  async validateModel(userId: string, id: string, model?: string | null) {
    const row = await this.getOwned(userId, id);
    if (!row.enabled || !row.models.length)
      throw new ChatProviderError("provider_model_not_found");
    const chosen = model ?? row.models[0];
    if (!chosen || !row.models.includes(chosen))
      throw new ChatProviderError("provider_model_not_found");
    return { row, model: chosen };
  }
  async credential(userId: string, id: string, model: string) {
    const result = await this.validateModel(userId, id, model);
    const baseUrl = this.network.normalize(result.row.base_url);
    return {
      model: result.model,
      providerId: id,
      baseUrl,
      transport: this.network.transport(baseUrl, this.open(result.row)),
    };
  }
  private async discover(baseUrl: string, key: string, manual?: string[]) {
    let fetched: string[];
    try {
      fetched = await this.network.listModels(baseUrl, key);
    } catch (error) {
      // Manual fallback is allowed only for a missing endpoint, never bad credentials/network.
      if (
        error instanceof ChatProviderError &&
        error.code === "provider_models_unavailable" &&
        "modelsEndpointMissing" in error &&
        error.modelsEndpointMissing === true &&
        manual
      )
        return { models: manual, models_source: "manual" as const };
      throw error;
    }
    return manual
      ? { models: manual, models_source: "manual" as const }
      : { models: fetched, models_source: "fetched" as const };
  }
  async create(userId: string, raw: CreateInput) {
    const input = createProviderSchema.parse(raw);
    return this.withLock(userId, async () => {
      const rows = await this.store.list(userId);
      if (rows.length >= 10)
        throw new ChatProviderError("provider_limit_reached", 409);
      if (rows.some((r) => r.name === input.name))
        throw new ChatProviderError("provider_name_taken", 409);
      const baseUrl = this.network.normalize(input.baseUrl);
      const selection = await this.discover(
        baseUrl,
        input.apiKey,
        input.models,
      );
      const id = randomUUID();
      const row = await this.store.insert({
        id,
        user_id: userId,
        name: input.name,
        protocol: input.protocol,
        base_url: baseUrl,
        secret_enc: this.box.sealSecret(input.apiKey, aad(userId, id)),
        key_hint: input.apiKey.slice(-4),
        ...selection,
        enabled: true,
        last_checked_at: new Date().toISOString(),
        last_error: null,
      });
      console.info("[chat-provider] created", {
        providerId: id,
        host: new URL(baseUrl).hostname,
      });
      return publicProvider(row);
    });
  }
  async patch(userId: string, id: string, raw: PatchInput) {
    const input = patchProviderSchema.parse(raw);
    return this.withLock(userId, async () => {
      const row = await this.getOwned(userId, id);
      const baseUrl =
        input.baseUrl === undefined
          ? row.base_url
          : this.network.normalize(input.baseUrl);
      if (baseUrl !== row.base_url && !input.apiKey)
        throw new ChatProviderError("invalid_request");
      const patch: Partial<ChatProviderRow> = {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      };
      if (
        input.name &&
        (await this.store.list(userId)).some(
          (r) => r.id !== id && r.name === input.name,
        )
      )
        throw new ChatProviderError("provider_name_taken", 409);
      if (input.apiKey !== undefined || input.baseUrl !== undefined) {
        const key = input.apiKey ?? this.open(row);
        Object.assign(patch, await this.discover(baseUrl, key, input.models), {
          base_url: baseUrl,
          secret_enc: this.box.sealSecret(key, aad(userId, id)),
          key_hint: key.slice(-4),
          last_checked_at: new Date().toISOString(),
          last_error: null,
        });
      } else if (input.models) {
        patch.models = input.models;
        patch.models_source = "manual";
      }
      return publicProvider(await this.store.update(userId, id, patch));
    });
  }
  async refresh(userId: string, id: string) {
    return this.withLock(userId, async () => {
      const row = await this.getOwned(userId, id);
      const checked = new Date().toISOString();
      let models: string[];
      try {
        models = await this.network.listModels(row.base_url, this.open(row));
      } catch (error) {
        const safe =
          error instanceof ChatProviderError
            ? error
            : new ChatProviderError("provider_unavailable");
        await this.store.update(userId, id, {
          last_checked_at: checked,
          last_error: safe.code,
        });
        throw safe;
      }
      return publicProvider(
        await this.store.update(userId, id, {
          models,
          models_source: "fetched",
          last_checked_at: checked,
          last_error: null,
        }),
      );
    });
  }
  async delete(userId: string, id: string) {
    await this.withLock(userId, async () => {
      await this.getOwned(userId, id);
      await this.store.delete(userId, id);
    });
  }
}

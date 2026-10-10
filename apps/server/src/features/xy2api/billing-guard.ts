import {
  IMAGE_QUALITIES,
  IMAGE_RESOLUTIONS,
  LEGACY_IMAGE_PARAMS,
  isLegacyImageQuality,
  normalizeImageParams,
} from "@loomic/shared";
import { z } from "zod";
import type { ServerEnv } from "../../config/env.js";
import type { AdminSupabaseClient } from "../../supabase/admin.js";
import type { AuthenticatedUser } from "../../supabase/user.js";
import { findImageModel, resolveImageParams } from "./catalog.js";
import type { Xy2apiClient } from "./client.js";
import { BillingGuardError } from "./errors.js";
import type { KeyService } from "./key-service.js";
import { checkStoreError } from "./store.js";

/**
 * An image job's stored payload. `resolution` / `quality` hold what
 * prepareImageJob resolved for the model. Payloads written before they
 * existed carry only the old `quality` (standard / hd, default standard) and
 * are read as LEGACY_IMAGE_PARAMS, so a queued old job sends what it always
 * did. Anything else is validated as is: the worker never trusts the row.
 */
export const imagePayloadSchema = z.preprocess(
  (raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
    const value = raw as Record<string, unknown>;
    if (value.resolution !== undefined) return raw;
    if (value.quality === undefined)
      return { ...value, ...LEGACY_IMAGE_PARAMS.standard };
    return isLegacyImageQuality(value.quality)
      ? { ...value, ...LEGACY_IMAGE_PARAMS[value.quality] }
      : raw;
  },
  z.object({
    prompt: z.string().trim().min(1).max(4000),
    model: z.string().min(1).max(200),
    resolution: z.enum(IMAGE_RESOLUTIONS),
    quality: z.enum(IMAGE_QUALITIES),
    aspect_ratio: z
      .string()
      .regex(/^\d{1,2}(\.\d)?:\d{1,2}(\.\d)?$/)
      .optional(),
    input_images: z.array(z.string().max(15000000)).max(14).optional(),
  }),
);
export type ImagePayload = z.output<typeof imagePayloadSchema>;
export class BillingGuard {
  private locks = new Map<string, Promise<unknown>>();
  constructor(
    private readonly keys: KeyService,
    private readonly client: Xy2apiClient,
    private readonly getAdmin: () => AdminSupabaseClient,
    private readonly env: Pick<
      ServerEnv,
      "maxPendingImageJobs" | "maxConcurrentJobs"
    >,
  ) {}
  async withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(userId);
    const work = (previous?.catch(() => {}) ?? Promise.resolve()).then(fn);
    this.locks.set(userId, work);
    try {
      return await work;
    } finally {
      if (this.locks.get(userId) === work) this.locks.delete(userId);
    }
  }
  /**
   * Checks key, model, parameters, references and balance for `count` new
   * image jobs, and returns the 画质 / 质量 / 比例 to store (moved to the
   * model's closest supported values, see resolveImageParams). Also checks
   * that the user stays within LOOMIC_MAX_PENDING_IMAGE_JOBS queued or in
   * flight. How many actually reach the main site at once is the worker's
   * dispatch gate (LOOMIC_MAX_CONCURRENT_JOBS); the rest wait unsent.
   * `sendsNow` is for a route that sends from the API process without the
   * worker (the sync agent route): it keeps the old, stricter rule that the
   * user has fewer than LOOMIC_MAX_CONCURRENT_JOBS queued or running.
   * Call inside withUserLock so two requests cannot both pass the count.
   */
  async prepareImageJob(
    user: Pick<AuthenticatedUser, "id">,
    input: {
      model?: string | undefined;
      resolution?: string | undefined;
      quality?: string | undefined;
      aspect_ratio?: string | undefined;
      input_images?: string[] | undefined;
    },
    options: { count?: number; sendsNow?: boolean } = {},
  ) {
    const count = options.sendsNow ? 1 : (options.count ?? 1);
    const limit = options.sendsNow
      ? this.env.maxConcurrentJobs
      : this.env.maxPendingImageJobs;
    const credential = await this.keys.resolveImageCredential(user.id);
    const prefs = await this.keys.preferences(user.id);
    const model =
      input.model || prefs.default_image_model || credential.imageModels[0];
    const entry = model ? findImageModel(this.keys.catalog, model) : undefined;
    if (!model || !entry || !credential.imageModels.includes(model))
      throw new BillingGuardError("model_not_accessible", 403);
    const references = input.input_images?.length ?? 0;
    if (references > 0 && !entry.supportsEdit)
      throw new BillingGuardError(
        "invalid_input",
        400,
        `${entry.displayName} 不支持参考图，请换一个模型或去掉参考图`,
      );
    if (references > entry.maxInputImages)
      throw new BillingGuardError(
        "invalid_input",
        400,
        `${entry.displayName} 最多使用 ${entry.maxInputImages} 张参考图`,
      );
    const requested = normalizeImageParams(input);
    const resolved = resolveImageParams(entry, {
      resolution: requested.resolution,
      quality: requested.quality,
      aspectRatio: input.aspect_ratio,
    });
    if (resolved.adjusted.length)
      console.info(
        `[billing-guard] ${model}: adjusted ${resolved.adjusted.join(", ")}`,
      );
    try {
      const usage = await this.client.getUsage(credential.apiKey);
      if ((usage.balance ?? usage.remaining ?? 1) <= 0)
        throw new BillingGuardError("insufficient_balance", 402);
    } catch (error) {
      if (error instanceof BillingGuardError) throw error;
    }
    const { count: pending, error } = await this.getAdmin()
      .from("background_jobs")
      .select("id", { count: "exact", head: true })
      .eq("created_by", user.id)
      .in("status", ["queued", "running"])
      // Charged images waiting for a storage retry no longer use the gateway.
      .neq("billing_status", "charged");
    checkStoreError(error);
    if ((pending ?? 0) + count > limit) {
      console.info(
        `[billing-guard] user ${user.id} at the image job limit (${pending ?? 0} + ${count} > ${limit}${options.sendsNow ? ", sends now" : ""})`,
      );
      throw new BillingGuardError("concurrency_limit", 429);
    }
    return {
      keyId: credential.keyId,
      model,
      resolution: resolved.resolution,
      quality: resolved.quality,
      aspect_ratio: resolved.aspectRatio,
    };
  }
}

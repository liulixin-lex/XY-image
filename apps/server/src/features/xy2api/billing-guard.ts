import {
  IMAGE_QUALITIES,
  IMAGE_RESOLUTIONS,
  LEGACY_IMAGE_PARAMS,
  type ImageEdit,
  type ImageQuality,
  type ImageResolution,
  OUTPAINT_ANCHORS,
  OUTPAINT_MAX_SCALE,
  isLegacyImageQuality,
  normalizeImageParams,
} from "@loomic/shared";
import { z } from "zod";
import type { ServerEnv } from "../../config/env.js";
import type { AdminSupabaseClient } from "../../supabase/admin.js";
import type { AuthenticatedUser } from "../../supabase/user.js";
import {
  findImageModel,
  resolveImageParams,
  supportsMaskEdit,
} from "./catalog.js";
import type { Xy2apiClient } from "./client.js";
import { BillingGuardError } from "./errors.js";
import type { KeyService } from "./key-service.js";
import { checkStoreError } from "./store.js";

/**
 * 局部重绘 / 扩图, as stored (the shared imageEditSchema is zod 3; this
 * package validates with zod 4, so the rule is repeated from its constants).
 */
const imageEditPayloadSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("inpaint"),
    mask: z.string().min(1).max(15000000),
  }),
  z.object({
    mode: z.literal("outpaint"),
    scale: z.number().min(1).max(OUTPAINT_MAX_SCALE),
    anchor: z.enum(OUTPAINT_ANCHORS),
  }),
]);

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
    edit: imageEditPayloadSchema.optional(),
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
   * image jobs, and returns the key and the 画质 / 质量 / 比例 to store (moved
   * to the model's closest supported values, see resolveImageParams). The
   * key is `input.key_id`, or the default key / the first enabled key that
   * has the model (KeyService.resolveImageTarget, 第 56 条). Also checks that
   * the user stays within LOOMIC_MAX_PENDING_IMAGE_JOBS queued or in flight.
   * How many actually reach the main site at once is the worker's dispatch
   * gate (LOOMIC_MAX_CONCURRENT_JOBS); the rest wait unsent.
   * `sendsNow` is for a route that sends from the API process without the
   * worker (the sync agent route): it keeps the old, stricter rule that the
   * user has fewer than LOOMIC_MAX_CONCURRENT_JOBS queued or running.
   * Call inside withUserLock so two requests cannot both pass the count.
   */
  async prepareImageJob(
    user: Pick<AuthenticatedUser, "id">,
    input: ImageJobInput & {
      model?: string | undefined;
      key_id?: number | undefined;
    },
    options: { count?: number; sendsNow?: boolean } = {},
  ): Promise<PreparedImageJob> {
    const [prepared] = await this.prepareImageJobs(
      user,
      input,
      [
        {
          model: input.model,
          key_id: input.key_id,
          count: options.sendsNow ? 1 : (options.count ?? 1),
        },
      ],
      options.sendsNow ? { sendsNow: true } : {},
    );
    return prepared as PreparedImageJob;
  }
  /**
   * prepareImageJob for several models side by side (studio 多模型): each
   * target is checked on its own key and gets its own parameters; balance is
   * read once per key and the pending limit counts every picture. Nothing is
   * admitted unless all targets pass.
   */
  async prepareImageJobs(
    user: Pick<AuthenticatedUser, "id">,
    input: ImageJobInput,
    targets: readonly {
      model?: string | undefined;
      key_id?: number | undefined;
      count: number;
    }[],
    options: { sendsNow?: boolean } = {},
  ): Promise<(PreparedImageJob & { count: number })[]> {
    const count = targets.reduce((sum, target) => sum + target.count, 0);
    const limit = options.sendsNow
      ? this.env.maxConcurrentJobs
      : this.env.maxPendingImageJobs;
    const prepared: (PreparedImageJob & { count: number })[] = [];
    const apiKeys = new Map<number, string>();
    for (const target of targets) {
      const credential = await this.keys.resolveImageTarget(user.id, {
        keyId: target.key_id,
        model: target.model,
      });
      const model = credential.model;
      const entry = findImageModel(this.keys.catalog, model);
      if (!entry) throw new BillingGuardError("model_not_accessible", 403);
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
      if (input.edit) checkMaskEdit(entry, references);
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
      apiKeys.set(credential.keyId, credential.apiKey);
      prepared.push({
        keyId: credential.keyId,
        model,
        resolution: resolved.resolution,
        quality: resolved.quality,
        aspect_ratio: resolved.aspectRatio,
        count: options.sendsNow ? 1 : target.count,
      });
    }
    for (const apiKey of apiKeys.values()) {
      try {
        const usage = await this.client.getUsage(apiKey);
        if ((usage.balance ?? usage.remaining ?? 1) <= 0)
          throw new BillingGuardError("insufficient_balance", 402);
      } catch (error) {
        if (error instanceof BillingGuardError) throw error;
      }
    }
    const { count: pending, error } = await this.getAdmin()
      .from("background_jobs")
      .select("id", { count: "exact", head: true })
      .eq("created_by", user.id)
      .in("status", ["queued", "running"])
      // Charged images waiting for a storage retry no longer use the gateway.
      .neq("billing_status", "charged");
    checkStoreError(error);
    const asking = options.sendsNow ? 1 : count;
    if ((pending ?? 0) + asking > limit) {
      console.info(
        `[billing-guard] user ${user.id} at the image job limit (${pending ?? 0} + ${asking} > ${limit}${options.sendsNow ? ", sends now" : ""})`,
      );
      throw new BillingGuardError("concurrency_limit", 429);
    }
    if (prepared.length > 1)
      console.info(
        `[billing-guard] user ${user.id}: ${prepared.length} models side by side (${prepared
          .map((p) => `${p.model}@${p.keyId}×${p.count}`)
          .join(", ")})`,
      );
    return prepared;
  }
}

/** What an image request asks for besides the model and key. */
type ImageJobInput = {
  resolution?: string | undefined;
  quality?: string | undefined;
  aspect_ratio?: string | undefined;
  input_images?: string[] | undefined;
  edit?: ImageEdit | undefined;
};

export type PreparedImageJob = {
  keyId: number;
  model: string;
  resolution: ImageResolution;
  quality: ImageQuality;
  aspect_ratio: string;
};

/**
 * 局部重绘 / 扩图: one source picture, and a model that can take it (see
 * supportsMaskEdit). Checked when queueing and again by the worker.
 */
export function checkMaskEdit(
  model: Parameters<typeof supportsMaskEdit>[0] & { displayName: string },
  references: number,
) {
  if (!supportsMaskEdit(model))
    throw new BillingGuardError(
      "invalid_input",
      400,
      `${model.displayName} 不支持局部重绘和扩图，请换一个模型`,
    );
  if (references !== 1)
    throw new BillingGuardError(
      "invalid_input",
      400,
      "局部重绘和扩图一次只改一张图",
    );
}

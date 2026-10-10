import { z } from "zod";
import type { ServerEnv } from "../../config/env.js";
import type { AdminSupabaseClient } from "../../supabase/admin.js";
import type { AuthenticatedUser } from "../../supabase/user.js";
import { findImageModel } from "./catalog.js";
import type { Xy2apiClient } from "./client.js";
import { BillingGuardError } from "./errors.js";
import type { KeyService } from "./key-service.js";
import { checkStoreError } from "./store.js";

export const imagePayloadSchema = z.object({
  prompt: z.string().trim().min(1).max(4000),
  model: z.string().min(1).max(200),
  quality: z.enum(["standard", "hd"]).default("standard"),
  aspect_ratio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4"]).optional(),
  input_images: z.array(z.string().max(15000000)).max(14).optional(),
});
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
   * Checks key, model, quality and balance for `count` new image jobs and
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
    input: { model?: string | undefined; quality?: string | undefined },
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
    if (input.quality && !["standard", "hd"].includes(input.quality))
      throw new BillingGuardError(
        "invalid_input",
        400,
        "暂不支持 4K，请选择 1K 或 2K",
      );
    const quality =
      input.quality === "hd" && entry.maxQuality === "hd"
        ? ("hd" as const)
        : ("standard" as const);
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
    return { keyId: credential.keyId, model, quality };
  }
}

import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { ServerEnv } from "../../config/env.js";
import { generateImage } from "../../generation/image-generation.js";
import { resolveImageProviderName } from "../../generation/providers/registry.js";
import type { AdminSupabaseClient } from "../../supabase/admin.js";
import { createSupabaseFetch } from "../../supabase/transport.js";
import { describeErrorForLog } from "../../utils/error-sanitizer.js";
import { checkMaskEdit, imagePayloadSchema } from "./billing-guard.js";
import { findImageModel } from "./catalog.js";
import {
  BillingGuardError,
  DeliveryPendingError,
  GatewayError,
  mapGatewayError,
} from "./errors.js";
import {
  MAX_DELIVERY_ATTEMPTS,
  type PendingDeliveryStore,
  deliveryRetrySeconds,
} from "./pending-delivery.js";
import type { Xy2apiServices } from "./services.js";
import { checkStoreError, integrationClient } from "./store.js";

export async function executeImageJob(
  jobId: string,
  options: {
    getAdminClient: () => AdminSupabaseClient;
    env: ServerEnv;
    xy2api: Xy2apiServices;
    renewVt?: (seconds: number) => Promise<void>;
    /** Keeps charged images whose storage write failed (M6). Without it they fail as storage_failed. */
    deliveries?: PendingDeliveryStore;
  },
): Promise<ImageJobResult> {
  const admin = options.getAdminClient();
  const db = integrationClient(admin);
  const { data: row, error } = await db
    .from("background_jobs")
    .select("*")
    .eq("id", jobId)
    .single();
  checkStoreError(error);
  if (
    !row ||
    !row.created_by ||
    !row.xy2api_key_id ||
    row.job_type !== "image_generation" ||
    row.status === "canceled"
  )
    throw new BillingGuardError("invalid_input");
  if (["pending", "charged", "unknown"].includes(row.billing_status)) {
    // A charged image held after a storage failure: upload the held copy.
    if (row.billing_status === "charged" && options.deliveries)
      return redeliver(jobId, row, options.deliveries, admin);
    // Preserve confirmed billing after a crash during storage/result persistence.
    // Only a still-pending dispatch has an uncertain outcome.
    if (row.billing_status === "pending") {
      checkStoreError(
        (
          await db
            .from("background_jobs")
            .update({ billing_status: "unknown" })
            .eq("id", jobId)
            .eq("billing_status", "pending")
        ).error,
      );
    }
    throw new GatewayError(mapGatewayError({}));
  }
  const parsed = imagePayloadSchema.safeParse(row.payload);
  if (!parsed.success) throw new BillingGuardError("invalid_input");
  const payload = parsed.data;
  await options.xy2api.accounts.requireAccount(row.created_by);
  const credential = await options.xy2api.keys.resolveImageCredential(
    row.created_by,
    row.xy2api_key_id,
  );
  const model = findImageModel(options.xy2api.keys.catalog, payload.model);
  // A model removed from the catalog (LOOMIC_IMAGE_MODELS) since queueing,
  // or no longer on the key: refuse before anything is sent.
  if (!model || !credential.imageModels.includes(payload.model))
    throw new BillingGuardError("model_not_accessible", 403);
  if (
    (payload.input_images?.length ?? 0) > model.maxInputImages ||
    (payload.input_images?.length && !model.supportsEdit)
  )
    throw new BillingGuardError("invalid_input");
  if (payload.edit)
    checkMaskEdit(model, payload.input_images?.length ?? 0);
  const { data: member, error: memberError } = await admin
    .from("workspace_members")
    .select("user_id")
    .eq("user_id", row.created_by)
    .eq("workspace_id", row.workspace_id)
    .maybeSingle();
  if (memberError || !member) throw new BillingGuardError("invalid_input");
  // Compare-and-set before dispatch. Redelivery can never issue a second paid call.
  const { data: claimed, error: claimError } = await db
    .from("background_jobs")
    .update({ billing_status: "pending" })
    .eq("id", jobId)
    .eq("billing_status", "none")
    .neq("status", "canceled")
    .select("id")
    .maybeSingle();
  checkStoreError(claimError);
  if (!claimed) throw new GatewayError(mapGatewayError({}));
  const timer = setInterval(() => {
    void options.renewVt?.(120);
  }, 60000);
  try {
    let generated: import("../../generation/types.js").GeneratedImage;
    try {
      generated = await generateImage(
        resolveImageProviderName(payload.model),
        {
          prompt: payload.prompt,
          model: payload.model,
          resolution: payload.resolution,
          quality: payload.quality,
          ...(payload.aspect_ratio
            ? { aspectRatio: payload.aspect_ratio }
            : {}),
          ...(payload.input_images
            ? { inputImages: payload.input_images }
            : {}),
          ...(payload.edit ? { edit: payload.edit } : {}),
        },
        {
          apiKey: credential.apiKey,
          baseUrl: options.env.xy2apiBaseUrl,
          ...(options.env.supabaseUrl
            ? {
                assetOrigin: options.env.supabaseUrl,
                assetFetch: createSupabaseFetch(options.env),
              }
            : {}),
        },
      );
    } catch (error) {
      const failure =
        error instanceof GatewayError
          ? error.failure
          : error instanceof BillingGuardError
            ? { code: error.code, billing: "not_charged" as const }
            : mapGatewayError({});
      checkStoreError(
        (
          await db
            .from("background_jobs")
            .update({
              billing_status: failure.billing,
              // Lets support reconcile 待核对 jobs against xy2api usage rows.
              ...("requestId" in failure && failure.requestId
                ? { xy2api_request_id: failure.requestId }
                : {}),
            })
            .eq("id", jobId)
        ).error,
      );
      if (
        failure.code === "key_unavailable" ||
        failure.code === "key_ip_restricted"
      )
        await options.xy2api.keys.markKeyInvalid(
          row.created_by,
          row.xy2api_key_id,
          failure.code,
        );
      if (failure.code === "xy2api_reauth_required")
        await options.xy2api.accounts.markReauth(row.created_by);
      throw error instanceof BillingGuardError
        ? error
        : new GatewayError(mapGatewayError({}));
    }
    checkStoreError(
      (
        await db
          .from("background_jobs")
          .update({
            billing_status: "charged",
            xy2api_request_id: generated.requestId ?? null,
          })
          .eq("id", jobId)
      ).error,
    );
    const bytes = Buffer.from(generated.url.split(",", 2)[1] ?? "", "base64");
    const extension =
      generated.mimeType === "image/jpeg"
        ? "jpg"
        : generated.mimeType === "image/webp"
          ? "webp"
          : "png";
    const image = {
      workspaceId: row.workspace_id,
      createdBy: row.created_by,
      objectPath: `${row.workspace_id}/generated/${jobId}.${extension}`,
      mimeType: generated.mimeType,
      width: generated.width,
      height: generated.height,
      bytes,
    };
    try {
      return await deliver(admin, image);
    } catch (error) {
      const reason = describeErrorForLog(error);
      console.error(
        `[image-runner] job ${jobId} storage write failed: ${reason}`,
      );
      throw await holdForRetry(jobId, image, reason, options.deliveries);
    }
  } finally {
    clearInterval(timer);
  }
}

export type ImageJobResult = {
  asset_id: string;
  signed_url: string;
  object_path: string;
  width: number;
  height: number;
  mime_type: string;
  /**
   * A small WebP of the picture for feeds and lists (long edge THUMB_EDGE).
   * Absent for pictures already that small, for jobs from before thumbnails,
   * and when making one failed: readers fall back to signed_url.
   */
  thumb_url?: string;
  thumb_path?: string;
};

/** Long edge of the list thumbnail: a 4-up feed card at 2x is about 600 px. */
export const THUMB_EDGE = 768;

/** `ws/generated/job.png` -> `ws/generated/job.thumb.webp` */
export function thumbnailPath(objectPath: string) {
  return `${objectPath.replace(/\.[a-z0-9]+$/i, "")}.thumb.webp`;
}

type DeliveryImage = {
  workspaceId: string;
  createdBy: string;
  objectPath: string;
  mimeType: string;
  width: number;
  height: number;
  bytes: Buffer;
};

/**
 * Writes a generated image to project-assets and records its asset row.
 * Safe to repeat for the same path: the upload overwrites and an existing
 * asset row is reused, so a retried delivery never duplicates anything.
 */
async function deliver(
  admin: AdminSupabaseClient,
  image: DeliveryImage,
): Promise<ImageJobResult> {
  let uploadError: unknown;
  let uploaded = false;
  for (let attempt = 0; attempt < 3 && !uploaded; attempt++) {
    try {
      const result = await admin.storage
        .from("project-assets")
        .upload(image.objectPath, image.bytes, {
          contentType: image.mimeType,
          upsert: true,
        });
      uploaded = !result.error;
      uploadError = result.error;
    } catch (error) {
      /* Retry storage only; never regenerate the image. */
      uploadError = error;
    }
  }
  if (!uploaded) throw new StorageWriteError("upload", uploadError);
  const { data: existing, error: findError } = await admin
    .from("asset_objects")
    .select("id")
    .eq("bucket", "project-assets")
    .eq("object_path", image.objectPath)
    .maybeSingle();
  if (findError) throw new StorageWriteError("asset lookup", findError);
  let assetId = existing?.id;
  if (!assetId) {
    assetId = randomUUID();
    const { error: assetError } = await admin.from("asset_objects").insert({
      id: assetId,
      workspace_id: image.workspaceId,
      bucket: "project-assets",
      object_path: image.objectPath,
      mime_type: image.mimeType,
      byte_size: image.bytes.length,
      created_by: image.createdBy,
    });
    if (assetError) throw new StorageWriteError("asset row", assetError);
  }
  const thumb = await writeThumbnail(admin, image);
  return {
    asset_id: assetId,
    signed_url: admin.storage
      .from("project-assets")
      .getPublicUrl(image.objectPath).data.publicUrl,
    object_path: image.objectPath,
    width: image.width,
    height: image.height,
    mime_type: image.mimeType,
    ...(thumb ? { thumb_url: thumb.url, thumb_path: thumb.path } : {}),
  };
}

/**
 * Best effort: a list-sized WebP next to the picture, so feeds and records
 * decode about 1/25 of the pixels of a 4K original. The picture is already
 * stored and charged, so a failure here only logs and returns null; it never
 * fails or retries the delivery.
 */
async function writeThumbnail(
  admin: AdminSupabaseClient,
  image: DeliveryImage,
): Promise<{ path: string; url: string } | null> {
  const longEdge = Math.max(image.width, image.height);
  if (longEdge > 0 && longEdge <= THUMB_EDGE) return null;
  const path = thumbnailPath(image.objectPath);
  try {
    const bytes = await sharp(image.bytes)
      .rotate()
      .resize(THUMB_EDGE, THUMB_EDGE, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
    const { error } = await admin.storage
      .from("project-assets")
      .upload(path, bytes, {
        contentType: "image/webp",
        upsert: true,
        // Named after the job: the bytes never change.
        cacheControl: "31536000",
      });
    if (error) throw error;
    return {
      path,
      url: admin.storage.from("project-assets").getPublicUrl(path).data.publicUrl,
    };
  } catch (error) {
    console.warn(
      `[image-runner] thumbnail ${path} skipped, lists use the original: ${describeErrorForLog(error)}`,
    );
    return null;
  }
}

class StorageWriteError extends Error {
  constructor(step: string, cause: unknown) {
    super(
      `${step}: ${
        cause && typeof cause === "object" && "message" in cause
          ? String(cause.message)
          : String(cause)
      }`,
    );
    this.name = "StorageWriteError";
  }
}

/** Keeps a charged image whose first delivery failed; returns the error to throw. */
async function holdForRetry(
  jobId: string,
  image: DeliveryImage,
  reason: string,
  deliveries: PendingDeliveryStore | undefined,
): Promise<BillingGuardError> {
  if (!deliveries) return new BillingGuardError("storage_failed", 502);
  try {
    await deliveries.hold(
      {
        jobId,
        objectPath: image.objectPath,
        mimeType: image.mimeType,
        width: image.width,
        height: image.height,
        bytes: image.bytes,
      },
      reason,
    );
  } catch (error) {
    console.error(
      `[image-runner] job ${jobId} charged image could not be held, it is lost: ${describeErrorForLog(error)}`,
    );
    return new BillingGuardError("storage_failed", 502);
  }
  const wait = deliveryRetrySeconds(1);
  console.warn(
    `[image-runner] job ${jobId} image held; storage retry 2/${MAX_DELIVERY_ATTEMPTS} in ${wait}s`,
  );
  return new DeliveryPendingError(wait);
}

/**
 * Uploads the held copy of a charged image. The held row is removed by the
 * worker only after the job's success is recorded, so a crash in between
 * just delivers the same bytes once more.
 */
async function redeliver(
  jobId: string,
  row: { workspace_id: string; created_by: string },
  deliveries: PendingDeliveryStore,
  admin: AdminSupabaseClient,
): Promise<ImageJobResult> {
  let held: Awaited<ReturnType<PendingDeliveryStore["get"]>>;
  try {
    held = await deliveries.get(jobId);
  } catch (error) {
    // The database is unreachable; try again later rather than give up on a paid image.
    console.error(
      `[image-runner] job ${jobId} held image unreadable: ${describeErrorForLog(error)}`,
    );
    throw new DeliveryPendingError(60);
  }
  // Charged without a held copy: a crash before the hold. Billing is kept for reconciliation.
  if (!held) throw new GatewayError(mapGatewayError({}));
  try {
    const result = await deliver(admin, {
      ...held,
      workspaceId: row.workspace_id,
      createdBy: row.created_by,
    });
    console.log(
      `[image-runner] job ${jobId} delivered on storage attempt ${held.attempts + 1}`,
    );
    return result;
  } catch (error) {
    const reason = describeErrorForLog(error);
    const attempts = await deliveries
      .recordFailure(jobId, reason)
      .catch(() => held.attempts + 1);
    if (attempts >= MAX_DELIVERY_ATTEMPTS) {
      // The ops monitor alerts while such rows exist (images_held_for_recovery,
      // deploy/selfhost/operations.mjs); recovery: docs/XY2API_OPERATIONS.md.
      console.error(
        `[image-runner] job ${jobId} storage failed ${attempts} times; image kept in xy2api_pending_deliveries for manual recovery: ${reason}`,
      );
      throw new BillingGuardError("storage_failed", 502);
    }
    const wait = deliveryRetrySeconds(attempts);
    console.warn(
      `[image-runner] job ${jobId} storage attempt ${attempts}/${MAX_DELIVERY_ATTEMPTS} failed, next in ${wait}s: ${reason}`,
    );
    throw new DeliveryPendingError(wait);
  }
}

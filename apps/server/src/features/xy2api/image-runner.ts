import { randomUUID } from "node:crypto";
import type { ServerEnv } from "../../config/env.js";
import { generateImage } from "../../generation/image-generation.js";
import { resolveImageProviderName } from "../../generation/providers/registry.js";
import type { AdminSupabaseClient } from "../../supabase/admin.js";
import { imagePayloadSchema } from "./billing-guard.js";
import { findImageModel } from "./catalog.js";
import { BillingGuardError, GatewayError, mapGatewayError } from "./errors.js";
import type { Xy2apiServices } from "./services.js";
import { checkStoreError, integrationClient } from "./store.js";

export async function executeImageJob(
  jobId: string,
  options: {
    getAdminClient: () => AdminSupabaseClient;
    env: ServerEnv;
    xy2api: Xy2apiServices;
    renewVt?: (seconds: number) => Promise<void>;
  },
) {
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
  if (!model || !credential.imageModels.includes(payload.model))
    throw new BillingGuardError("model_not_accessible", 403);
  if (
    (payload.input_images?.length ?? 0) > model.maxInputImages ||
    (payload.input_images?.length && !model.supportsEdit)
  )
    throw new BillingGuardError("invalid_input");
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
          quality: payload.quality === "hd" ? model.maxQuality : "standard",
          ...(payload.aspect_ratio
            ? { aspectRatio: payload.aspect_ratio }
            : {}),
          ...(payload.input_images
            ? { inputImages: payload.input_images }
            : {}),
        },
        {
          apiKey: credential.apiKey,
          baseUrl: options.env.xy2apiBaseUrl,
          ...(options.env.supabaseUrl
            ? { assetOrigin: options.env.supabaseUrl }
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
            .update({ billing_status: failure.billing })
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
    const objectPath = `${row.workspace_id}/generated/${jobId}.${extension}`;
    let uploaded = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await admin.storage
          .from("project-assets")
          .upload(objectPath, bytes, {
            contentType: generated.mimeType,
            upsert: true,
          });
        if (!result.error) {
          uploaded = true;
          break;
        }
      } catch {
        /* Retry storage only; never regenerate the image. */
      }
    }
    if (!uploaded) throw new BillingGuardError("storage_failed", 502);
    const assetId = randomUUID();
    const { error: assetError } = await admin.from("asset_objects").insert({
      id: assetId,
      workspace_id: row.workspace_id,
      bucket: "project-assets",
      object_path: objectPath,
      mime_type: generated.mimeType,
      byte_size: bytes.length,
      created_by: row.created_by,
    });
    if (assetError) throw new BillingGuardError("storage_failed", 502);
    return {
      asset_id: assetId,
      signed_url: admin.storage.from("project-assets").getPublicUrl(objectPath)
        .data.publicUrl,
      object_path: objectPath,
      width: generated.width,
      height: generated.height,
      mime_type: generated.mimeType,
    };
  } finally {
    clearInterval(timer);
  }
}

import { z } from "zod";

import { imageEditSchema } from "./image-edit.js";
import {
  IMAGE_QUALITIES,
  LEGACY_IMAGE_QUALITIES,
  imageResolutionSchema,
} from "./image-params.js";

// --- Enums ---

export const backgroundJobStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "canceled",
  "dead_letter",
]);
export type BackgroundJobStatus = z.infer<typeof backgroundJobStatusSchema>;

export const backgroundJobTypeSchema = z.enum([
  "image_generation",
  "video_generation",
]);
export type BackgroundJobType = z.infer<typeof backgroundJobTypeSchema>;

// --- Payloads ---

export const imageGenerationPayloadSchema = z.object({
  prompt: z.string().min(1).max(4000),
  model: z.string().optional(),
  aspect_ratio: z.string().optional(),
  resolution: imageResolutionSchema.optional(),
  /** New jobs store auto / low / medium / high; older ones standard / hd / ultra (= 1K / 2K / 4K). */
  quality: z.enum([...IMAGE_QUALITIES, ...LEGACY_IMAGE_QUALITIES]).optional(),
});
export type ImageGenerationPayload = z.infer<
  typeof imageGenerationPayloadSchema
>;

export const videoGenerationPayloadSchema = z.object({
  prompt: z.string().min(1).max(4000),
  model: z.string().optional(),
  duration: z.number().int().optional(),
  resolution: z.string().optional(),
  aspect_ratio: z.string().optional(),
  input_images: z.array(z.string()).optional(),
  input_video: z.string().optional(),
  enable_audio: z.boolean().optional(),
});
export type VideoGenerationPayload = z.infer<
  typeof videoGenerationPayloadSchema
>;

export const createVideoJobRequestSchema = z.object({
  project_id: z.string().uuid().optional(),
  canvas_id: z.string().uuid().optional(),
  session_id: z.string().uuid().optional(),
  thread_id: z.string().optional(),
  prompt: z.string().min(1).max(4000),
  model: z.string().optional(),
  duration: z.number().int().optional(),
  resolution: z.string().optional(),
  aspect_ratio: z.string().optional(),
  input_images: z.array(z.string()).optional(),
  input_video: z.string().optional(),
  enable_audio: z.boolean().optional(),
});
export type CreateVideoJobRequest = z.infer<typeof createVideoJobRequestSchema>;

// --- Job entity ---

export const backgroundJobSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  project_id: z.string().uuid().nullable(),
  canvas_id: z.string().uuid().nullable(),
  session_id: z.string().uuid().nullable(),
  thread_id: z.string().nullable(),
  queue_name: z.string(),
  job_type: backgroundJobTypeSchema,
  status: backgroundJobStatusSchema,
  billing_status: z
    .enum(["none", "pending", "charged", "not_charged", "unknown"])
    .optional(),
  xy2api_request_id: z.string().nullable().optional(),
  /** The main-site key the job went through (第 56 条: several can be on). */
  xy2api_key_id: z.number().int().nullable().optional(),
  payload: z.record(z.string(), z.unknown()),
  result: z.record(z.string(), z.unknown()).nullable(),
  error_code: z.string().nullable(),
  error_message: z.string().nullable(),
  attempt_count: z.number().int(),
  max_attempts: z.number().int(),
  created_by: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  failed_at: z.string().nullable(),
  canceled_at: z.string().nullable(),
});
export type BackgroundJob = z.infer<typeof backgroundJobSchema>;

// --- API Request schemas ---

/**
 * No product limit on how many pictures one click asks for (第 57 条: the
 * user lifted the old 4 per model / 8 per click / 4 models caps). These are
 * structural guards only, against a malformed or runaway request (a stuck
 * script, a typo of extra zeros): one request holds at most this many
 * pictures, across its models. Each picture is still its own job and its
 * own main-site request; the server's LOOMIC_MAX_PENDING_IMAGE_JOBS and
 * LOOMIC_MAX_CONCURRENT_JOBS (0 = no limit, the default) can cap them.
 */
export const IMAGE_REQUEST_MAX = 500;
/** Most pictures of one model in one request (the same guard). */
export const IMAGE_BATCH_MAX = IMAGE_REQUEST_MAX;
/** Most models one request can run side by side (studio 多模型). */
export const IMAGE_MODELS_PER_REQUEST_MAX = 50;

/**
 * A main-site key id (xy2api api_keys.id). Several of a user's keys can serve
 * image generation at once; a request names the key whose model it uses.
 * Without one the server picks the user's default key, or the first enabled
 * key that has the model.
 */
export const xy2apiKeyIdSchema = z.number().int().positive();

/**
 * Node canvas: a spot for a picture, in canvas coordinates (top-left corner
 * and display size). Bounded so a bad client cannot write absurd geometry.
 */
export const canvasSlotSchema = z.object({
  x: z.number().finite().min(-1_000_000).max(1_000_000),
  y: z.number().finite().min(-1_000_000).max(1_000_000),
  width: z.number().finite().min(16).max(4096),
  height: z.number().finite().min(16).max(4096),
});
export type CanvasSlot = z.infer<typeof canvasSlotSchema>;

/** A canvas element id (node canvas ids and Excalidraw's both fit). */
export const canvasElementIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/);

/**
 * Where the worker puts one picture of a canvas job, stored in its payload:
 * the slot, and the generator node an edge links it from. Both optional;
 * without a slot the writer places the picture next to the rest.
 */
export const canvasPlacementPayloadSchema = z.object({
  canvas_slot: canvasSlotSchema.optional(),
  canvas_source_id: canvasElementIdSchema.optional(),
});
export type CanvasPlacementPayload = z.infer<
  typeof canvasPlacementPayloadSchema
>;

export const createImageJobRequestSchema = z.object({
  input_images: z.array(z.string()).max(14).optional(),
  project_id: z.string().uuid().optional(),
  canvas_id: z.string().uuid().optional(),
  session_id: z.string().uuid().optional(),
  thread_id: z.string().optional(),
  prompt: z.string().min(1).max(4000),
  model: z.string().optional(),
  /** The main-site key `model` is used through (see xy2apiKeyIdSchema). */
  key_id: xy2apiKeyIdSchema.optional(),
  aspect_ratio: z.string().max(10).optional(),
  /** 画质: 1K / 2K / 4K. The server clamps to what the model supports. */
  resolution: imageResolutionSchema.optional(),
  /**
   * 质量: auto / low / medium / high. The legacy values standard / hd / ultra
   * (which meant 1K / 2K / 4K) are still accepted from older clients.
   */
  quality: z.enum([...IMAGE_QUALITIES, ...LEGACY_IMAGE_QUALITIES]).optional(),
  /** Node canvas (needs `canvas_id`): the generator node the pictures come from. */
  canvas_source_id: canvasElementIdSchema.optional(),
  /** Node canvas (needs `canvas_id`): one spot per picture, in batch order. */
  canvas_slots: z.array(canvasSlotSchema).min(1).max(IMAGE_REQUEST_MAX).optional(),
  /**
   * 局部重绘 / 扩图 on `input_images[0]` (exactly one source). Models without
   * mask edits are refused before anything is queued.
   */
  edit: imageEditSchema.optional(),
});
export type CreateImageJobRequest = z.infer<typeof createImageJobRequestSchema>;

/** One model of a 多模型 request and how many pictures it makes. */
export const imageTargetSchema = z.object({
  model: z.string().min(1).max(200),
  key_id: xy2apiKeyIdSchema.optional(),
  count: z.number().int().min(1).max(IMAGE_BATCH_MAX),
});
export type ImageTarget = z.infer<typeof imageTargetSchema>;

/**
 * Pictures from one description, in one request. Each picture is its own job
 * (and its own main-site charge); the jobs share `batch_id` in their payload.
 *
 * Either `count` pictures of `model` (via `key_id`), or `targets`: several
 * models side by side, each with its own count (at most IMAGE_REQUEST_MAX in
 * all). Pictures are numbered across the targets in order; `canvas_slots`,
 * when given, has one slot per picture in that order.
 */
export const createImageBatchRequestSchema = createImageJobRequestSchema
  .extend({
    count: z.number().int().min(1).max(IMAGE_BATCH_MAX).optional(),
    targets: z
      .array(imageTargetSchema)
      .min(1)
      .max(IMAGE_MODELS_PER_REQUEST_MAX)
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.targets === undefined) {
      if (value.count === undefined)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["count"],
          message: "count or targets is required",
        });
      return;
    }
    if (value.count !== undefined || value.model || value.key_id)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targets"],
        message: "targets replaces count, model and key_id",
      });
    const total = value.targets.reduce((sum, target) => sum + target.count, 0);
    if (total > IMAGE_REQUEST_MAX)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targets"],
        message: `at most ${IMAGE_REQUEST_MAX} pictures per request`,
      });
    const seen = new Set<string>();
    for (const target of value.targets) {
      const key = `${target.key_id ?? ""}:${target.model}`;
      if (seen.has(key))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["targets"],
          message: "each model appears once",
        });
      seen.add(key);
    }
  });
export type CreateImageBatchRequest = z.infer<
  typeof createImageBatchRequestSchema
>;

/** The models of a batch request, as targets (one for the `count` form). */
export function imageBatchTargets(request: CreateImageBatchRequest): ImageTarget[] {
  if (request.targets) return request.targets;
  return [
    {
      model: request.model ?? "",
      ...(request.key_id ? { key_id: request.key_id } : {}),
      count: request.count ?? 1,
    },
  ];
}

/** Batch fields the server adds to each job's payload. */
export const imageBatchPayloadSchema = z.object({
  batch_id: z.string().uuid(),
  batch_index: z.number().int().min(0),
  batch_size: z.number().int().min(1).max(IMAGE_REQUEST_MAX),
});
export type ImageBatchPayload = z.infer<typeof imageBatchPayloadSchema>;

export const imageBatchResponseSchema = z.object({
  batch_id: z.string().uuid(),
  /** How many pictures were asked for; `jobs` can be shorter if submission stopped part way. */
  requested: z.number().int().min(1).max(IMAGE_REQUEST_MAX),
  jobs: z.array(backgroundJobSchema),
});
export type ImageBatchResponse = z.infer<typeof imageBatchResponseSchema>;

/** Jobs of a batch that were still waiting (never sent to the main site) and are now canceled. */
export const cancelImageBatchResponseSchema = z.object({
  batch_id: z.string().uuid(),
  canceled: z.array(z.string().uuid()),
});
export type CancelImageBatchResponse = z.infer<
  typeof cancelImageBatchResponseSchema
>;

// --- Prompt rewrite (studio "优化提示词") ---

export const optimizePromptRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(2000),
  aspect_ratio: z.string().max(10).optional(),
});
export type OptimizePromptRequest = z.infer<typeof optimizePromptRequestSchema>;

export const optimizePromptResponseSchema = z.object({
  prompt: z.string().min(1).max(4000),
  /** Name of the chat model that wrote it, e.g. "gpt-5.4-mini". */
  model: z.string(),
});
export type OptimizePromptResponse = z.infer<
  typeof optimizePromptResponseSchema
>;

// --- API Response schemas ---

export const jobResponseSchema = z.object({
  job: backgroundJobSchema,
});
export type JobResponse = z.infer<typeof jobResponseSchema>;

/** Most jobs one page of GET /api/jobs returns. */
export const JOB_PAGE_MAX = 100;

/**
 * Where a picture was made (第 56 条, 最近生成 filter): the studio (no
 * canvas), a 生成 node on a canvas (`canvas_source_id`), or the design
 * assistant (a canvas, no node).
 */
export const IMAGE_JOB_SOURCES = ["studio", "canvas", "assistant"] as const;
export type ImageJobSource = (typeof IMAGE_JOB_SOURCES)[number];

/**
 * 生成记录 filters (第 58 条), applied on the server so pages and totals
 * match: 待核对 (billing pending/unknown on a finished job, unknown on an
 * active one, as `needsReconcile` in the web app) and 失败.
 */
export const JOB_LIST_VIEWS = ["reconcile", "failed"] as const;
export type JobListView = (typeof JOB_LIST_VIEWS)[number];

export const jobListCountsSchema = z.object({
  all: z.number().int().nonnegative(),
  reconcile: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});
export type JobListCounts = z.infer<typeof jobListCountsSchema>;

export const jobListResponseSchema = z.object({
  jobs: z.array(backgroundJobSchema),
  /**
   * Pass as `before` for the next (older) page; null on the last page.
   * Absent from servers before 第 56 条, which return the newest 50 only.
   */
  next_before: z.string().nullable().optional(),
  /** Rows matching the filters (`with_total=1`, 第 58 条 numbered pages). */
  total: z.number().int().nonnegative().optional(),
  /** Per-filter totals for the 生成记录 tabs (`with_total=1`). */
  counts: jobListCountsSchema.optional(),
});
export type JobListResponse = z.infer<typeof jobListResponseSchema>;

/**
 * Most pictures one delete or restore takes (第 58 条). A page of 作品 or
 * 生成记录 is at most JOB_PAGE_MAX; select-all across a long 作品 scroll
 * can reach a few hundred.
 */
export const JOB_DELETE_MAX = 500;

export const jobIdsRequestSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(JOB_DELETE_MAX),
});
export type JobIdsRequest = z.infer<typeof jobIdsRequestSchema>;

/**
 * POST /api/jobs/delete. `skipped`: still queued or running (cancel or wait
 * first), already deleted, or not the user's. Deleted pictures leave every
 * list at once; the row stays as the billing record.
 */
export const jobDeleteResponseSchema = z.object({
  deleted: z.array(z.string().uuid()),
  skipped: z.array(z.string().uuid()),
});
export type JobDeleteResponse = z.infer<typeof jobDeleteResponseSchema>;

/** POST /api/jobs/restore: undo, until the purge has run (about 24 hours). */
export const jobRestoreResponseSchema = z.object({
  restored: z.array(z.string().uuid()),
});
export type JobRestoreResponse = z.infer<typeof jobRestoreResponseSchema>;

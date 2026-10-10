import { z } from "zod";

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
  quality: z.enum(["standard", "hd", "ultra"]).optional(),
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

export const createImageJobRequestSchema = z.object({
  input_images: z.array(z.string()).max(14).optional(),
  project_id: z.string().uuid().optional(),
  canvas_id: z.string().uuid().optional(),
  session_id: z.string().uuid().optional(),
  thread_id: z.string().optional(),
  prompt: z.string().min(1).max(4000),
  model: z.string().optional(),
  aspect_ratio: z.string().optional(),
  quality: z.enum(["standard", "hd", "ultra"]).optional(),
});
export type CreateImageJobRequest = z.infer<typeof createImageJobRequestSchema>;

/**
 * Most pictures one studio request can ask for. Each picture is its own job
 * (and its own main-site charge); the jobs share `batch_id` in their payload.
 */
export const IMAGE_BATCH_MAX = 4;

export const createImageBatchRequestSchema = createImageJobRequestSchema.extend(
  {
    count: z.number().int().min(1).max(IMAGE_BATCH_MAX),
  },
);
export type CreateImageBatchRequest = z.infer<
  typeof createImageBatchRequestSchema
>;

/** Batch fields the server adds to each job's payload. */
export const imageBatchPayloadSchema = z.object({
  batch_id: z.string().uuid(),
  batch_index: z.number().int().min(0),
  batch_size: z.number().int().min(1).max(IMAGE_BATCH_MAX),
});
export type ImageBatchPayload = z.infer<typeof imageBatchPayloadSchema>;

export const imageBatchResponseSchema = z.object({
  batch_id: z.string().uuid(),
  /** How many pictures were asked for; `jobs` can be shorter if submission stopped part way. */
  requested: z.number().int().min(1).max(IMAGE_BATCH_MAX),
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

export const jobListResponseSchema = z.object({
  jobs: z.array(backgroundJobSchema),
});
export type JobListResponse = z.infer<typeof jobListResponseSchema>;

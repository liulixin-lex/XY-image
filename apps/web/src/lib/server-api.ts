import type {
  AssetSignedUrlResponse,
  BackgroundJob,
  ImageEdit,
  ImageJobSource,
  CancelImageBatchResponse,
  ImageBatchResponse,
  OptimizePromptResponse,
  CanvasDetail,
  ChatMessageCreateRequest,
  JobDeleteResponse,
  JobListResponse,
  JobListView,
  JobResponse,
  JobRestoreResponse,
  MarketplaceDetail,
  MarketplaceSearchResponse,
  MessageCreateResponse,
  MessageListResponse,
  ProfileUpdateResponse,
  ProjectCreateRequest,
  ProjectCreateResponse,
  ProjectListResponse,
  ProjectUpdateRequest,
  RunCreateRequest,
  RunCreateResponse,
  SessionCreateResponse,
  SessionListResponse,
  SkillCreateRequest,
  SkillDetailResponse,
  SkillListResponse,
  SkillUpdateRequest,
  UploadResponse,
  ViewerResponse,
  WorkspaceSkillListResponse,
} from "@loomic/shared";
import type {
  ImageBackground,
  ImageModeration,
  ImageOutputFormat,
  ImageQuality,
  ImageResolution,
} from "@loomic/shared";

import {
  type ChatModelList,
  type RawChatModelList,
  normalizeChatModelList,
} from "./chat-models";
import { dedupeRequest } from "./dedupe-request";
import { getServerBaseUrl } from "./env";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Thrown on HTTP 401. The session is gone; the UI must send the user to login. */
export class ApiAuthError extends Error {
  constructor(message = "unauthorized") {
    super(message);
    this.name = "ApiAuthError";
  }
}

/**
 * Any non-401 API failure. `code` is the server's stable error code
 * (`insufficient_balance`, `key_unavailable`, ...); route UI on it, never on
 * `status` alone, because gateway failures are mapped to 502 on purpose.
 */
export class ApiApplicationError extends Error {
  code: string;
  status: number;
  /** Seconds from the `Retry-After` header, when the server sent one. */
  retryAfter: number | null;
  constructor(
    code: string,
    message: string,
    status = 0,
    retryAfter: number | null = null,
  ) {
    super(message);
    this.name = "ApiApplicationError";
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

/**
 * Window event fired once per expiry when a protected request returns 401.
 * AuthProvider listens, clears the local session and routes to
 * `/login?reason=expired`. Login endpoints never fire it.
 */
export const AUTH_EXPIRED_EVENT = "xy:auth-expired";

export function emitAuthExpired(source: string) {
  if (typeof window === "undefined") return;
  console.warn(`[auth] session rejected by API (${source})`);
  window.dispatchEvent(
    new CustomEvent(AUTH_EXPIRED_EVENT, { detail: { source } }),
  );
}

function readRetryAfter(response: Response): number | null {
  const raw =
    typeof response.headers?.get === "function"
      ? response.headers.get("Retry-After")
      : null;
  if (!raw) return null;
  const seconds = Number.parseInt(raw, 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

/**
 * Convert a failed response into a typed error.
 * `authExpiry: false` is for endpoints where 401 is a form error (login).
 */
export async function toApiError(
  response: Response,
  options: { authExpiry?: boolean; source?: string } = {},
): Promise<ApiAuthError | ApiApplicationError> {
  const body = (await response.json().catch(() => null)) as {
    error?: { code?: string; message?: string };
  } | null;
  const code = body?.error?.code ?? "application_error";
  const message = body?.error?.message ?? "请求失败，请稍后再试";
  if (response.status === 401 && options.authExpiry !== false) {
    emitAuthExpired(options.source ?? "http");
    return new ApiAuthError();
  }
  return new ApiApplicationError(
    code,
    message,
    response.status,
    readRetryAfter(response),
  );
}

async function handleErrorResponse(response: Response): Promise<never> {
  throw await toApiError(response);
}

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

function authJsonHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
  };
}

// --- Existing ---

export async function createRun(
  payload: RunCreateRequest,
  options?: { accessToken?: string },
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (options?.accessToken) {
    headers.Authorization = `Bearer ${options.accessToken}`;
  }

  const response = await fetch(`${getServerBaseUrl()}/api/agent/runs`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) return handleErrorResponse(response);

  return (await response.json()) as RunCreateResponse;
}

// --- Authenticated API ---

export async function fetchViewer(
  accessToken: string,
): Promise<ViewerResponse> {
  const response = await fetch(`${getServerBaseUrl()}/api/viewer`, {
    headers: authHeaders(accessToken),
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as ViewerResponse;
}

export async function fetchProjects(
  accessToken: string,
): Promise<ProjectListResponse> {
  const response = await fetch(`${getServerBaseUrl()}/api/projects`, {
    headers: authHeaders(accessToken),
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as ProjectListResponse;
}

export async function createProject(
  accessToken: string,
  data: ProjectCreateRequest,
): Promise<ProjectCreateResponse> {
  const response = await fetch(`${getServerBaseUrl()}/api/projects`, {
    method: "POST",
    headers: authJsonHeaders(accessToken),
    body: JSON.stringify(data),
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as ProjectCreateResponse;
}

export async function deleteProject(
  accessToken: string,
  projectId: string,
): Promise<void> {
  const response = await fetch(
    `${getServerBaseUrl()}/api/projects/${projectId}`,
    {
      method: "DELETE",
      headers: authHeaders(accessToken),
    },
  );
  if (!response.ok) return handleErrorResponse(response);
}

export async function fetchProject(
  accessToken: string,
  projectId: string,
): Promise<{
  project: { id: string; name: string; brand_kit_id: string | null };
}> {
  const response = await fetch(
    `${getServerBaseUrl()}/api/projects/${projectId}`,
    { headers: authHeaders(accessToken) },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as {
    project: { id: string; name: string; brand_kit_id: string | null };
  };
}

export async function updateProject(
  accessToken: string,
  projectId: string,
  data: ProjectUpdateRequest,
): Promise<void> {
  const response = await fetch(
    `${getServerBaseUrl()}/api/projects/${projectId}`,
    {
      method: "PATCH",
      headers: authJsonHeaders(accessToken),
      body: JSON.stringify(data),
    },
  );
  if (!response.ok) return handleErrorResponse(response);
}

// --- Canvas API ---

export async function fetchCanvas(
  accessToken: string,
  canvasId: string,
): Promise<{ canvas: CanvasDetail }> {
  const response = await fetch(
    `${getServerBaseUrl()}/api/canvases/${canvasId}`,
    { headers: authHeaders(accessToken) },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as { canvas: CanvasDetail };
}

export async function saveCanvas(
  accessToken: string,
  canvasId: string,
  content: {
    elements: Record<string, unknown>[];
    appState: Record<string, unknown>;
    files: Record<string, Record<string, unknown>>;
  },
  // Elements the user deleted on this page (see lib/canvas-save.ts).
  deletedElementIds?: string[],
): Promise<{ missingFileIds: string[] }> {
  const response = await fetch(
    `${getServerBaseUrl()}/api/canvases/${canvasId}`,
    {
      method: "PUT",
      headers: authJsonHeaders(accessToken),
      body: JSON.stringify({ content, deletedElementIds }),
    },
  );
  if (!response.ok) return handleErrorResponse(response);
  // Image files the server has no data for (see lib/canvas-files.ts).
  const body = (await response.json().catch(() => null)) as {
    missingFileIds?: unknown;
  } | null;
  return {
    missingFileIds: Array.isArray(body?.missingFileIds)
      ? body.missingFileIds.filter((id): id is string => typeof id === "string")
      : [],
  };
}

export async function uploadThumbnail(
  accessToken: string,
  projectId: string,
  blob: Blob,
): Promise<void> {
  const formData = new FormData();
  formData.append("file", blob, "thumbnail.webp");
  const response = await fetch(
    `${getServerBaseUrl()}/api/projects/${projectId}/thumbnail`,
    {
      method: "PUT",
      headers: authHeaders(accessToken),
      body: formData,
    },
  );
  if (!response.ok) return handleErrorResponse(response);
}

// --- Settings API ---

export async function updateProfile(
  accessToken: string,
  data: { displayName: string },
): Promise<ProfileUpdateResponse> {
  const response = await fetch(`${getServerBaseUrl()}/api/viewer/profile`, {
    method: "PATCH",
    headers: authJsonHeaders(accessToken),
    body: JSON.stringify(data),
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as ProfileUpdateResponse;
}

// --- Models (scoped to the user's selected xy2api keys) ---

/**
 * Chat models for the design agent: the selected main-site chat key's models
 * (`openai:<model>`) plus the user's own providers (`custom:<id>:<model>`).
 *
 * Older servers return main-site models only and fail with `key_unavailable`
 * when no usable chat key is selected; newer ones still list the user's
 * providers and report the key problem in `xy2api.error` (plan §6.4).
 * `normalizeChatModelList` accepts both.
 */
export async function fetchModels(
  accessToken: string,
): Promise<ChatModelList> {
  return dedupeRequest(`models:${accessToken.slice(-12)}`, async () => {
    const response = await fetch(`${getServerBaseUrl()}/api/models`, {
      headers: authHeaders(accessToken),
    });
    if (!response.ok) return handleErrorResponse(response);
    return normalizeChatModelList((await response.json()) as RawChatModelList);
  });
}

export type { ImageQuality, ImageResolution };

export type ImageModelInfo = {
  /** Exact id to send back (may be a `*-preview` alias). */
  id: string;
  /**
   * The main-site key this entry comes through (第 56 条: the list holds the
   * models of every key that is on, so one model can appear under two keys).
   * Absent from older servers, which list the selected key only.
   */
  keyId?: number;
  keyName?: string;
  groupName?: string | null;
  displayName: string;
  description: string;
  provider: string;
  iconUrl?: string;
  /** Always null in P0; cost is decided by the main site. */
  priceUsd?: number | null;
  /** Maker (openai, google, xai, …). */
  vendor?: string;
  /** 画质 / 质量 / 比例 the model accepts, from the server catalog. */
  resolutions?: ImageResolution[];
  /** Empty when the model has no 质量 setting. */
  qualities?: ImageQuality[];
  /** What 质量「自动」 amounts to, when the vendor documents it (第 66 条). */
  autoQuality?: ImageQuality;
  /** 第 66 条, OpenAI models: 背景 / 格式 / 审核 the model takes (empty: none). */
  backgrounds?: ImageBackground[];
  outputFormats?: ImageOutputFormat[];
  moderations?: ImageModeration[];
  /** The site's own format and compression, i.e. what 「默认」 sends. */
  outputDefaults?: { format: ImageOutputFormat; compression: number };
  aspectRatios?: string[];
  /** Widest shape (long side ÷ short side) a size can make; no entry = any. */
  maxRatio?: Partial<Record<ImageResolution, number>>;
  supportsEdit?: boolean;
  maxInputImages?: number;
  /** 局部重绘 / 扩图 in the studio (absent on older servers: treated as no). */
  maskEdit?: boolean;
  /** Sent by older servers instead: `standard` = 1K only, `hd` = 1K and 2K. */
  maxQuality?: "standard" | "hd";
  accessible?: boolean;
  /** Compatibility fields from the old credits system. Never display. */
  creditCost?: number;
  minTier?: string;
};

/** An image key whose models are listed (no secret). */
export type ImageKeyInfo = {
  keyId: number;
  name: string;
  groupName: string | null;
  isDefault: boolean;
};

/**
 * Image models of every key that is on (第 56 条), grouped by key: the
 * default key first. Older servers list the selected key only, without
 * `keys` or the key fields on each model.
 */
export async function fetchImageModels(
  accessToken: string,
): Promise<{ models: ImageModelInfo[]; keys?: ImageKeyInfo[] }> {
  return dedupeRequest(`image-models:${accessToken.slice(-12)}`, async () => {
    const response = await fetch(`${getServerBaseUrl()}/api/image-models`, {
      headers: authHeaders(accessToken),
    });
    if (!response.ok) return handleErrorResponse(response);
    const data = (await response.json()) as {
      models: ImageModelInfo[];
      keys?: ImageKeyInfo[];
      outputDefaults?: ImageModelInfo["outputDefaults"];
    };
    // The site default travels with each model, so pickers need no extra state.
    const defaults = data.outputDefaults;
    return {
      models: defaults
        ? data.models.map((model) => ({ ...model, outputDefaults: defaults }))
        : data.models,
      ...(data.keys ? { keys: data.keys } : {}),
    };
  });
}

// --- Chat Session API ---

export function fetchSessions(
  accessToken: string,
  canvasId: string,
): Promise<SessionListResponse> {
  return dedupeRequest(`sessions:${canvasId}`, async () => {
    const response = await fetch(
      `${getServerBaseUrl()}/api/canvases/${canvasId}/sessions`,
      { headers: authHeaders(accessToken) },
    );
    if (!response.ok) return handleErrorResponse(response);
    return (await response.json()) as SessionListResponse;
  });
}

export async function createSession(
  accessToken: string,
  canvasId: string,
  title?: string,
): Promise<SessionCreateResponse> {
  const response = await fetch(
    `${getServerBaseUrl()}/api/canvases/${canvasId}/sessions`,
    {
      method: "POST",
      headers: authJsonHeaders(accessToken),
      body: JSON.stringify(title ? { title } : {}),
    },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as SessionCreateResponse;
}

export async function updateSessionTitle(
  accessToken: string,
  sessionId: string,
  title: string,
): Promise<void> {
  const response = await fetch(
    `${getServerBaseUrl()}/api/sessions/${sessionId}`,
    {
      method: "PATCH",
      headers: authJsonHeaders(accessToken),
      body: JSON.stringify({ title }),
    },
  );
  if (!response.ok) return handleErrorResponse(response);
}

export async function deleteSession(
  accessToken: string,
  sessionId: string,
): Promise<void> {
  const response = await fetch(
    `${getServerBaseUrl()}/api/sessions/${sessionId}`,
    {
      method: "DELETE",
      headers: authHeaders(accessToken),
    },
  );
  if (!response.ok) return handleErrorResponse(response);
}

export async function fetchMessages(
  accessToken: string,
  sessionId: string,
): Promise<MessageListResponse> {
  const response = await fetch(
    `${getServerBaseUrl()}/api/sessions/${sessionId}/messages`,
    { headers: authHeaders(accessToken) },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as MessageListResponse;
}

export async function saveMessage(
  accessToken: string,
  sessionId: string,
  data: ChatMessageCreateRequest,
): Promise<MessageCreateResponse> {
  const response = await fetch(
    `${getServerBaseUrl()}/api/sessions/${sessionId}/messages`,
    {
      method: "POST",
      headers: authJsonHeaders(accessToken),
      body: JSON.stringify(data),
    },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as MessageCreateResponse;
}

// --- Upload API ---

export async function uploadFile(
  accessToken: string,
  file: File,
  projectId?: string,
): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("file", file);
  if (projectId) {
    formData.append("projectId", projectId);
  }

  const response = await fetch(`${getServerBaseUrl()}/api/uploads`, {
    method: "POST",
    headers: authHeaders(accessToken),
    body: formData,
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as UploadResponse;
}

export async function getAssetUrl(
  accessToken: string,
  assetId: string,
): Promise<AssetSignedUrlResponse> {
  const response = await fetch(
    `${getServerBaseUrl()}/api/uploads/${assetId}/url`,
    { headers: authHeaders(accessToken) },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as AssetSignedUrlResponse;
}

export async function deleteAsset(
  accessToken: string,
  assetId: string,
): Promise<void> {
  const response = await fetch(`${getServerBaseUrl()}/api/uploads/${assetId}`, {
    method: "DELETE",
    headers: authHeaders(accessToken),
  });
  if (!response.ok) return handleErrorResponse(response);
}

// --- Canvas-Native Generation API ---

export type GenerateImageResponse = {
  url: string;
  assetId?: string;
  prompt: string;
  mimeType: string;
  width: number;
  height: number;
};

export type GenerateImageOptions = {
  model?: string;
  aspectRatio?: string;
  resolution?: ImageResolution;
  quality?: ImageQuality;
  /** Supabase Storage URLs or PNG/JPEG/WebP data URLs, max 10 MiB each. */
  inputImages?: string[];
};

/**
 * Synchronous canvas generation. May take up to ten minutes.
 *
 * Billing rule: this call is never retried. If the connection drops after the
 * request left the browser, the main site may already have charged; the
 * error is surfaced as `upstream_unknown` so the UI tells the user to check
 * the main-site usage page instead of offering a blind retry.
 */
export async function generateImageDirect(
  accessToken: string,
  prompt: string,
  options?: GenerateImageOptions,
): Promise<GenerateImageResponse> {
  let response: Response;
  try {
    response = await fetch(`${getServerBaseUrl()}/api/agent/generate-image`, {
      method: "POST",
      headers: authJsonHeaders(accessToken),
      body: JSON.stringify({
        prompt,
        ...(options?.model ? { model: options.model } : {}),
        ...(options?.aspectRatio ? { aspectRatio: options.aspectRatio } : {}),
        ...(options?.resolution ? { resolution: options.resolution } : {}),
        ...(options?.quality ? { quality: options.quality } : {}),
        ...(options?.inputImages?.length
          ? { inputImages: options.inputImages }
          : {}),
      }),
    });
  } catch (error) {
    console.error("[generate-image] request interrupted", error);
    throw new ApiApplicationError(
      "upstream_unknown",
      "连接中断，图片可能已经生成，请先到主站用量页核对",
    );
  }
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as GenerateImageResponse;
}

// --- Jobs API ---

export type CreateImageJobInput = {
  prompt: string;
  model?: string;
  /** The key `model` was picked under (ImageModelInfo.keyId). */
  key_id?: number;
  /** 画质: 1K / 2K / 4K. */
  resolution?: ImageResolution;
  /** 质量: auto … max; the server moves it to what the model has. */
  quality?: ImageQuality;
  aspect_ratio?: string;
  /** 第 66 条, OpenAI models only: 背景 / 格式 / 压缩 / 审核. */
  background?: ImageBackground;
  output_format?: ImageOutputFormat;
  output_compression?: number;
  moderation?: ImageModeration;
  input_images?: string[];
  project_id?: string;
  canvas_id?: string;
  /** Node canvas: the generator node the pictures come from (with canvas_id). */
  canvas_source_id?: string;
  /** Node canvas: where each picture goes, in batch order (with canvas_id). */
  canvas_slots?: { x: number; y: number; width: number; height: number }[];
  /** 局部重绘 / 扩图 on input_images[0] (exactly one). */
  edit?: ImageEdit;
  session_id?: string;
  thread_id?: string;
};

/**
 * A batch: `count` pictures of `model`, or `targets` (多模型, 第 56 条):
 * several models side by side, each through its key, with their own counts.
 */
export type CreateImageBatchInput =
  | (CreateImageJobInput & { count: number; targets?: undefined })
  | (Omit<CreateImageJobInput, "model" | "key_id"> & {
      targets: { model: string; key_id?: number; count: number }[];
      count?: undefined;
    });

/** Queue an image generation job (studio). Returns 201 `{ job }`. */
export async function createImageJob(
  accessToken: string,
  input: CreateImageJobInput,
): Promise<JobResponse> {
  const response = await fetch(
    `${getServerBaseUrl()}/api/jobs/image-generation`,
    {
      method: "POST",
      headers: authJsonHeaders(accessToken),
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as JobResponse;
}

export async function fetchJob(
  accessToken: string,
  jobId: string,
): Promise<JobResponse> {
  const response = await fetch(`${getServerBaseUrl()}/api/jobs/${jobId}`, {
    headers: authHeaders(accessToken),
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as JobResponse;
}

/** Latest 50 jobs of the user, newest first. */
export async function fetchJobs(
  accessToken: string,
  filters: {
    status?: BackgroundJob["status"];
    jobType?: BackgroundJob["job_type"];
    /** 历史 pages: `next_before` of the previous page. */
    before?: string;
    /** 1–100; the server defaults to 50. */
    limit?: number;
    /** Image jobs: studio, a canvas 生成 node, or the design assistant. */
    source?: ImageJobSource;
    /** 生成记录 numbered pages: rows to skip. */
    offset?: number;
    /** 生成记录 filter: 待核对 or 失败 (on the server, so totals match). */
    view?: JobListView;
    /** Adds `total` and the per-filter `counts`. */
    withTotal?: boolean;
  } = {},
): Promise<JobListResponse> {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.jobType) params.set("job_type", filters.jobType);
  if (filters.before) params.set("before", filters.before);
  if (filters.offset) params.set("offset", String(filters.offset));
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.source) params.set("source", filters.source);
  if (filters.view) params.set("view", filters.view);
  if (filters.withTotal) params.set("with_total", "1");
  const query = params.toString();
  const response = await fetch(
    `${getServerBaseUrl()}/api/jobs${query ? `?${query}` : ""}`,
    { headers: authHeaders(accessToken) },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as JobListResponse;
}

/**
 * Deletes finished pictures from 作品 and 生成记录 (第 58 条). Pictures still
 * queued or running come back in `skipped`. Undo with restoreJobs.
 */
export async function deleteJobs(
  accessToken: string,
  ids: string[],
): Promise<JobDeleteResponse> {
  const response = await fetch(`${getServerBaseUrl()}/api/jobs/delete`, {
    method: "POST",
    headers: authJsonHeaders(accessToken),
    body: JSON.stringify({ ids }),
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as JobDeleteResponse;
}

/** Brings deleted pictures back (撤销), until the purge ran a day later. */
export async function restoreJobs(
  accessToken: string,
  ids: string[],
): Promise<JobRestoreResponse> {
  const response = await fetch(`${getServerBaseUrl()}/api/jobs/restore`, {
    method: "POST",
    headers: authJsonHeaders(accessToken),
    body: JSON.stringify({ ids }),
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as JobRestoreResponse;
}

/**
 * Queue 1 to IMAGE_BATCH_MAX pictures from one description (studio). Each
 * picture is its own job and its own charge; they share `batch_id`. Sent
 * once: a failed call is reported, never repeated. `jobs` may be shorter
 * than `requested` if the server stopped part way (nothing was sent then).
 */
export async function createImageBatch(
  accessToken: string,
  input: CreateImageBatchInput,
): Promise<ImageBatchResponse> {
  const response = await fetch(
    `${getServerBaseUrl()}/api/jobs/image-generation/batch`,
    {
      method: "POST",
      headers: authJsonHeaders(accessToken),
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as ImageBatchResponse;
}

/** Cancel the pictures of a batch that have not been sent to the main site yet. */
export async function cancelImageBatch(
  accessToken: string,
  batchId: string,
): Promise<CancelImageBatchResponse> {
  const response = await fetch(
    `${getServerBaseUrl()}/api/jobs/image-batches/${encodeURIComponent(batchId)}/cancel`,
    { method: "POST", headers: authHeaders(accessToken) },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as CancelImageBatchResponse;
}

/**
 * 优化提示词: one request to the user's own chat model (a little balance).
 * The caller keeps the original text so the user can undo.
 */
export async function optimizePrompt(
  accessToken: string,
  input: { prompt: string; aspect_ratio?: string },
): Promise<OptimizePromptResponse> {
  const response = await fetch(`${getServerBaseUrl()}/api/prompts/optimize`, {
    method: "POST",
    headers: authJsonHeaders(accessToken),
    body: JSON.stringify(input),
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as OptimizePromptResponse;
}

/** Only queued jobs can be canceled; running ones already reached the main site. */
export async function cancelJob(
  accessToken: string,
  jobId: string,
): Promise<JobResponse> {
  const response = await fetch(
    `${getServerBaseUrl()}/api/jobs/${jobId}/cancel`,
    {
      method: "POST",
      headers: authHeaders(accessToken),
    },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as JobResponse;
}

// --- Skills API ---

export async function fetchSkills(
  accessToken: string,
): Promise<SkillListResponse> {
  const response = await fetch(`${getServerBaseUrl()}/api/skills`, {
    headers: authHeaders(accessToken),
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as SkillListResponse;
}

export async function fetchSkillDetail(
  accessToken: string,
  id: string,
): Promise<SkillDetailResponse> {
  const response = await fetch(`${getServerBaseUrl()}/api/skills/${id}`, {
    headers: authHeaders(accessToken),
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as SkillDetailResponse;
}

export async function createSkill(
  accessToken: string,
  data: SkillCreateRequest,
): Promise<SkillDetailResponse> {
  const response = await fetch(`${getServerBaseUrl()}/api/skills`, {
    method: "POST",
    headers: authJsonHeaders(accessToken),
    body: JSON.stringify(data),
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as SkillDetailResponse;
}

export async function updateSkill(
  accessToken: string,
  id: string,
  data: SkillUpdateRequest,
): Promise<SkillDetailResponse> {
  const response = await fetch(`${getServerBaseUrl()}/api/skills/${id}`, {
    method: "PUT",
    headers: authJsonHeaders(accessToken),
    body: JSON.stringify(data),
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as SkillDetailResponse;
}

export async function deleteSkill(
  accessToken: string,
  id: string,
): Promise<void> {
  const response = await fetch(`${getServerBaseUrl()}/api/skills/${id}`, {
    method: "DELETE",
    headers: authHeaders(accessToken),
  });
  if (!response.ok) return handleErrorResponse(response);
}

export type SkillFile = {
  id: string;
  filePath: string;
  content: string;
  mimeType: string;
  createdAt: string;
  updatedAt: string;
};

export async function fetchSkillFiles(
  accessToken: string,
  skillId: string,
): Promise<{ files: SkillFile[] }> {
  const response = await fetch(
    `${getServerBaseUrl()}/api/skills/${skillId}/files`,
    { headers: authHeaders(accessToken) },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as { files: SkillFile[] };
}

// --- Workspace Skills API ---

export async function fetchWorkspaceSkills(
  accessToken: string,
): Promise<WorkspaceSkillListResponse> {
  const response = await fetch(`${getServerBaseUrl()}/api/workspaces/skills`, {
    headers: authHeaders(accessToken),
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as WorkspaceSkillListResponse;
}

export async function installSkill(
  accessToken: string,
  skillId: string,
): Promise<void> {
  const response = await fetch(`${getServerBaseUrl()}/api/workspaces/skills`, {
    method: "POST",
    headers: authJsonHeaders(accessToken),
    body: JSON.stringify({ skillId }),
  });
  if (!response.ok) return handleErrorResponse(response);
}

export async function uninstallSkill(
  accessToken: string,
  skillId: string,
): Promise<void> {
  const response = await fetch(
    `${getServerBaseUrl()}/api/workspaces/skills/${skillId}`,
    {
      method: "DELETE",
      headers: authHeaders(accessToken),
    },
  );
  if (!response.ok) return handleErrorResponse(response);
}

export async function toggleSkill(
  accessToken: string,
  skillId: string,
  enabled: boolean,
): Promise<void> {
  const response = await fetch(
    `${getServerBaseUrl()}/api/workspaces/skills/${skillId}`,
    {
      method: "PATCH",
      headers: authJsonHeaders(accessToken),
      body: JSON.stringify({ enabled }),
    },
  );
  if (!response.ok) return handleErrorResponse(response);
}

// --- Marketplace API ---

export async function searchMarketplace(
  accessToken: string,
  query: string,
  page = 1,
  limit = 20,
): Promise<MarketplaceSearchResponse> {
  const params = new URLSearchParams({
    q: query,
    page: String(page),
    limit: String(limit),
  });
  const response = await fetch(
    `${getServerBaseUrl()}/api/skills/marketplace/search?${params}`,
    { headers: authHeaders(accessToken) },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as MarketplaceSearchResponse;
}

export async function getMarketplaceDetail(
  accessToken: string,
  packageName: string,
): Promise<MarketplaceDetail> {
  const params = new URLSearchParams({ name: packageName });
  const response = await fetch(
    `${getServerBaseUrl()}/api/skills/marketplace/detail?${params}`,
    { headers: authHeaders(accessToken) },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as MarketplaceDetail;
}

export async function installMarketplaceSkill(
  accessToken: string,
  packageName: string,
): Promise<SkillDetailResponse> {
  const response = await fetch(
    `${getServerBaseUrl()}/api/skills/marketplace/install`,
    {
      method: "POST",
      headers: authJsonHeaders(accessToken),
      body: JSON.stringify({ packageName }),
    },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as SkillDetailResponse;
}

export async function importSkillFromUrl(
  accessToken: string,
  url: string,
): Promise<SkillDetailResponse> {
  const response = await fetch(`${getServerBaseUrl()}/api/skills/import`, {
    method: "POST",
    headers: authJsonHeaders(accessToken),
    body: JSON.stringify({ url }),
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as SkillDetailResponse;
}

import type {
  AssetSignedUrlResponse,
  BackgroundJob,
  CanvasDetail,
  ChatMessageCreateRequest,
  JobListResponse,
  JobResponse,
  MarketplaceDetail,
  MarketplaceSearchResponse,
  MessageCreateResponse,
  MessageListResponse,
  ModelListResponse,
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
  WorkspaceSettingsResponse,
  WorkspaceSkillListResponse,
} from "@loomic/shared";

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
): Promise<void> {
  const response = await fetch(
    `${getServerBaseUrl()}/api/canvases/${canvasId}`,
    {
      method: "PUT",
      headers: authJsonHeaders(accessToken),
      body: JSON.stringify({ content }),
    },
  );
  if (!response.ok) return handleErrorResponse(response);
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

export async function fetchWorkspaceSettings(
  accessToken: string,
): Promise<WorkspaceSettingsResponse> {
  const response = await fetch(`${getServerBaseUrl()}/api/workspace/settings`, {
    headers: authHeaders(accessToken),
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as WorkspaceSettingsResponse;
}

export async function updateWorkspaceSettings(
  accessToken: string,
  data: { defaultModel: string },
): Promise<WorkspaceSettingsResponse> {
  const response = await fetch(`${getServerBaseUrl()}/api/workspace/settings`, {
    method: "PUT",
    headers: authJsonHeaders(accessToken),
    body: JSON.stringify(data),
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as WorkspaceSettingsResponse;
}

// --- Models (scoped to the user's selected xy2api keys) ---

/**
 * Chat models available to the selected chat key. Ids are `openai:<model>`.
 * Fails with `key_unavailable` when no usable chat key is selected; there is
 * no platform fallback.
 */
export async function fetchModels(
  accessToken: string,
): Promise<ModelListResponse> {
  return dedupeRequest(`models:${accessToken.slice(-12)}`, async () => {
    const response = await fetch(`${getServerBaseUrl()}/api/models`, {
      headers: authHeaders(accessToken),
    });
    if (!response.ok) return handleErrorResponse(response);
    return (await response.json()) as ModelListResponse;
  });
}

export type ImageQuality = "standard" | "hd";

export type ImageModelInfo = {
  /** Exact id to send back (may be a `*-preview` alias). */
  id: string;
  displayName: string;
  description: string;
  provider: string;
  iconUrl?: string;
  /** Always null in P0; cost is decided by the main site. */
  priceUsd?: number | null;
  /** `standard` = 1K only, `hd` = 1K and 2K. */
  maxQuality?: ImageQuality;
  accessible?: boolean;
  /** Compatibility fields from the old credits system. Never display. */
  creditCost?: number;
  minTier?: string;
};

/** Image models available to the selected image key. */
export async function fetchImageModels(
  accessToken: string,
): Promise<{ models: ImageModelInfo[] }> {
  return dedupeRequest(`image-models:${accessToken.slice(-12)}`, async () => {
    const response = await fetch(`${getServerBaseUrl()}/api/image-models`, {
      headers: authHeaders(accessToken),
    });
    if (!response.ok) return handleErrorResponse(response);
    return (await response.json()) as { models: ImageModelInfo[] };
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
  quality?: string;
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
      "连接中断，图片可能已生成并扣费，请先到主站用量页核对",
    );
  }
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as GenerateImageResponse;
}

// --- Jobs API ---

export type CreateImageJobInput = {
  prompt: string;
  model?: string;
  quality?: ImageQuality;
  aspect_ratio?: string;
  input_images?: string[];
  project_id?: string;
  canvas_id?: string;
  session_id?: string;
  thread_id?: string;
};

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
  filters: { status?: BackgroundJob["status"]; jobType?: BackgroundJob["job_type"] } = {},
): Promise<JobListResponse> {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.jobType) params.set("job_type", filters.jobType);
  const query = params.toString();
  const response = await fetch(
    `${getServerBaseUrl()}/api/jobs${query ? `?${query}` : ""}`,
    { headers: authHeaders(accessToken) },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as JobListResponse;
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

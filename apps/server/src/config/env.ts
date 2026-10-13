import { readFileSync } from "node:fs";
import { z } from "zod";

export const DEFAULT_AGENT_BACKEND_MODE = "state";
export const DEFAULT_AGENT_MODEL = "gpt-5.4";
// Offered when the key's /v1/models also lists them, in this order; `*` adds
// the key's other non-image models (pickChatModels in xy2api/catalog.ts).
export const DEFAULT_CHAT_MODELS =
  "gpt-5.4,gpt-6-luna,gpt-6-sol,gpt-5.4-mini,gpt-4.1,gpt-4o-mini,*";
export const DEFAULT_SERVER_PORT = 3001;
export const DEFAULT_WEB_ORIGIN = "http://localhost:3000";
export type AgentBackendMode = "filesystem" | "state";
export function resolveDefaultAgentModel(
  _env: Partial<ServerEnv> = {},
): string {
  return DEFAULT_AGENT_MODEL;
}
export type ServerEnv = {
  xy2apiBaseUrl: string;
  xy2apiWebUrl: string;
  secretKey: string;
  ssoEmailDomain: string;
  imageModelsJson?: string;
  chatModels: string[];
  chatProviderAllowHttp: boolean;
  chatProviderAllowedHosts: string[];
  /** Image requests one user may have in flight at the main site (worker dispatch gate). */
  maxConcurrentJobs: number;
  /** Image jobs one user may have queued or in flight (API admission; a studio batch counts each picture). */
  maxPendingImageJobs: number;
  maxImagesPerRun: number;
  sessionRevalidateMinutes: number;
  imageOutputFormat: "jpeg" | "png" | "webp";
  imageOutputCompression: number;
  trustProxy: boolean;
  egressIp?: string;
  defaultKeyGroupId?: number;
  embedLoginEnabled: boolean;
  agentBackendMode: AgentBackendMode;
  agentFilesRoot?: string;
  agentModel: string;
  googleApiKey?: string;
  googleApplicationCredentials?: string;
  googleFontsApiKey?: string;
  googleVertexLocation?: string;
  googleVertexProject?: string;
  googleVertexVideoLocation?: string;
  metasoApiBase?: string;
  metasoApiKey?: string;
  openAIApiBase?: string;
  openAIApiKey?: string;
  port: number;
  replicateApiToken?: string;
  supabaseAnonKey?: string;
  supabaseDbUrl?: string;
  supabaseJwtSecret?: string;
  supabaseProjectId?: string;
  supabaseServiceRoleKey?: string;
  supabaseUrl?: string;
  supabaseInternalUrl?: string;
  supabaseJwtIssuer?: string;
  version: string;
  volcesApiKey?: string;
  volcesBaseUrl?: string;
  lemonSqueezyApiKey?: string;
  lemonSqueezyStoreId?: string;
  lemonSqueezyWebhookSecret?: string;
  lemonSqueezyVariantStarterMonthly?: string;
  lemonSqueezyVariantStarterYearly?: string;
  lemonSqueezyVariantProMonthly?: string;
  lemonSqueezyVariantProYearly?: string;
  lemonSqueezyVariantUltraMonthly?: string;
  lemonSqueezyVariantUltraYearly?: string;
  lemonSqueezyVariantBusinessMonthly?: string;
  lemonSqueezyVariantBusinessYearly?: string;
  skillsRoot?: string;
  webOrigin: string;
  workerConcurrency?: number;
  workerImageConcurrency?: number;
  workerVideoConcurrency?: number;
  workerId?: string;
  workerPollIntervalMs?: number;
  workerMaxBatchSize?: number;
  /** Worker settles 待核对 image jobs from the xy2api usage list (default on). */
  xy2apiBillingReconcile?: boolean;
  /**
   * XY2API_ASYNC_IMAGES=on sends OpenAI and Grok image calls as main-site
   * async tasks (submit, poll; features/xy2api/image-task.ts). Off by
   * default. A main site without them answers 404 and the call goes
   * synchronously, so "on" is safe against any xy2api version.
   */
  xy2apiAsyncImages?: "on" | "off";
  /** XY2API_ASYNC_IMAGE_USERS: when set, only these user ids (canary). */
  xy2apiAsyncImageUsers?: string[];
  /**
   * Worker deletes canvas image objects no canvas references (default "on";
   * "dry-run" only logs them). features/canvas/canvas-files-sweeper.ts
   */
  canvasFilesSweep?: "on" | "dry-run" | "off";
  /**
   * LOOMIC_MEDIA_ACCESS: "cookie" makes project-assets public URLs readable
   * only by members of the workspace in the path, via a signed HttpOnly
   * cookie checked by the edge (forward_auth / auth_request) and by
   * /api/proxy-image. "open" (default, local dev) keeps them public.
   * features/media/media-access.ts, FINDINGS S2.
   */
  mediaAccess?: "cookie" | "open";
  /**
   * PROJECT_PURGE: deletes projects 24 h after the user deleted them, with
   * their uploads ("dry-run" only logs). features/projects/project-purge.ts
   */
  projectPurge?: "on" | "dry-run" | "off";
  /**
   * WORKS_PURGE: removes the pictures of 作品 deleted 24 h ago unless a
   * canvas or chat still uses them ("dry-run" only logs).
   * features/jobs/deleted-works-purge.ts, 第 58 条.
   */
  worksPurge?: "on" | "dry-run" | "off";
  /**
   * REFERENCE_SWEEP: removes uploaded references, masks and chat attachments
   * nothing uses after 3 days ("dry-run" only logs).
   * features/storage/reference-sweeper.ts, 第 59 条.
   */
  referenceSweep?: "on" | "dry-run" | "off";
  /**
   * 磁盘用量告警 (第 59 条, features/ops/disk-monitor.ts): DISK_MONITOR
   * on|off, DISK_MONITOR_PATH (statfs, "/"), DISK_ALERT_WARN_PERCENT (80),
   * DISK_ALERT_CRITICAL_PERCENT (90), OPS_ALERT_WEBHOOK_URL (JSON POST on
   * open / escalate / resolve; unset = page and banner only).
   */
  diskMonitor?: "on" | "off";
  diskMonitorPath?: string;
  diskAlertWarnPercent?: number;
  diskAlertCriticalPercent?: number;
  opsAlertWebhookUrl?: string | undefined;
  /** LOOMIC_OBJECT_STORAGE: local (files on this disk) or s3 (R2 / S3). Shown on the 管理 page. */
  objectStorage?: "local" | "s3";
};

export function loadServerEnv(
  overrides: Partial<ServerEnv> = {},
  source: NodeJS.ProcessEnv = process.env,
): ServerEnv {
  function required(
    name: string,
    value: string | undefined,
    schema: z.ZodType<string> = z.string().min(1),
  ): string {
    const parsed = schema.safeParse(value?.trim());
    if (!parsed.success) throw new Error(`Missing or invalid ${name}`);
    return parsed.data;
  }
  function integer(
    name: string,
    fallback: number,
    max = 100000,
    min = 1,
  ): number {
    const parsed = z.coerce
      .number()
      .int()
      .min(min)
      .max(max)
      .safeParse(source[name] ?? fallback);
    if (!parsed.success) throw new Error(`Invalid ${name}`);
    return parsed.data;
  }
  const xy2apiBaseUrl = required(
    "XY2API_BASE_URL",
    overrides.xy2apiBaseUrl ?? source.XY2API_BASE_URL,
    z
      .url()
      .refine(
        (value) =>
          /^https?:\/\//.test(value) &&
          !new URL(value).username &&
          !new URL(value).password,
      ),
  ).replace(/\/$/, "");
  const secretKey = required(
    "LOOMIC_SECRET_KEY",
    overrides.secretKey ?? source.LOOMIC_SECRET_KEY,
    z
      .string()
      .regex(/^[A-Za-z0-9+/]{43}=$/)
      .refine((value) => Buffer.from(value, "base64").length === 32),
  );
  const ssoEmailDomain = required(
    "SSO_EMAIL_DOMAIN",
    overrides.ssoEmailDomain ?? source.SSO_EMAIL_DOMAIN,
    z
      .string()
      .regex(/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/),
  );
  const outputFormat = z
    .enum(["jpeg", "png", "webp"])
    .safeParse(
      overrides.imageOutputFormat ??
        source.LOOMIC_IMAGE_OUTPUT_FORMAT ??
        "jpeg",
    );
  if (!outputFormat.success)
    throw new Error("Invalid LOOMIC_IMAGE_OUTPUT_FORMAT");
  const mode = z
    .enum(["state", "filesystem"])
    .safeParse(
      overrides.agentBackendMode ?? source.LOOMIC_AGENT_BACKEND_MODE ?? "state",
    );
  if (!mode.success || mode.data !== "state")
    throw new Error("Invalid LOOMIC_AGENT_BACKEND_MODE");
  const optionalStrings = {
    agentFilesRoot: source.LOOMIC_AGENT_FILES_ROOT,
    googleFontsApiKey: source.GOOGLE_FONTS_API_KEY,
    supabaseUrl: source.SUPABASE_URL,
    supabaseInternalUrl: source.SUPABASE_INTERNAL_URL,
    supabaseJwtIssuer: source.SUPABASE_JWT_ISSUER,
    supabaseAnonKey: source.SUPABASE_ANON_KEY,
    supabaseDbUrl: source.SUPABASE_DB_URL,
    supabaseJwtSecret: source.SUPABASE_JWT_SECRET,
    supabaseServiceRoleKey: source.SUPABASE_SERVICE_ROLE_KEY,
    supabaseProjectId: source.SUPABASE_PROJECT_ID,
    skillsRoot: source.LOOMIC_SKILLS_ROOT,
    workerId: source.WORKER_ID,
    imageModelsJson: source.LOOMIC_IMAGE_MODELS,
    egressIp: source.LOOMIC_EGRESS_IP,
  };
  return {
    ...Object.fromEntries(
      Object.entries(optionalStrings).filter(([, value]) =>
        Boolean(value?.trim()),
      ),
    ),
    agentBackendMode: mode.data,
    agentModel: source.LOOMIC_AGENT_MODEL?.trim() || DEFAULT_AGENT_MODEL,
    port: integer(
      "LOOMIC_SERVER_PORT",
      Number(source.PORT) || DEFAULT_SERVER_PORT,
      65535,
    ),
    version: (
      JSON.parse(
        readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
      ) as { version: string }
    ).version,
    webOrigin: source.LOOMIC_WEB_ORIGIN || DEFAULT_WEB_ORIGIN,
    xy2apiBaseUrl,
    xy2apiWebUrl: required(
      "XY2API_WEB_URL",
      overrides.xy2apiWebUrl ?? source.XY2API_WEB_URL ?? xy2apiBaseUrl,
      z.url(),
    ).replace(/\/$/, ""),
    secretKey,
    ssoEmailDomain,
    chatModels: (source.LOOMIC_CHAT_MODELS || DEFAULT_CHAT_MODELS)
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    // Per-user image limits; 0 = no limit (第 57 条: the default since the
    // user lifted them; main-site concurrency is not this site's concern).
    // A self-hosted site can still set them.
    maxConcurrentJobs: integer("LOOMIC_MAX_CONCURRENT_JOBS", 0, 100000, 0),
    maxPendingImageJobs: integer("LOOMIC_MAX_PENDING_IMAGE_JOBS", 0, 100000, 0),
    maxImagesPerRun: integer("LOOMIC_MAX_IMAGES_PER_RUN", 6),
    sessionRevalidateMinutes: integer(
      "LOOMIC_SESSION_REVALIDATE_MINUTES",
      30,
      30,
    ),
    imageOutputFormat: outputFormat.data,
    imageOutputCompression: integer(
      "LOOMIC_IMAGE_OUTPUT_COMPRESSION",
      90,
      100,
      0,
    ),
    trustProxy: source.LOOMIC_TRUST_PROXY === "true",
    embedLoginEnabled: false,
    chatProviderAllowHttp:
      source.NODE_ENV !== "production" &&
      source.LOOMIC_CHAT_PROVIDER_ALLOW_HTTP === "true",
    chatProviderAllowedHosts: (source.LOOMIC_CHAT_PROVIDER_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
    workerConcurrency: integer("WORKER_CONCURRENCY", 3),
    // Image jobs one worker handles at once, all users together. Most of a
    // job's time is waiting on the main site (an async task or a long
    // response), so this is set high (第 57 条); memory is used only while a
    // finished picture is downloaded and stored.
    workerImageConcurrency: integer("WORKER_IMAGE_CONCURRENCY", 32),
    workerPollIntervalMs: integer("WORKER_POLL_INTERVAL_MS", 2000),
    workerMaxBatchSize: integer("WORKER_MAX_BATCH_SIZE", 10),
    xy2apiBillingReconcile: source.XY2API_BILLING_RECONCILE !== "false",
    xy2apiAsyncImages: source.XY2API_ASYNC_IMAGES === "on" ? "on" : "off",
    xy2apiAsyncImageUsers: (source.XY2API_ASYNC_IMAGE_USERS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    canvasFilesSweep:
      source.CANVAS_FILES_SWEEP === "off" ||
      source.CANVAS_FILES_SWEEP === "dry-run"
        ? source.CANVAS_FILES_SWEEP
        : "on",
    mediaAccess: source.LOOMIC_MEDIA_ACCESS === "cookie" ? "cookie" : "open",
    projectPurge:
      source.PROJECT_PURGE === "off" || source.PROJECT_PURGE === "dry-run"
        ? source.PROJECT_PURGE
        : "on",
    worksPurge:
      source.WORKS_PURGE === "off" || source.WORKS_PURGE === "dry-run"
        ? source.WORKS_PURGE
        : "on",
    referenceSweep:
      source.REFERENCE_SWEEP === "off" || source.REFERENCE_SWEEP === "dry-run"
        ? source.REFERENCE_SWEEP
        : "on",
    diskMonitor: source.DISK_MONITOR === "off" ? "off" : "on",
    diskMonitorPath: source.DISK_MONITOR_PATH || "/",
    diskAlertWarnPercent: percentSetting(source.DISK_ALERT_WARN_PERCENT, 80),
    diskAlertCriticalPercent: percentSetting(source.DISK_ALERT_CRITICAL_PERCENT, 90),
    opsAlertWebhookUrl: source.OPS_ALERT_WEBHOOK_URL || undefined,
    objectStorage: source.LOOMIC_OBJECT_STORAGE === "s3" ? "s3" : "local",
    ...overrides,
  };
}

/** A percentage setting between 1 and 99, else the default. */
function percentSetting(raw: string | undefined, fallback: number) {
  const value = Number(raw);
  return Number.isFinite(value) && value >= 1 && value <= 99 ? value : fallback;
}

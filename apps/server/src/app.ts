import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { createLinkedAuthenticator } from "./features/xy2api/linked-authenticator.js";
import { createXy2apiServices } from "./features/xy2api/services.js";
import { registerAccountRoutes } from "./http/account.js";
import { registerXy2apiAuthRoutes } from "./http/auth-xy2api.js";
import { registerChatProviderRoutes } from "./http/chat-providers.js";
import { createReadinessProbe } from "./supabase/readiness.js";

import type { LoomicAgentFactory } from "./agent/deep-agent.js";
import {
  type AgentPersistenceService,
  createAgentPersistenceService,
} from "./agent/persistence/index.js";
import { createAgentRunService } from "./agent/runtime.js";
import {
  type ServerEnv,
  loadServerEnv,
  resolveDefaultAgentModel,
} from "./config/env.js";
import {
  type AgentRunMetadataService,
  createAgentRunMetadataService,
} from "./features/agent-runs/agent-run-service.js";
import {
  type ViewerService,
  createViewerService,
} from "./features/bootstrap/ensure-user-foundation.js";
import {
  type BrandKitService,
  createBrandKitService,
} from "./features/brand-kit/brand-kit-service.js";
import {
  type CanvasService,
  createCanvasService,
} from "./features/canvas/canvas-service.js";
import {
  type ChatService,
  createChatService,
} from "./features/chat/chat-service.js";
import {
  type ThreadService,
  createThreadService,
} from "./features/chat/thread-service.js";
import {
  type JobService,
  createJobService,
} from "./features/jobs/job-service.js";
import {
  type ProjectService,
  createProjectService,
} from "./features/projects/project-service.js";
import {
  type SettingsService,
  createSettingsService,
} from "./features/settings/settings-service.js";
import {
  type UploadService,
  createUploadService,
} from "./features/uploads/upload-service.js";
import { createPendingDeliveryStore } from "./features/xy2api/pending-delivery.js";
import { registerAllProviders } from "./generation/providers/register-all.js";
import { registerBrandKitRoutes } from "./http/brand-kits.js";
import { registerCanvasRoutes } from "./http/canvases.js";
import { registerChatRoutes } from "./http/chat.js";
import { registerFontsRoutes } from "./http/fonts.js";
import { registerGenerateRoutes } from "./http/generate.js";
import { registerHealthRoutes } from "./http/health.js";
import { registerImageModelRoutes } from "./http/image-models.js";
import { registerImageProxyRoute } from "./http/image-proxy.js";
import { registerJobRoutes } from "./http/jobs.js";
import { registerModelRoutes } from "./http/models.js";
import { registerProjectRoutes } from "./http/projects.js";
import { registerRunRoutes } from "./http/runs.js";
import { registerSettingsRoutes } from "./http/settings.js";
import { registerMarketplaceRoutes } from "./http/skills-marketplace.js";
import { registerSkillRoutes } from "./http/skills.js";
import { registerUploadRoutes } from "./http/uploads.js";
import { registerViewerRoutes } from "./http/viewer.js";
import { registerTaskDrain } from "./lifecycle/drain-tasks.js";
import { createPgmqClient } from "./queue/pgmq-client.js";
import { createAdminSupabaseClient } from "./supabase/admin.js";
import {
  type RequestAuthenticator,
  createSupabaseRequestAuthenticator,
  createUserSupabaseClientFactory,
} from "./supabase/user.js";
import { ConnectionManager } from "./ws/connection-manager.js";
import { CanvasEventBuffer } from "./ws/event-buffer.js";
import { registerWsRoute } from "./ws/handler.js";

export type BuildAppOptions = {
  agentFactory?: LoomicAgentFactory;
  agentModel?: BaseLanguageModel | string;
  agentPersistenceService?: AgentPersistenceService;
  agentRunMetadataService?: AgentRunMetadataService;
  auth?: RequestAuthenticator;
  brandKitService?: BrandKitService;
  canvasService?: CanvasService;
  chatService?: ChatService;
  connectionManager?: ConnectionManager;
  env?: Partial<ServerEnv>;
  jobService?: JobService;
  uploadService?: UploadService;
  mockEventDelayMs?: number;
  projectService?: ProjectService;
  settingsService?: SettingsService;
  threadService?: ThreadService;
  viewerService?: ViewerService;
};

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const env = loadServerEnv(options.env);

  // Register generation providers (shared with worker.ts)
  registerAllProviders(env);

  const app = Fastify({
    logger: {
      level: "info",
      redact: ["req.headers.authorization", "req.headers.cookie"],
      serializers: {
        req: (request) => ({
          method: request.method,
          url: request.url.split("?", 1)[0] ?? "",
        }),
      },
    },
    trustProxy: env.trustProxy,
    bodyLimit: 20 * 1024 * 1024,
    // Keep answering until the server stops listening. Fastify's closing 503
    // skips @fastify/websocket's hooks: a browser that reconnected while the
    // server closed kept a socket the 503 never closed, and server.close()
    // waited for it for minutes. New agent runs are refused while a restart
    // drains (lifecycle/drain-tasks) and /api/ready reports not ready.
    return503OnClosing: false,
  });
  app.setErrorHandler((error, request, reply) => {
    const statusCode =
      error && typeof error === "object" && "statusCode" in error
        ? error.statusCode
        : undefined;
    const status =
      typeof statusCode === "number" && statusCode >= 400 && statusCode < 500
        ? statusCode
        : 500;
    request.log.error({ code: "request_failed", status }, "Request failed");
    return reply.code(status).send({
      error: {
        code: "application_error",
        message: status < 500 ? "请求参数无效" : "服务暂时不可用，请稍后再试",
      },
    });
  });
  const taskDrain = registerTaskDrain(app);
  void app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024 },
  });
  void app.register(async (instance) => {
    await instance.register(websocket);
    await registerWsRoute(instance, {
      agentRuns,
      taskDrain,
      agentRunMetadataService,
      auth,
      chatService,
      connectionManager,
      createUserClient,
      eventBuffer,
      settingsService,
      threadService,
      viewerService,
    });
  });
  const createUserClient = createUserSupabaseClientFactory(env);
  let adminClient: ReturnType<typeof createAdminSupabaseClient> | undefined;
  const getAdminClient = () => {
    adminClient ??= createAdminSupabaseClient(env);
    return adminClient;
  };
  const xy2api = createXy2apiServices(env, getAdminClient);
  const auth =
    options.auth ??
    createLinkedAuthenticator(
      createSupabaseRequestAuthenticator(env),
      xy2api.accounts,
      env.sessionRevalidateMinutes,
    );
  const viewerService =
    options.viewerService ?? createViewerService({ getAdminClient });
  const projectService =
    options.projectService ??
    createProjectService({ createUserClient, viewerService });
  const brandKitService =
    options.brandKitService ?? createBrandKitService({ createUserClient });
  const canvasService =
    options.canvasService ?? createCanvasService({ createUserClient });
  const threadService =
    options.threadService ?? createThreadService({ createUserClient });
  const chatService =
    options.chatService ??
    createChatService({ createUserClient, threadService });
  const agentRunMetadataService =
    options.agentRunMetadataService ??
    createAgentRunMetadataService({ getAdminClient });
  const agentPersistenceService =
    options.agentPersistenceService ?? createAgentPersistenceService(env);
  const settingsService =
    options.settingsService ??
    createSettingsService({
      createUserClient,
      defaultModel: resolveDefaultAgentModel(env),
    });
  const uploadService =
    options.uploadService ?? createUploadService({ createUserClient });
  const pgmq = env.supabaseDbUrl
    ? createPgmqClient(env.supabaseDbUrl)
    : undefined;
  const deliveries = env.supabaseDbUrl
    ? createPendingDeliveryStore(env.supabaseDbUrl)
    : undefined;
  const jobService =
    options.jobService ??
    (pgmq
      ? createJobService({ createUserClient, getAdminClient, pgmq })
      : undefined);
  const connectionManager =
    options.connectionManager ?? new ConnectionManager();
  const eventBuffer = new CanvasEventBuffer();
  const cleanupTimer = setInterval(() => eventBuffer.cleanup(), 5 * 60 * 1000);
  // Logs the main site's xy2api release and whether it is a verified version.
  if (!process.env.VITEST) xy2api.compat.start();
  app.addHook("onClose", async () => {
    clearInterval(cleanupTimer);
    xy2api.compat.stop();
    await pgmq?.shutdown();
    await deliveries?.close();
    await xy2api.providers.network.close();
  });
  const agentRuns = createAgentRunService({
    agentPersistenceService,
    ...(options.agentFactory ? { agentFactory: options.agentFactory } : {}),
    agentRunMetadataService,
    connectionManager,
    createUserClient,
    ...(options.agentModel ? { model: options.agentModel } : {}),
    ...(options.mockEventDelayMs === undefined
      ? {}
      : { eventDelayMs: options.mockEventDelayMs }),
    env,
    ...(jobService ? { jobService } : {}),
    xy2api,
    viewerService,
  });

  app.addHook("onRequest", async (request, reply) => {
    const corsResult = evaluateCors(request, env.webOrigin);

    if (!corsResult.allowed) {
      return reply.code(403).send({
        message: "Origin not allowed",
      });
    }

    if (corsResult.allowOrigin) {
      reply.header("access-control-allow-origin", corsResult.allowOrigin);
      reply.header("access-control-expose-headers", "Retry-After");
      reply.header("vary", "Origin");
    }

    if (corsResult.isBrowserRequest) {
      reply.header(
        "access-control-allow-methods",
        "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      );
      reply.header(
        "access-control-allow-headers",
        resolveAllowedHeaders(
          request.headers["access-control-request-headers"],
        ),
      );
    }

    if (corsResult.isPreflight) {
      return reply.code(204).send();
    }
  });

  const readiness = createReadinessProbe(env);
  app.addHook("onClose", async () => readiness.close());
  void registerHealthRoutes(app, env, () =>
    taskDrain.isDraining()
      ? Promise.resolve({ ok: false, checks: { accepting: false } })
      : readiness.check(),
  );
  void registerFontsRoutes(app, { env });
  void registerImageProxyRoute(app, { env });
  void registerRunRoutes(app, agentRuns, {
    agentRunMetadataService,
    auth,
    isDraining: taskDrain.isDraining,
    settingsService,
    threadService,
    viewerService,
  });
  void registerViewerRoutes(app, {
    auth,
    createUserClient,
    viewerService,
  });
  void registerBrandKitRoutes(app, {
    auth,
    brandKitService,
  });
  void registerProjectRoutes(app, {
    auth,
    projectService,
  });
  void registerCanvasRoutes(app, {
    auth,
    canvasService,
  });
  void registerSettingsRoutes(app, {
    auth,
    settingsService,
    viewerService,
  });
  void registerXy2apiAuthRoutes(app, { ...xy2api, env, auth });
  void registerAccountRoutes(app, { ...xy2api, env, auth });
  void registerChatProviderRoutes(app, { auth, providers: xy2api.providers });
  void registerModelRoutes(app, {
    auth,
    keys: xy2api.keys,
    providers: xy2api.providers,
  });
  void registerImageModelRoutes(app, { auth, keys: xy2api.keys });
  void registerChatRoutes(app, {
    auth,
    chatService,
  });
  void registerUploadRoutes(app, {
    auth,
    uploadService,
    viewerService,
  });
  void registerGenerateRoutes(app, {
    auth,
    viewerService,
    ...(jobService ? { jobService } : {}),
    ...(deliveries ? { deliveries } : {}),
    xy2api,
    env,
    getAdminClient,
  });
  if (jobService) {
    void registerJobRoutes(app, {
      auth,
      billing: xy2api.billing,
      jobService,
      viewerService,
    });
  }
  void registerSkillRoutes(app, { auth, createUserClient, viewerService });
  void registerMarketplaceRoutes(app, {
    auth,
    createUserClient,
    viewerService,
  });

  return app;
}

type CorsResult = {
  allowed: boolean;
  allowOrigin: string | null;
  isBrowserRequest: boolean;
  isPreflight: boolean;
};

function evaluateCors(request: FastifyRequest, webOrigin: string): CorsResult {
  const origin = request.headers.origin;
  const isPreflight =
    request.method === "OPTIONS" &&
    typeof request.headers["access-control-request-method"] === "string";

  if (!origin) {
    return {
      allowed: true,
      allowOrigin: null,
      isBrowserRequest: false,
      isPreflight,
    };
  }

  if (origin === webOrigin) {
    return {
      allowed: true,
      allowOrigin: origin,
      isBrowserRequest: true,
      isPreflight,
    };
  }

  if (origin === "null" && isLoopbackHost(request.headers.host)) {
    return {
      allowed: true,
      allowOrigin: origin,
      isBrowserRequest: true,
      isPreflight,
    };
  }

  return {
    allowed: false,
    allowOrigin: null,
    isBrowserRequest: true,
    isPreflight,
  };
}

function resolveAllowedHeaders(requestHeaders: string | undefined) {
  return requestHeaders?.trim() || "Content-Type";
}

function isLoopbackHost(host: string | undefined) {
  if (!host) {
    return false;
  }

  if (host.startsWith("[")) {
    return host.startsWith("[::1]");
  }

  const [hostname] = host.split(":");
  return (
    hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1"
  );
}

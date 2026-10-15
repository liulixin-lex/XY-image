import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  CHAT_CONTEXT_WINDOW,
  applicationErrorResponseSchema,
  runCancelResponseSchema,
  runCreateRequestSchema,
  runCreateResponseSchema,
  unauthenticatedErrorResponseSchema,
} from "@loomic/shared";

import {
  type AgentRunService,
  ContextBusyError,
  ContextUnavailableError,
} from "../agent/runtime.js";
import { findChatProviderError } from "../features/chat-providers/errors.js";
import { BillingGuardError } from "../features/xy2api/errors.js";
import { describeErrorForLog } from "../utils/error-sanitizer.js";
import {
  type AgentRunMetadataService,
  AgentRunPersistenceError,
} from "../features/agent-runs/agent-run-service.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import {
  type ThreadService,
  ThreadServiceError,
} from "../features/chat/thread-service.js";
import type { SettingsService } from "../features/settings/settings-service.js";
import type { RequestAuthenticator } from "../supabase/user.js";

export async function registerRunRoutes(
  app: FastifyInstance,
  agentRuns: AgentRunService,
  options: {
    agentRunMetadataService?: AgentRunMetadataService;
    auth?: RequestAuthenticator;
    /** A restart is draining runs (lifecycle/drain-tasks); refuse new ones. */
    isDraining?: () => boolean;
    settingsService?: SettingsService;
    threadService?: ThreadService;
    viewerService?: ViewerService;
  } = {},
) {
  app.post("/api/agent/runs", async (request, reply) => {
    if (options.isDraining?.())
      return reply
        .code(503)
        .header("Retry-After", "30")
        .send(
          applicationErrorResponseSchema.parse({
            error: {
              code: "application_error",
              message: "服务正在维护，请稍后再试",
            },
          }),
        );
    try {
      const hasAuthorization = hasBearerAuthorization(
        request.headers.authorization,
      );
      const authenticatedUser =
        hasAuthorization && options?.auth
          ? await options.auth.authenticate(request)
          : null;

      if (!authenticatedUser) {
        return sendUnauthorized(reply);
      }

      const payload = runCreateRequestSchema.parse(request.body);
      const sessionThread =
        authenticatedUser && options?.threadService
          ? await options.threadService.resolveOwnedSessionThread(
              authenticatedUser,
              payload.sessionId,
            )
          : null;

      // Account preferences are resolved at execution time; never forward the stale workspace default.
      const model = payload.model;

      const response = runCreateResponseSchema.parse(
        agentRuns.createRun(payload, {
          ...(authenticatedUser
            ? {
                accessToken: authenticatedUser.accessToken,
                userId: authenticatedUser.id,
              }
            : {}),
          ...(model ? { model } : {}),
          ...(sessionThread ? { threadId: sessionThread.threadId } : {}),
        }),
      );

      if (sessionThread && options.agentRunMetadataService) {
        await options.agentRunMetadataService.createAcceptedRun({
          ...(model ? { model } : {}),
          runId: response.runId,
          sessionId: payload.sessionId,
          threadId: sessionThread.threadId,
        });
      }

      return reply.code(202).send(response);
    } catch (error) {
      if (error instanceof ThreadServiceError) {
        return reply.code(error.statusCode).send(
          applicationErrorResponseSchema.parse({
            error: {
              code: error.code,
              message: error.message,
            },
          }),
        );
      }

      if (error instanceof AgentRunPersistenceError) {
        return reply.code(error.statusCode).send(
          applicationErrorResponseSchema.parse({
            error: {
              code: error.code,
              message: error.message,
            },
          }),
        );
      }

      return handleZodError(error, reply);
    }
  });

  app.post("/api/agent/runs/:runId/cancel", async (request, reply) => {
    const user = await options.auth?.authenticate(request);
    if (!user) return sendUnauthorized(reply);
    const { runId } = request.params as { runId: string };
    const canceledRun = agentRuns.cancelRun(runId, user.id);

    if (!canceledRun) {
      return reply.code(404).send({
        message: `Run not found: ${runId}`,
      });
    }

    const response = runCancelResponseSchema.parse(canceledRun);
    return reply.code(202).send(response);
  });

  // 第 70 条 上下文: the chat panel's meter, and its 压缩 button.
  const sessionThread = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const user = await options.auth?.authenticate(request);
    if (!user) {
      sendUnauthorized(reply);
      return null;
    }
    if (!options.threadService) {
      reply.code(503).send(contextError("对话记录暂时读不到"));
      return null;
    }
    const { sessionId } = request.params as { sessionId: string };
    const binding = await options.threadService.resolveOwnedSessionThread(
      user,
      sessionId,
    );
    return { user, binding };
  };

  app.get("/api/agent/sessions/:sessionId/context", async (request, reply) => {
    try {
      const found = await sessionThread(request, reply);
      if (!found) return reply;
      reply.header("Cache-Control", "no-store");
      return await agentRuns.sessionContext({
        threadId: found.binding.threadId,
      });
    } catch (error) {
      return sendContextError(reply, error);
    }
  });

  app.post(
    "/api/agent/sessions/:sessionId/compact",
    async (request, reply) => {
      try {
        const found = await sessionThread(request, reply);
        if (!found) return reply;
        const result = await agentRuns.compactSession({
          userId: found.user.id,
          threadId: found.binding.threadId,
          ...(found.binding.canvasId
            ? { canvasId: found.binding.canvasId }
            : {}),
        });
        return result;
      } catch (error) {
        return sendContextError(reply, error);
      }
    },
  );
}

function contextError(message: string, code = "application_error") {
  return applicationErrorResponseSchema.parse({ error: { code, message } });
}

function sendContextError(reply: FastifyReply, error: unknown) {
  if (error instanceof ThreadServiceError)
    // A session without a thread has nothing to compact yet.
    return error.statusCode === 409
      ? reply.send({ usedTokens: 0, windowTokens: CHAT_CONTEXT_WINDOW, compacted: false })
      : reply.code(error.statusCode).send(contextError(error.message, error.code));
  if (error instanceof ContextBusyError || error instanceof ContextUnavailableError)
    return reply.code(error.statusCode).send(contextError(error.message));
  if (error instanceof BillingGuardError || findChatProviderError(error)) {
    console.warn(`[context] compaction refused: ${describeErrorForLog(error)}`);
    return reply.code(409).send(contextError("现在用不了对话模型，没能压缩"));
  }
  console.error(`[context] request failed: ${describeErrorForLog(error)}`);
  return reply.code(500).send(contextError("压缩没有完成，稍后再试"));
}

function hasBearerAuthorization(
  authorizationHeader: string | string[] | undefined,
) {
  return typeof authorizationHeader === "string"
    ? authorizationHeader.trim().toLowerCase().startsWith("bearer ")
    : false;
}

function sendUnauthorized(reply: FastifyReply) {
  return reply.code(401).send(
    unauthenticatedErrorResponseSchema.parse({
      error: {
        code: "unauthorized",
        message: "Missing or invalid bearer token.",
      },
    }),
  );
}

function handleZodError(error: unknown, reply: FastifyReply) {
  if (isZodError(error)) {
    return reply.code(400).send({
      issues: error.issues,
      message: "Invalid request body",
    });
  }

  throw error;
}

function isZodError(
  error: unknown,
): error is { issues: unknown[]; name: string } {
  return (
    error instanceof Error &&
    error.name === "ZodError" &&
    "issues" in error &&
    Array.isArray(error.issues)
  );
}

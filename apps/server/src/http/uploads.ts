import type { FastifyInstance, FastifyReply } from "fastify";

import {
  type ApplicationErrorCode,
  UPLOAD_MAX_BYTES,
  applicationErrorResponseSchema,
  assetSignedUrlResponseSchema,
  unauthenticatedErrorResponseSchema,
  uploadResponseSchema,
} from "@loomic/shared";

import {
  UploadServiceError,
  type UploadService,
} from "../features/uploads/upload-service.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import type { RequestAuthenticator } from "../supabase/user.js";
import { logRouteError } from "./log-route-error.js";

const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
]);

export async function registerUploadRoutes(
  app: FastifyInstance,
  options: {
    auth: RequestAuthenticator;
    uploadService: UploadService;
    viewerService: ViewerService;
  },
) {
  // Upload a file: 参考图 (studio, home, chat), 局部重绘 masks, canvas
  // pictures a generator needs a URL for.
  app.post("/api/uploads", async (request, reply) => {
    const requestBytes = Number(request.headers["content-length"] ?? 0);
    const startedAt = Date.now();
    try {
      const user = await options.auth.authenticate(request);
      if (!user) return sendUnauthorized(reply);

      const file = await request.file();
      if (!file) {
        return reply.code(400).send(
          applicationErrorResponseSchema.parse({
            error: {
              code: "upload_failed",
              message: "没有收到图片",
            },
          }),
        );
      }

      const mimeType = file.mimetype;
      if (!ALLOWED_MIME_TYPES.has(mimeType)) {
        // Drain the part so the connection is left in a usable state.
        file.file.resume();
        request.log.warn({ mimeType, requestBytes }, "upload refused: type");
        return reply.code(400).send(
          applicationErrorResponseSchema.parse({
            error: {
              code: "upload_failed",
              message: "只支持 PNG、JPEG、WebP 格式的图片",
            },
          }),
        );
      }

      // Throws FST_REQ_FILE_TOO_LARGE past UPLOAD_MAX_BYTES (app.ts).
      const fileBuffer = await file.toBuffer();
      // Until here the time is the user's network; after it, storage's.
      const receivedAt = Date.now();

      // Resolve workspace from viewer
      const viewer = await options.viewerService.ensureViewer(user);
      const workspaceId = viewer.workspace.id;

      // Extract projectId from fields if provided
      const projectId = fieldValue(file.fields, "projectId");

      const result = await options.uploadService.uploadFile(user, {
        bucket: "project-assets",
        fileName: file.filename,
        fileBuffer,
        mimeType,
        workspaceId,
        ...(projectId ? { projectId } : {}),
      });

      request.log.info(
        {
          bytes: fileBuffer.length,
          mimeType,
          inProject: Boolean(projectId),
          assetId: result.asset.id,
          // Network vs storage: a slow upload with a fast store is the
          // user's connection (image.gguuai.com: 50–300 KB/s for some).
          receiveMs: receivedAt - startedAt,
          storeMs: Date.now() - receivedAt,
          ...clientUploadInfo(file.fields),
        },
        "upload OK",
      );
      return reply
        .code(201)
        .send(uploadResponseSchema.parse(result));
    } catch (error) {
      logRouteError(
        request,
        error,
        { requestBytes, elapsedMs: Date.now() - startedAt },
        "upload FAILED",
      );
      return sendUploadError(error, reply);
    }
  });

  // Get signed URL for an asset
  app.get<{ Params: { assetId: string } }>(
    "/api/uploads/:assetId/url",
    async (request, reply) => {
      try {
        const user = await options.auth.authenticate(request);
        if (!user) return sendUnauthorized(reply);

        const url = await options.uploadService.getAssetUrl(
          user,
          request.params.assetId,
        );

        return reply
          .code(200)
          .send(assetSignedUrlResponseSchema.parse({ url }));
      } catch (error) {
        return sendUploadError(error, reply);
      }
    },
  );

  // Delete an asset
  app.delete<{ Params: { assetId: string } }>(
    "/api/uploads/:assetId",
    async (request, reply) => {
      try {
        const user = await options.auth.authenticate(request);
        if (!user) return sendUnauthorized(reply);

        await options.uploadService.deleteAsset(
          user,
          request.params.assetId,
        );

        return reply.code(200).send({ ok: true });
      } catch (error) {
        return sendUploadError(error, reply);
      }
    },
  );
}

type MultipartFields = Record<string, unknown>;

/** A plain form field sent before the file part, or undefined. */
function fieldValue(fields: MultipartFields, name: string): string | undefined {
  const field = fields[name];
  return typeof field === "object" &&
    field !== null &&
    "value" in field &&
    (field as { value?: unknown }).value != null
    ? String((field as { value: unknown }).value)
    : undefined;
}

/**
 * What the browser says it did before uploading (web lib/server-api.ts
 * uploadFileWithProgress): the picture's size before it was shrunk and how
 * long shrinking took. For the log only; nothing depends on it.
 */
function clientUploadInfo(fields: MultipartFields): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [field, key] of [
    ["clientOriginalBytes", "originalBytes"],
    ["clientPrepMs", "prepMs"],
  ] as const) {
    const value = Number(fieldValue(fields, field));
    if (Number.isFinite(value) && value >= 0) out[key] = Math.round(value);
  }
  return out;
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

const UPLOAD_MAX_MB = Math.floor(UPLOAD_MAX_BYTES / (1024 * 1024));

/**
 * @fastify/multipart's own errors (code FST_*) as the client should see
 * them. Through 0.0.16 they all became a 500 "Internal server error.": a
 * picture over the limit read as a server fault the user could retry, and
 * did, over and over (image.gguuai.com, 2026-10-16/17).
 */
function multipartFailure(
  error: unknown,
): { status: number; code: ApplicationErrorCode; message: string } | null {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
  switch (code) {
    case "FST_REQ_FILE_TOO_LARGE":
      return {
        status: 413,
        code: "file_too_large",
        message: `图片超过 ${UPLOAD_MAX_MB} MB，换一张小一点的`,
      };
    case "FST_PARTS_LIMIT":
    case "FST_FILES_LIMIT":
    case "FST_FIELDS_LIMIT":
      return {
        status: 413,
        code: "upload_failed",
        message: "一次只能上传一张图片",
      };
    case "FST_INVALID_MULTIPART_CONTENT_TYPE":
    case "FST_PROTO_VIOLATION":
    case "FST_INVALID_JSON_FIELD_ERROR":
      return { status: 400, code: "upload_failed", message: "上传请求无效" };
    default:
      return null;
  }
}

function sendUploadError(error: unknown, reply: FastifyReply) {
  const multipart = multipartFailure(error);
  if (multipart) {
    return reply.code(multipart.status).send(
      applicationErrorResponseSchema.parse({
        error: { code: multipart.code, message: multipart.message },
      }),
    );
  }
  if (error instanceof UploadServiceError) {
    return reply.code(error.statusCode).send(
      applicationErrorResponseSchema.parse({
        error: {
          code: error.code,
          message: error.message,
        },
      }),
    );
  }

  return reply.code(500).send(
    applicationErrorResponseSchema.parse({
      error: {
        code: "application_error",
        message: "Internal server error.",
      },
    }),
  );
}

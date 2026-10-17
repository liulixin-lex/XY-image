import multipart from "@fastify/multipart";
import { UPLOAD_MAX_BYTES } from "@loomic/shared";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import type { UploadService } from "../features/uploads/upload-service.js";
import { registerUploadRoutes } from "./uploads.js";

const USER = "11111111-2222-4333-8444-555555555555";
const WS = "62bcdca6-40f1-4100-ab63-14fca67032dd";
const ASSET = "9a1c5f3e-4b7d-4e2a-8c6f-0d1e2f3a4b5c";
/** The test plugin's limit: small, so "too large" needs no 19 MB body. */
const TEST_LIMIT = 1024;

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

function fixture() {
  const uploadFile = vi.fn<UploadService["uploadFile"]>(
    async (_user, input) => ({
      asset: {
        id: ASSET,
        bucket: "project-assets",
        objectPath: `${WS}/1-${input.fileName}`,
        mimeType: input.mimeType,
        byteSize: input.fileBuffer.length,
        workspaceId: WS,
        projectId: input.projectId ?? null,
        createdAt: "2026-10-17T08:00:00.000Z",
      },
      url: `https://image.example/supabase/storage/v1/object/public/project-assets/${WS}/1-${input.fileName}`,
    }),
  );
  const app = Fastify();
  void app.register(multipart, { limits: { fileSize: TEST_LIMIT, files: 1 } });
  void registerUploadRoutes(app, {
    auth: {
      authenticate: async (request) =>
        request.headers.authorization === "Bearer good"
          ? { id: USER, accessToken: "good", email: "", userMetadata: {} }
          : null,
    },
    uploadService: {
      uploadFile,
      getAssetUrl: vi.fn(),
      deleteAsset: vi.fn(),
    },
    viewerService: {
      ensureViewer: async () => ({ workspace: { id: WS } }),
    } as unknown as ViewerService,
  });
  apps.push(app);
  return { app, uploadFile };
}

function form(
  parts: Array<
    | { name: string; value: string }
    | { name: string; filename: string; type: string; bytes: number }
  >,
) {
  const boundary = "----xyUploadTestBoundary";
  const chunks: Buffer[] = [];
  for (const part of parts) {
    if ("value" in part) {
      chunks.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`,
        ),
      );
    } else {
      chunks.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\nContent-Type: ${part.type}\r\n\r\n`,
        ),
        Buffer.alloc(part.bytes, 7),
        Buffer.from("\r\n"),
      );
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    headers: {
      authorization: "Bearer good",
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
  };
}

describe("POST /api/uploads", () => {
  it("stores a picture and says where it is", async () => {
    const { app, uploadFile } = fixture();
    const res = await app.inject({
      method: "POST",
      url: "/api/uploads",
      ...form([
        { name: "file", filename: "ref.png", type: "image/png", bytes: 512 },
        { name: "projectId", value: "proj-1" },
      ]),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().asset.id).toBe(ASSET);
    expect(uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({ id: USER }),
      expect.objectContaining({
        bucket: "project-assets",
        mimeType: "image/png",
        workspaceId: WS,
        projectId: "proj-1",
      }),
    );
    expect(uploadFile.mock.calls[0]?.[1].fileBuffer.length).toBe(512);
  });

  // image.gguuai.com 2026-10-16/17: 12–19 MB pictures got a bare 500 the
  // page offered to retry, and users did, six times in a row.
  it("answers a picture over the limit with 413 file_too_large, not 500", async () => {
    const { app, uploadFile } = fixture();
    const res = await app.inject({
      method: "POST",
      url: "/api/uploads",
      ...form([
        {
          name: "file",
          filename: "big.png",
          type: "image/png",
          bytes: TEST_LIMIT + 1,
        },
      ]),
    });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toEqual({
      error: {
        code: "file_too_large",
        message: expect.stringContaining("MB"),
      },
    });
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it("refuses a type generation cannot use, with 400", async () => {
    const { app, uploadFile } = fixture();
    const res = await app.inject({
      method: "POST",
      url: "/api/uploads",
      ...form([
        { name: "file", filename: "photo.heic", type: "image/heic", bytes: 64 },
      ]),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toEqual({
      code: "upload_failed",
      message: "只支持 PNG、JPEG、WebP 格式的图片",
    });
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it("answers a request that is not multipart with 400", async () => {
    const { app } = fixture();
    const res = await app.inject({
      method: "POST",
      url: "/api/uploads",
      headers: {
        authorization: "Bearer good",
        "content-type": "application/json",
      },
      payload: JSON.stringify({ file: "x" }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("upload_failed");
  });

  it("needs a signed-in user", async () => {
    const { app, uploadFile } = fixture();
    const { payload, headers } = form([
      { name: "file", filename: "ref.png", type: "image/png", bytes: 16 },
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/api/uploads",
      payload,
      headers: { "content-type": headers["content-type"] },
    });
    expect(res.statusCode).toBe(401);
    expect(uploadFile).not.toHaveBeenCalled();
  });
});

describe("UPLOAD_MAX_BYTES", () => {
  it("stays under the proxies' 20 MB body cap with room for the multipart framing", () => {
    // Caddy `request_body max_size 20MB` is 20 000 000 bytes; nginx 20m is more.
    expect(UPLOAD_MAX_BYTES + 64 * 1024).toBeLessThan(20_000_000);
    // And above the 10 MB that refused the site's own 4K pictures.
    expect(UPLOAD_MAX_BYTES).toBeGreaterThan(15 * 1024 * 1024);
  });
});

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadImageCatalog } from "../../features/xy2api/catalog.js";
import { GatewayError } from "../../features/xy2api/errors.js";
import {
  AsyncImageUnavailableError,
  ImageTaskParkedError,
  type ImageTaskMode,
} from "../../features/xy2api/image-task.js";
import { Xy2apiOpenAIImageProvider } from "./xy2api-openai-image.js";
import { downloadImageResult } from "./xy2api-reference.js";
import { Xy2apiXaiImageProvider } from "./xy2api-xai-image.js";

// The providers' async path (features/xy2api/image-task.ts) against a small
// stand-in for xy2api's AsyncImageHandler: POST …/async answers 202 with a
// task id, GET /v1/images/tasks/:id answers `processing` once and then the
// scripted outcome.

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((close) => close()));
});

type Outcome =
  | { submit: number; body: unknown }
  | { result: unknown }
  | { failed: { http_status: number; error: unknown } };

async function asyncGateway(outcome: Outcome) {
  const requests: { method: string; path: string; type?: string; body: string }[] = [];
  let polls = 0;
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const path = req.url ?? "";
    requests.push({
      method: req.method ?? "",
      path,
      ...(req.headers["content-type"] ? { type: req.headers["content-type"] } : {}),
      body: Buffer.concat(chunks).toString("latin1"),
    });
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "Content-Type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    if (req.method === "POST" && path.endsWith("/async")) {
      if ("submit" in outcome) return send(outcome.submit, outcome.body, { "X-Client-Request-ID": "submit-refused" });
      return send(202, { id: "imgtask_fixture000001", task_id: "imgtask_fixture000001", status: "processing" }, {
        "X-Client-Request-ID": "task-request-id",
        "Retry-After": "3",
      });
    }
    if (req.method === "GET" && path === "/v1/images/tasks/imgtask_fixture000001") {
      polls++;
      if (polls === 1) return send(200, { id: "imgtask_fixture000001", status: "processing" }, { "Retry-After": "3" });
      if ("result" in outcome)
        return send(200, { id: "imgtask_fixture000001", status: "completed", http_status: 200, result: outcome.result });
      if ("failed" in outcome)
        return send(200, { id: "imgtask_fixture000001", status: "failed", ...outcome.failed });
    }
    send(500, { error: { message: `unexpected ${req.method} ${path}` } });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  return { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests };
}

const catalog = loadImageCatalog();
const openai = new Xy2apiOpenAIImageProvider(catalog, {
  imageOutputFormat: "jpeg",
  imageOutputCompression: 90,
});
const xai = new Xy2apiXaiImageProvider(catalog);
const picture = async () =>
  (await sharp({ create: { width: 6, height: 4, channels: 3, background: "blue" } }).png().toBuffer()).toString("base64");
const instant = () => Promise.resolve();
const mode = (extra: Partial<ImageTaskMode> = {}): ImageTaskMode => ({ sleep: instant, ...extra });

describe("OpenAI images as async tasks", () => {
  it("generates through a task and keeps the task's request id", async () => {
    const gateway = await asyncGateway({ result: { created: 1, data: [{ b64_json: await picture() }] } });
    const onAccepted = vi.fn(async () => {});
    const image = await openai.generate(
      { prompt: "a lighthouse", model: "gpt-image-2", resolution: "4K", quality: "high", aspectRatio: "16:9" },
      { apiKey: "sk-test", baseUrl: gateway.baseUrl, imageTask: mode({ onAccepted }) },
    );
    expect(image).toMatchObject({ width: 6, height: 4, requestId: "task-request-id" });
    expect(onAccepted).toHaveBeenCalledWith(expect.objectContaining({ taskId: "imgtask_fixture000001", requestId: "task-request-id" }));
    expect(gateway.requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      "POST /v1/images/generations/async",
      "GET /v1/images/tasks/imgtask_fixture000001",
      "GET /v1/images/tasks/imgtask_fixture000001",
    ]);
    // The same body the synchronous call sends.
    expect(JSON.parse(gateway.requests[0]?.body ?? "{}")).toMatchObject({
      model: "gpt-image-2",
      size: "3840x2160",
      quality: "high",
      n: 1,
    });
  });

  it("sends an edit's references as multipart to the async edits route", async () => {
    const gateway = await asyncGateway({ result: { data: [{ b64_json: await picture() }] } });
    await openai.generate(
      {
        prompt: "make it night",
        model: "gpt-image-2",
        resolution: "1K",
        inputImages: [`data:image/png;base64,${await picture()}`],
      },
      { apiKey: "sk-test", baseUrl: gateway.baseUrl, imageTask: mode() },
    );
    expect(gateway.requests[0]?.path).toBe("/v1/images/edits/async");
    expect(gateway.requests[0]?.type).toMatch(/^multipart\/form-data/);
    expect(gateway.requests[0]?.body).toContain('name="image');
  });

  it("maps a failed task like the synchronous refusal, not charged", async () => {
    const gateway = await asyncGateway({
      failed: {
        http_status: 400,
        error: { type: "invalid_request_error", message: "Your request was rejected as a result of our safety system." },
      },
    });
    const error = await openai
      .generate({ prompt: "x", model: "gpt-image-2" }, { apiKey: "sk-test", baseUrl: gateway.baseUrl, imageTask: mode() })
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(GatewayError);
    expect(error.failure).toMatchObject({ code: "safety_filter", billing: "not_charged", requestId: "task-request-id" });
  });

  it("leaves a task that failed after generating to the usage list", async () => {
    const gateway = await asyncGateway({
      failed: { http_status: 502, error: { type: "api_error", message: "failed to store generated image to object storage" } },
    });
    const error = await openai
      .generate({ prompt: "x", model: "gpt-image-2" }, { apiKey: "sk-test", baseUrl: gateway.baseUrl, imageTask: mode() })
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(GatewayError);
    expect(error.failure).toMatchObject({ billing: "unknown", requestId: "task-request-id" });
  });

  it("says async is unavailable through the SDK's wrapper", async () => {
    const gateway = await asyncGateway({
      submit: 404,
      body: { error: { type: "not_found_error", message: "async image tasks are not enabled" } },
    });
    const error = await openai
      .generate({ prompt: "x", model: "gpt-image-2" }, { apiKey: "sk-test", baseUrl: gateway.baseUrl, imageTask: mode() })
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(AsyncImageUnavailableError);
  });

  it("maps a refused submit like the synchronous answer", async () => {
    const gateway = await asyncGateway({
      submit: 403,
      body: { code: "INSUFFICIENT_BALANCE", message: "Insufficient account balance" },
    });
    const error = await openai
      .generate({ prompt: "x", model: "gpt-image-2" }, { apiKey: "sk-test", baseUrl: gateway.baseUrl, imageTask: mode() })
      .catch((caught) => caught);
    expect(error.failure).toMatchObject({ code: "insufficient_balance", billing: "not_charged" });
  });

  it("parks through the SDK's wrapper", async () => {
    const gateway = await asyncGateway({ result: { data: [] } });
    const park = new AbortController();
    const error = await openai
      .generate(
        { prompt: "x", model: "gpt-image-2" },
        { apiKey: "sk-test", baseUrl: gateway.baseUrl, imageTask: mode({ park: park.signal, onAccepted: async () => park.abort() }) },
      )
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(ImageTaskParkedError);
  });

  it("resumes a stored task without sending the request again", async () => {
    const gateway = await asyncGateway({ result: { data: [{ b64_json: await picture() }] } });
    const image = await openai.generate(
      { prompt: "x", model: "gpt-image-2" },
      {
        apiKey: "sk-test",
        baseUrl: gateway.baseUrl,
        imageTask: mode({ resume: { taskId: "imgtask_fixture000001", requestId: "earlier-id", submittedAt: Date.now() - 60_000 } }),
      },
    );
    expect(image.requestId).toBe("earlier-id");
    expect(gateway.requests.every((request) => request.method === "GET")).toBe(true);
  });
});

describe("Grok images as async tasks", () => {
  it("generates through a task", async () => {
    const gateway = await asyncGateway({ result: { data: [{ b64_json: await picture() }] } });
    const image = await xai.generate(
      { prompt: "x", model: "grok-imagine-image-2.0", resolution: "2K" },
      { apiKey: "sk-test", baseUrl: gateway.baseUrl, imageTask: mode() },
    );
    expect(image).toMatchObject({ width: 6, height: 4, requestId: "task-request-id" });
    expect(gateway.requests[0]?.path).toBe("/v1/images/generations/async");
  });

  it("says async is unavailable", async () => {
    const gateway = await asyncGateway({
      submit: 404,
      body: { error: { type: "not_found_error", message: "async image tasks are not enabled" } },
    });
    await expect(
      xai.generate({ prompt: "x", model: "grok-imagine-image-2.0" }, { apiKey: "sk-test", baseUrl: gateway.baseUrl, imageTask: mode() }),
    ).rejects.toBeInstanceOf(AsyncImageUnavailableError);
  });

  it("keeps the request id on a blocked picture", async () => {
    const gateway = await asyncGateway({ result: { data: [{ b64_json: await picture(), respect_moderation: false }] } });
    const error = await xai
      .generate({ prompt: "x", model: "grok-imagine-image-2.0" }, { apiKey: "sk-test", baseUrl: gateway.baseUrl, imageTask: mode() })
      .catch((caught) => caught);
    expect(error.failure).toMatchObject({ code: "safety_filter", billing: "unknown", requestId: "task-request-id" });
  });
});

describe("reading a result link", () => {
  it("retries a failed read and refuses plain http", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));
    await expect(
      downloadImageResult("https://bucket.example.com/a.png?X-Amz-Signature=secret", { fetch, retryDelayMs: 0 }),
    ).resolves.toEqual(Buffer.from([1, 2, 3]));
    expect(fetch).toHaveBeenCalledTimes(3);
    await expect(downloadImageResult("http://bucket.example.com/a.png")).rejects.toThrow("Invalid image response");
  });

  it("gives up after three reads without a cause chain", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("gone", { status: 403 }));
    const error = await downloadImageResult("https://bucket.example.com/a.png", { fetch, retryDelayMs: 0 }).catch((caught) => caught);
    expect(error.message).toBe("Image download failed");
    expect(error.cause).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

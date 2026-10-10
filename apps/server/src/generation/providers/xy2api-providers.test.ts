import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadImageCatalog,
  resolveImageParams,
} from "../../features/xy2api/catalog.js";
import {
  Xy2apiGeminiImageProvider,
  geminiImageConfig,
} from "./xy2api-gemini-image.js";
import {
  Xy2apiOpenAIImageProvider,
  openaiImageSize,
} from "./xy2api-openai-image.js";
import { Xy2apiXaiImageProvider } from "./xy2api-xai-image.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((close) => close()));
});
async function gateway(status: number, body: unknown, delayMs = 0) {
  const requests: {
    path: string;
    auth: string | undefined;
    googleKey: string | string[] | undefined;
    body: string;
    ua: string | undefined;
  }[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    requests.push({
      path: req.url ?? "",
      auth: req.headers.authorization,
      googleKey: req.headers["x-goog-api-key"],
      body: Buffer.concat(chunks).toString(),
      ua: req.headers["user-agent"],
    });
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    res.writeHead(status, {
      "Content-Type": "application/json",
      "X-Client-Request-ID": "fixture-request-id",
    });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
  };
}
// A port nothing listens on: connecting is refused, nothing is sent.
async function closedPort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
const catalog = loadImageCatalog();
const openai = new Xy2apiOpenAIImageProvider(catalog, {
  imageOutputFormat: "jpeg",
  imageOutputCompression: 90,
});
const gemini = new Xy2apiGeminiImageProvider(catalog);
const xai = new Xy2apiXaiImageProvider(catalog);
// Grok edits are off in the default catalog until verified on a real gateway.
const xaiEditing = new Xy2apiXaiImageProvider(
  loadImageCatalog(
    JSON.stringify([
      {
        id: "grok-imagine-image-2.0",
        displayName: "Grok Imagine 2.0",
        description: "",
        protocol: "xai-images",
        platforms: ["grok"],
        supportsEdit: true,
        maxInputImages: 3,
      },
    ]),
  ),
);
const png = async () =>
  (
    await sharp({
      create: { width: 4, height: 3, channels: 3, background: "red" },
    })
      .png()
      .toBuffer()
  ).toString("base64");

describe("per-call gateway image transports", () => {
  it("sends one OpenAI request with the caller key and reads request id", async () => {
    const server = await gateway(200, { data: [{ b64_json: await png() }] });
    const result = await openai.generate(
      { model: "gpt-image-2", prompt: "fixture", resolution: "2K" },
      { apiKey: "synthetic-openai-key", baseUrl: server.baseUrl },
    );
    expect(result).toMatchObject({
      requestId: "fixture-request-id",
      width: 4,
      height: 3,
      mimeType: "image/png",
    });
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]).toMatchObject({
      path: "/v1/images/generations",
      auth: "Bearer synthetic-openai-key",
      ua: "LoomicServer/1.0",
    });
    const sent = JSON.parse(server.requests[0]?.body ?? "{}");
    expect(sent).toMatchObject({
      n: 1,
      size: "2048x2048",
      output_format: "jpeg",
      output_compression: 90,
    });
    // 质量 auto is the API default and is left out.
    expect(sent).not.toHaveProperty("quality");
  });
  it("sends 4K as the largest legal size and passes 质量 through", async () => {
    const server = await gateway(200, { data: [{ b64_json: await png() }] });
    await openai.generate(
      {
        model: "gpt-image-2.5-sunburst",
        prompt: "fixture",
        resolution: "4K",
        quality: "high",
        aspectRatio: "16:9",
      },
      { apiKey: "synthetic-openai-key", baseUrl: server.baseUrl },
    );
    expect(JSON.parse(server.requests[0]?.body ?? "{}")).toMatchObject({
      model: "gpt-image-2.5-sunburst",
      size: "3840x2160",
      quality: "high",
    });
  });
  it("keeps every OpenAI size legal and inside the tier the main site bills", () => {
    const catalogModel = catalog.find((model) => model.id === "gpt-image-2");
    if (!catalogModel) throw new Error("missing");
    // xy2api bills by the long edge: ≤ 1024 is 1K, ≤ 2048 is 2K, above is 4K.
    const tierOf = (long: number) =>
      long <= 1024 ? "1K" : long <= 2048 ? "2K" : "4K";
    for (const resolution of ["1K", "2K", "4K"] as const)
      for (const ratio of catalogModel.aspectRatios) {
        const sent = resolveImageParams(catalogModel, {
          resolution,
          aspectRatio: ratio,
        });
        const [w = 0, h = 0] = openaiImageSize(
          "flexible",
          sent.resolution,
          sent.aspectRatio,
        )
          .split("x")
          .map(Number);
        const [a = 1, b = 1] = ratio.split(":").map(Number);
        const label = `${resolution} ${ratio}`;
        expect(w % 16, label).toBe(0);
        expect(h % 16, label).toBe(0);
        expect(Math.max(w, h), label).toBeLessThanOrEqual(3840);
        expect(w * h, label).toBeGreaterThanOrEqual(655_360);
        expect(w * h, label).toBeLessThanOrEqual(8_294_400);
        expect(Math.abs(w / h - a / b) / (a / b), label).toBeLessThan(0.02);
        expect(tierOf(Math.max(w, h)), label).toBe(sent.resolution);
        // Only shapes too wide for 1K move, and only up to 2K.
        expect(sent.resolution, label).toBe(
          resolution === "1K" && ["9:16", "16:9", "21:9"].includes(ratio)
            ? "2K"
            : resolution,
        );
      }
    expect(openaiImageSize("flexible", "1K", "3:4")).toBe("768x1024");
    expect(openaiImageSize("flexible", "2K", "16:9")).toBe("2048x1152");
    expect(openaiImageSize("flexible", "4K", "1:1")).toBe("2880x2880");
    expect(openaiImageSize("flexible", "4K", "9:16")).toBe("2160x3840");
    expect(openaiImageSize("fixed", "2K", "3:4")).toBe("1024x1536");
    expect(openaiImageSize("fixed", "1K", "1:1")).toBe("1024x1024");
  });
  it("uploads references through the edits endpoint", async () => {
    const data = await png();
    const server = await gateway(200, { data: [{ b64_json: data }] });
    await openai.generate(
      {
        model: "gpt-image-2",
        prompt: "fixture",
        inputImages: [`data:image/png;base64,${data}`],
      },
      { apiKey: "synthetic-edit-key", baseUrl: server.baseUrl },
    );
    expect(server.requests[0]?.path).toBe("/v1/images/edits");
    expect(server.requests[0]?.body).toContain('name="image[]"');
  });
  it.each([429, 503])("never retries an OpenAI %i response", async (status) => {
    const server = await gateway(status, {
      error: { type: "server_error", message: "synthetic-sensitive-message" },
    });
    await expect(
      openai.generate(
        { model: "gpt-image-2", prompt: "fixture" },
        { apiKey: "synthetic-key", baseUrl: server.baseUrl },
      ),
    ).rejects.toMatchObject({ failure: { billing: "not_charged" } });
    expect(server.requests).toHaveLength(1);
  });
  it("does not retry a lost response", async () => {
    const server = await gateway(200, { data: [] }, 250);
    await expect(
      openai.generate(
        { model: "gpt-image-2", prompt: "fixture" },
        {
          apiKey: "synthetic-key",
          baseUrl: server.baseUrl,
          signal: AbortSignal.timeout(80),
        },
      ),
    ).rejects.toMatchObject({
      code: "upstream_unknown",
      failure: { billing: "unknown" },
    });
    expect(server.requests).toHaveLength(1);
  });
  it.each(["openai", "gemini"])(
    "calls a refused connection not charged, not 待核对 (%s)",
    async (kind) => {
      const ctx = {
        apiKey: "synthetic-key",
        baseUrl: `http://127.0.0.1:${await closedPort()}`,
      };
      await expect(
        kind === "openai"
          ? openai.generate({ model: "gpt-image-2", prompt: "fixture" }, ctx)
          : gemini.generate(
              { model: "gemini-3-pro-image", prompt: "fixture" },
              ctx,
            ),
      ).rejects.toMatchObject({
        code: "xy2api_unavailable",
        failure: { billing: "not_charged" },
      });
    },
  );
  it("uses Gemini native routing, the exact alias, and per-user credentials", async () => {
    const server = await gateway(200, {
      candidates: [
        {
          content: {
            parts: [
              { inlineData: { mimeType: "image/png", data: await png() } },
            ],
          },
        },
      ],
    });
    const result = await gemini.generate(
      {
        model: "gemini-3-pro-image-preview",
        prompt: "fixture",
        resolution: "2K",
      },
      { apiKey: "synthetic-google-key", baseUrl: server.baseUrl },
    );
    expect(server.requests[0]?.path).toBe(
      "/v1beta/models/gemini-3-pro-image-preview:generateContent",
    );
    expect(server.requests[0]?.googleKey).toBe("synthetic-google-key");
    expect(server.requests[0]?.ua).toBe("LoomicServer/1.0");
    expect(result.requestId).toBe("fixture-request-id");
    const config = JSON.parse(
      server.requests[0]?.body ?? "{}",
    ).generationConfig;
    expect(config.imageConfig).toEqual({ aspectRatio: "1:1", imageSize: "2K" });
    // Nano Banana Pro has no 质量 setting: no thinking config is sent.
    expect(config).not.toHaveProperty("thinkingConfig");
  });
  it("maps Gemini 4K and 质量 to imageSize and thinkingLevel", async () => {
    const server = await gateway(200, {
      candidates: [
        {
          content: {
            parts: [
              { inlineData: { mimeType: "image/png", data: await png() } },
            ],
          },
        },
      ],
    });
    await gemini.generate(
      {
        model: "nano-banana-2.1",
        prompt: "fixture",
        resolution: "4K",
        quality: "low",
        aspectRatio: "21:9",
      },
      { apiKey: "synthetic-google-key", baseUrl: server.baseUrl },
    );
    const config = JSON.parse(
      server.requests[0]?.body ?? "{}",
    ).generationConfig;
    expect(config.imageConfig).toEqual({
      aspectRatio: "21:9",
      imageSize: "4K",
    });
    expect(config.thinkingConfig).toEqual({ thinkingLevel: "MINIMAL" });
  });
  it("always names the Gemini size, since the main site bills 2K when it is missing", () => {
    for (const resolution of ["1K", "2K", "4K"] as const)
      expect(
        geminiImageConfig(
          { vendorQuality: {} },
          { resolution, quality: "auto", aspectRatio: "3:4" },
        ),
      ).toEqual({ imageConfig: { aspectRatio: "3:4", imageSize: resolution } });
  });
  it("uses one Gemini request and preserves the gateway error body", async () => {
    const server = await gateway(503, {
      error: {
        code: 503,
        message: "synthetic-sensitive-message",
        status: "UNAVAILABLE",
      },
    });
    await expect(
      gemini.generate(
        { model: "gemini-3-pro-image", prompt: "fixture" },
        { apiKey: "synthetic-google-key", baseUrl: server.baseUrl },
      ),
    ).rejects.toMatchObject({
      code: "upstream_busy",
      failure: { billing: "not_charged" },
    });
    expect(server.requests).toHaveLength(1);
  });
  it("keeps xy2api's request id when a 200 answer has no usable image", async () => {
    // xy2api answered and probably billed: the id lets the worker settle the
    // 待核对 job from the usage list later.
    const empty = await gateway(200, { data: [] });
    await expect(
      openai.generate(
        { model: "gpt-image-2", prompt: "fixture" },
        { apiKey: "synthetic-key", baseUrl: empty.baseUrl },
      ),
    ).rejects.toMatchObject({
      code: "upstream_unknown",
      failure: { billing: "unknown", requestId: "fixture-request-id" },
    });
    const broken = await gateway(200, {
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: { data: "bm90LWFuLWltYWdl", mimeType: "image/png" },
              },
            ],
          },
        },
      ],
    });
    await expect(
      gemini.generate(
        { model: "gemini-3-pro-image", prompt: "fixture" },
        { apiKey: "synthetic-google-key", baseUrl: broken.baseUrl },
      ),
    ).rejects.toMatchObject({
      failure: { billing: "unknown", requestId: "fixture-request-id" },
    });
  });
});

describe("xAI image transport", () => {
  it("sends one JSON generation with xAI's own size fields", async () => {
    const server = await gateway(200, { data: [{ b64_json: await png() }] });
    const result = await xai.generate(
      {
        model: "grok-imagine-image-2.0",
        prompt: "fixture",
        resolution: "4K",
        quality: "low",
        aspectRatio: "4:5",
      },
      { apiKey: "synthetic-xai-key", baseUrl: server.baseUrl },
    );
    expect(result).toMatchObject({
      requestId: "fixture-request-id",
      width: 4,
      height: 3,
    });
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]).toMatchObject({
      path: "/v1/images/generations",
      auth: "Bearer synthetic-xai-key",
      ua: "LoomicServer/1.0",
    });
    // 4K is not offered by xAI (moved to 2k); 4:5 is not either (nearest
    // 3:4). `size` repeats the tier for the main site's billing.
    expect(JSON.parse(server.requests[0]?.body ?? "{}")).toEqual({
      model: "grok-imagine-image-2.0",
      prompt: "fixture",
      n: 1,
      response_format: "b64_json",
      aspect_ratio: "3:4",
      resolution: "2k",
      size: "2k",
      quality: "low",
    });
  });
  it("edits with JSON image objects, not multipart", async () => {
    const data = await png();
    const server = await gateway(200, { data: [{ b64_json: data }] });
    const ref = `data:image/png;base64,${data}`;
    await xaiEditing.generate(
      {
        model: "grok-imagine-image-2.0",
        prompt: "fixture",
        resolution: "1K",
        inputImages: [ref, ref],
      },
      { apiKey: "synthetic-xai-key", baseUrl: server.baseUrl },
    );
    expect(server.requests[0]?.path).toBe("/v1/images/edits");
    const image = { url: ref, type: "image_url" };
    expect(JSON.parse(server.requests[0]?.body ?? "{}")).toMatchObject({
      image,
      images: [image, image],
      resolution: "1k",
      size: "1k",
    });
    // The main site takes at most 3 per edit: refused before sending.
    await expect(
      xaiEditing.generate(
        {
          model: "grok-imagine-image-2.0",
          prompt: "fixture",
          inputImages: [ref, ref, ref, ref],
        },
        { apiKey: "synthetic-xai-key", baseUrl: server.baseUrl },
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(server.requests).toHaveLength(1);
  });
  it("maps refusals once, with no retry", async () => {
    const server = await gateway(429, {
      error: { type: "rate_limit", message: "synthetic-sensitive-message" },
    });
    await expect(
      xai.generate(
        { model: "grok-imagine-image-2.0", prompt: "fixture" },
        { apiKey: "synthetic-key", baseUrl: server.baseUrl },
      ),
    ).rejects.toMatchObject({
      code: "rate_limited",
      failure: { billing: "not_charged", requestId: "fixture-request-id" },
    });
    expect(server.requests).toHaveLength(1);
  });
  it("treats a moderated picture as 待核对, not free", async () => {
    const server = await gateway(200, {
      data: [{ b64_json: await png(), respect_moderation: false }],
    });
    await expect(
      xai.generate(
        { model: "grok-imagine-image-2.0", prompt: "fixture" },
        { apiKey: "synthetic-key", baseUrl: server.baseUrl },
      ),
    ).rejects.toMatchObject({
      code: "safety_filter",
      failure: { billing: "unknown", requestId: "fixture-request-id" },
    });
  });
  it("calls a refused connection not charged", async () => {
    await expect(
      xai.generate(
        { model: "grok-imagine-image-2.0", prompt: "fixture" },
        {
          apiKey: "synthetic-key",
          baseUrl: `http://127.0.0.1:${await closedPort()}`,
        },
      ),
    ).rejects.toMatchObject({
      code: "xy2api_unavailable",
      failure: { billing: "not_charged" },
    });
  });
  it("does not retry a lost response", async () => {
    const server = await gateway(200, { data: [] }, 250);
    await expect(
      xai.generate(
        { model: "grok-imagine-image-2.0", prompt: "fixture" },
        {
          apiKey: "synthetic-key",
          baseUrl: server.baseUrl,
          signal: AbortSignal.timeout(80),
        },
      ),
    ).rejects.toMatchObject({
      code: "upstream_unknown",
      failure: { billing: "unknown" },
    });
    expect(server.requests).toHaveLength(1);
  });
});

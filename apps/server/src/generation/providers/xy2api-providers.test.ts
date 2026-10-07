import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { loadImageCatalog } from "../../features/xy2api/catalog.js";
import { Xy2apiGeminiImageProvider } from "./xy2api-gemini-image.js";
import { Xy2apiOpenAIImageProvider } from "./xy2api-openai-image.js";

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
const catalog = loadImageCatalog();
const openai = new Xy2apiOpenAIImageProvider(catalog, {
  imageOutputFormat: "jpeg",
  imageOutputCompression: 90,
});
const gemini = new Xy2apiGeminiImageProvider(catalog);
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
      { model: "gpt-image-2", prompt: "fixture", quality: "hd" },
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
    expect(JSON.parse(server.requests[0]?.body ?? "{}")).toMatchObject({
      n: 1,
      size: "2048x2048",
      output_format: "jpeg",
      output_compression: 90,
    });
  });
  it("uploads references through the edits endpoint", async () => {
    const data = await png();
    const server = await gateway(200, { data: [{ b64_json: data }] });
    await openai.generate(
      {
        model: "gpt-image-1.5",
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
      { model: "gemini-3-pro-image-preview", prompt: "fixture", quality: "hd" },
      { apiKey: "synthetic-google-key", baseUrl: server.baseUrl },
    );
    expect(server.requests[0]?.path).toBe(
      "/v1beta/models/gemini-3-pro-image-preview:generateContent",
    );
    expect(server.requests[0]?.googleKey).toBe("synthetic-google-key");
    expect(server.requests[0]?.ua).toBe("LoomicServer/1.0");
    expect(result.requestId).toBe("fixture-request-id");
    expect(
      JSON.parse(server.requests[0]?.body ?? "{}").generationConfig.imageConfig
        .imageSize,
    ).toBe("2K");
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
});

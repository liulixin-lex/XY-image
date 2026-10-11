import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSupabaseFetch } from "../../supabase/transport.js";
import sharp from "sharp";
import { fetchReferenceImage, shrinkForSending } from "./xy2api-reference.js";

const env = {
  supabaseUrl: "https://db.example.test",
  supabaseInternalUrl: "http://api-gw:8000",
};
const object = `${env.supabaseUrl}/storage/v1/object/public/project-assets/u/ref.png`;
const png = () =>
  new Response(new Uint8Array([137, 80, 78, 71]), {
    headers: { "content-type": "image/png" },
  });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reference image download", () => {
  it("validates the public URL but downloads over the internal Supabase URL", async () => {
    const internal = vi.fn(async () => png());
    const global = vi.spyOn(globalThis, "fetch");
    const image = await fetchReferenceImage(object, {
      apiKey: "",
      baseUrl: "https://gateway.example.test",
      assetOrigin: env.supabaseUrl,
      assetFetch: createSupabaseFetch(env, internal as unknown as typeof fetch),
    });
    expect(image).toMatchObject({ mimeType: "image/png" });
    expect(image.bytes).toHaveLength(4);
    expect(internal).toHaveBeenCalledWith(
      "http://api-gw:8000/storage/v1/object/public/project-assets/u/ref.png",
      expect.objectContaining({ redirect: "error" }),
    );
    expect(global).not.toHaveBeenCalled();
  });

  it("refuses other origins and non-object paths before fetching", async () => {
    const assetFetch = vi.fn(async () => png());
    for (const source of [
      "https://elsewhere.example.test/storage/v1/object/public/project-assets/u/ref.png",
      `${env.supabaseUrl}/rest/v1/projects`,
    ])
      await expect(
        fetchReferenceImage(source, {
          apiKey: "",
          baseUrl: "https://gateway.example.test",
          assetOrigin: env.supabaseUrl,
          assetFetch: assetFetch as unknown as typeof fetch,
        }),
      ).rejects.toMatchObject({ code: "invalid_input" });
    expect(assetFetch).not.toHaveBeenCalled();
  });

  it("accepts Supabase served under a path on the site's own domain", async () => {
    // Pre-launch site: SUPABASE_URL=https://2.lexzerone.xyz/supabase; every
    // reference was refused with 「请先上传参考图到当前工作区」.
    const sub = {
      supabaseUrl: "https://site.example.test/supabase",
      supabaseInternalUrl: "http://api-gw:8000",
    };
    const internal = vi.fn(async () => png());
    const ctx = {
      apiKey: "",
      baseUrl: "https://gateway.example.test",
      assetOrigin: sub.supabaseUrl,
      assetFetch: createSupabaseFetch(sub, internal as unknown as typeof fetch),
    };
    await expect(
      fetchReferenceImage(
        `${sub.supabaseUrl}/storage/v1/object/public/project-assets/u/ref.png`,
        ctx,
      ),
    ).resolves.toMatchObject({ mimeType: "image/png" });
    expect(internal).toHaveBeenCalledWith(
      "http://api-gw:8000/storage/v1/object/public/project-assets/u/ref.png",
      expect.anything(),
    );
    for (const source of [
      "https://site.example.test/storage/v1/object/public/project-assets/u/ref.png",
      `${sub.supabaseUrl}/rest/v1/projects`,
      `${sub.supabaseUrl}/storage/v1/object/public/project-assets/..%2f..%2f..%2frest/v1/projects`,
    ])
      await expect(fetchReferenceImage(source, ctx)).rejects.toMatchObject({
        code: "invalid_input",
      });
    expect(internal).toHaveBeenCalledTimes(1);
  });

  it("logs why a reference was unreadable without the signed token", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const assetFetch = vi.fn(
      async () =>
        new Response("{}", {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
    );
    await expect(
      fetchReferenceImage(
        `${env.supabaseUrl}/storage/v1/object/sign/brand-kit-assets/u/logo.png?token=synthetic-signed-token`,
        {
          apiKey: "",
          baseUrl: "https://gateway.example.test",
          assetOrigin: env.supabaseUrl,
          assetFetch: assetFetch as unknown as typeof fetch,
        },
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toContain("status 404");
    expect(line).toContain("/storage/v1/object/sign/brand-kit-assets/");
    expect(line).not.toContain("synthetic-signed-token");
    expect(line).not.toContain("logo.png");
  });

  it("shrinks a large result instead of refusing it as a reference", async () => {
    // A 4K result (pre-launch site: 3584x4800 JPEG, 12.4 MB) used to be
    // refused, so 以此为参考 / 局部重绘 on it failed with invalid_input.
    // Random pixels compress like a detailed photo (patterns would not).
    const noise = randomBytes(1200 * 1600 * 3);
    const photo = await sharp(noise, {
      raw: { width: 1200, height: 1600, channels: 3 },
    })
      .png()
      .toBuffer();
    const small = await shrinkForSending(
      { bytes: photo, mimeType: "image/png" },
      photo.length - 1,
    );
    expect(small.mimeType).toBe("image/jpeg");
    expect(small.bytes.length).toBeLessThan(photo.length);
    const meta = await sharp(small.bytes).metadata();
    expect([meta.width, meta.height]).toEqual([1200, 1600]);
    // Under the limit nothing changes; transparency keeps PNG.
    const same = { bytes: photo, mimeType: "image/png" };
    expect(await shrinkForSending(same)).toBe(same);
    const rgba = randomBytes(3600 * 300 * 4);
    const logo = await sharp(rgba, {
      raw: { width: 3600, height: 300, channels: 4 },
    })
      .png()
      .toBuffer();
    const fitted = await shrinkForSending(
      { bytes: logo, mimeType: "image/png" },
      logo.length - 1,
    );
    expect(fitted.mimeType).toBe("image/png");
    expect((await sharp(fitted.bytes).metadata()).width).toBe(3072);
  });

  it("refuses a download that announces more than 40 MB without reading it", async () => {
    const cancel = vi.fn(async () => {});
    const assetFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({
        "content-type": "image/png",
        "content-length": String(41 * 1024 * 1024),
      }),
      body: { cancel },
      arrayBuffer: vi.fn(),
    }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      fetchReferenceImage(object, {
        apiKey: "",
        baseUrl: "https://gateway.example.test",
        assetOrigin: env.supabaseUrl,
        assetFetch: assetFetch as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(cancel).toHaveBeenCalled();
  });
});

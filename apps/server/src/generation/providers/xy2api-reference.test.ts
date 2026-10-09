import { afterEach, describe, expect, it, vi } from "vitest";
import { createSupabaseFetch } from "../../supabase/transport.js";
import { fetchReferenceImage } from "./xy2api-reference.js";

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
});

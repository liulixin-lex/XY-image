// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { dataUrlToBlob, readImageBlob } from "../src/lib/image-blob";

/** jsdom's Blob has no arrayBuffer(); FileReader it is. */
function bytesOf(blob: Blob): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve([...new Uint8Array(reader.result as ArrayBuffer)]);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("dataUrlToBlob", () => {
  it("decodes a base64 picture with its type", async () => {
    const blob = dataUrlToBlob("data:image/png;base64,iVBORw0KGgo=");
    expect(blob.type).toBe("image/png");
    expect(await bytesOf(blob)).toEqual(PNG_SIGNATURE);
  });

  it("ignores line breaks inside the base64", async () => {
    const blob = dataUrlToBlob("data:image/png;base64,iVBO\nRw0K\r\nGgo=");
    expect(await bytesOf(blob)).toEqual(PNG_SIGNATURE);
  });

  it("decodes a percent-encoded payload", async () => {
    const blob = dataUrlToBlob("data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E");
    expect(blob.type).toBe("image/svg+xml;charset=utf-8");
    expect(String.fromCharCode(...(await bytesOf(blob)))).toBe("<svg/>");
  });

  it("refuses what is not a data: URL", () => {
    expect(() => dataUrlToBlob("https://image.example/a.png")).toThrow(
      "not a data: URL",
    );
  });
});

// The site's CSP (connect-src 'self') refuses fetch() of data: URLs; on
// /canvas production reported exactly that while the policy is report-only.
describe("readImageBlob", () => {
  it("decodes a data: URL without a request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const blob = await readImageBlob("data:image/png;base64,iVBORw0KGgo=");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await bytesOf(blob)).toEqual(PNG_SIGNATURE);
  });

  it("fetches a stored picture, passing the request options", async () => {
    const stored = new Blob(["x"], { type: "image/jpeg" });
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      blob: async () => stored,
    }));
    vi.stubGlobal("fetch", fetchSpy);
    const url = "https://image.example/supabase/storage/v1/object/public/a.jpg";
    expect(await readImageBlob(url, { mode: "cors" })).toBe(stored);
    expect(fetchSpy).toHaveBeenCalledWith(url, { mode: "cors" });
  });

  it("fails on an HTTP error, so callers fall back", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 403 })),
    );
    await expect(readImageBlob("https://image.example/a.png")).rejects.toThrow(
      "HTTP 403",
    );
  });
});

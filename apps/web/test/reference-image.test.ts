// @vitest-environment jsdom

import { UPLOAD_MAX_BYTES } from "@loomic/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CodecUnavailableError,
  type DecodedImage,
  type ImageCodec,
  REFERENCE_KEEP_BYTES,
  REFERENCE_READ_MAX_BYTES,
  ReferenceImageError,
  detectImageType,
  isCandidateImageType,
  prepareReferenceImage,
} from "../src/lib/reference-image";

const MB = 1024 * 1024;
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const WEBP = [...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")];
const HEIC = [0, 0, 0, 0x18, ...ascii("ftypheic")];
const GIF = ascii("GIF89a");

/** A file with the given first bytes that reports `size` (no real megabytes). */
function picture(head: number[], type: string, size: number, name = "ref.png") {
  const file = new File([new Uint8Array([...head, 0, 0, 0, 0])], name, {
    type,
  });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

/**
 * A codec whose encoded size depends on the edge: `sizes[edge]` bytes.
 * jsdom has no canvas; the browser codec is exercised in the real app.
 */
function fakeCodec(opts: {
  width: number;
  height: number;
  transparent?: boolean;
  sizes?: Record<number, number>;
  decodeError?: Error;
}) {
  const encode = vi.fn();
  const fit = vi.fn();
  const release = vi.fn();
  const codec: ImageCodec = {
    async decode() {
      if (opts.decodeError) throw opts.decodeError;
      const decoded: DecodedImage = {
        width: opts.width,
        height: opts.height,
        fit(edge) {
          fit(edge);
          const scale = Math.min(1, edge / Math.max(opts.width, opts.height));
          const width = Math.round(opts.width * scale);
          const height = Math.round(opts.height * scale);
          return {
            width,
            height,
            hasTransparency: () => Boolean(opts.transparent),
            async encode(type, quality) {
              encode(edge, type, quality);
              const blob = new Blob([new Uint8Array(8)], { type });
              Object.defineProperty(blob, "size", {
                value: opts.sizes?.[edge] ?? 2 * MB,
              });
              return blob;
            },
            release() {},
          };
        },
        release,
      };
      return decoded;
    },
  };
  return { codec, encode, fit, release };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("detectImageType", () => {
  it("trusts the browser's label for the types generation takes", async () => {
    expect(await detectImageType(picture(GIF, "image/png", 10))).toBe(
      "image/png",
    );
    expect(await detectImageType(picture(JPEG, "image/jpg", 10))).toBe(
      "image/jpeg",
    );
  });

  it("reads the first bytes of an unlabelled file", async () => {
    expect(await detectImageType(picture(PNG, "", 10))).toBe("image/png");
    expect(await detectImageType(picture(JPEG, "", 10))).toBe("image/jpeg");
    expect(
      await detectImageType(picture(WEBP, "application/octet-stream", 10)),
    ).toBe("image/webp");
    expect(await detectImageType(picture(HEIC, "", 10))).toBe("image/heic");
    expect(await detectImageType(picture(GIF, "", 10))).toBeNull();
  });

  it("refuses types generation cannot use", async () => {
    expect(isCandidateImageType("image/gif")).toBe(false);
    expect(isCandidateImageType("image/svg+xml")).toBe(false);
    expect(isCandidateImageType("application/pdf")).toBe(false);
    expect(await detectImageType(picture(GIF, "image/gif", 10))).toBeNull();
  });
});

describe("prepareReferenceImage", () => {
  it("uploads a light picture as it is, without decoding it", async () => {
    const { codec, fit } = fakeCodec({ width: 4000, height: 3000 });
    const file = picture(JPEG, "image/jpeg", REFERENCE_KEEP_BYTES);
    const prepared = await prepareReferenceImage(file, codec);
    expect(prepared.file).toBe(file);
    expect(fit).not.toHaveBeenCalled();
  });

  it("keeps a picture that is already inside 2048 px and light", async () => {
    const { codec, encode } = fakeCodec({ width: 1600, height: 1200 });
    const file = picture(JPEG, "image/jpeg", 1.2 * MB);
    const prepared = await prepareReferenceImage(file, codec);
    expect(prepared.file).toBe(file);
    expect(encode).not.toHaveBeenCalled();
  });

  it("labels an unlabelled picture by its bytes", async () => {
    const prepared = await prepareReferenceImage(
      picture(JPEG, "", 100, "IMG_0001"),
      fakeCodec({ width: 10, height: 10 }).codec,
    );
    expect(prepared.file.type).toBe("image/jpeg");
  });

  it("refuses what is not a PNG, JPEG or WebP picture", async () => {
    await expect(
      prepareReferenceImage(
        picture(GIF, "", 100),
        fakeCodec({ width: 1, height: 1 }).codec,
      ),
    ).rejects.toMatchObject({
      problem: "unsupported",
      message: "只支持 PNG、JPEG、WebP 格式的图片",
    });
  });

  // image.gguuai.com 2026-10-15/17: 1.6–5.6 MB pictures took 8–37 s for
  // users at 50–300 KB/s; through 0.0.17 everything up to 8 MB went up as is.
  it("shrinks a 3.2 MB phone photo to 2048 px before it goes up", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { codec, encode, release } = fakeCodec({
      width: 4032,
      height: 3024,
      sizes: { 2048: 0.7 * MB },
    });
    const prepared = await prepareReferenceImage(
      picture(JPEG, "image/jpeg", 3.2 * MB, "IMG_1234.jpeg"),
      codec,
    );
    expect(encode).toHaveBeenCalledWith(2048, "image/jpeg", 0.88);
    expect(prepared.file).toMatchObject({ type: "image/jpeg", name: "IMG_1234.jpg" });
    expect(prepared.shrunk).toMatchObject({
      fromWidth: 4032,
      fromHeight: 3024,
      toWidth: 2048,
      toHeight: 1536,
      toBytes: 0.7 * MB,
    });
    expect(release).toHaveBeenCalled();
  });

  // image.gguuai.com 2026-10-16/17: 12–19 MB pictures (the site's own 4K
  // results among them) were refused, then failed as a bare 500 on 重试.
  it("shrinks a 12.6 MB 4K result", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { codec, encode } = fakeCodec({
      width: 5120,
      height: 2880,
      sizes: { 2048: 1.1 * MB },
    });
    const prepared = await prepareReferenceImage(
      picture(PNG, "image/png", 13_180_000, "result-4k.png"),
      codec,
    );
    expect(encode).toHaveBeenCalledWith(2048, "image/jpeg", 0.88);
    expect(prepared.file.name).toBe("result-4k.jpg");
    expect(prepared.shrunk).toMatchObject({ toWidth: 2048, toHeight: 1152 });
  });

  it("keeps transparency as PNG", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { codec, encode } = fakeCodec({
      width: 4096,
      height: 4096,
      transparent: true,
      sizes: { 2048: 3 * MB },
    });
    const prepared = await prepareReferenceImage(
      picture(PNG, "image/png", 14 * MB),
      codec,
    );
    expect(encode).toHaveBeenCalledWith(2048, "image/png", undefined);
    expect(prepared.file.type).toBe("image/png");
  });

  it("keeps the original when re-encoding would save little", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { codec } = fakeCodec({
      width: 1800,
      height: 1800,
      transparent: true,
      sizes: { 2048: 4.6 * MB },
    });
    const file = picture(PNG, "image/png", 5 * MB);
    const prepared = await prepareReferenceImage(file, codec);
    expect(prepared.file).toBe(file);
    expect(prepared.shrunk).toBeUndefined();
  });

  it("goes smaller when 2048 px is still over 8 MB", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { codec, fit } = fakeCodec({
      width: 8000,
      height: 8000,
      transparent: true,
      sizes: { 2048: 9 * MB, 1536: 5 * MB },
    });
    const prepared = await prepareReferenceImage(
      picture(PNG, "image/png", 30 * MB),
      codec,
    );
    expect(fit.mock.calls.map(([edge]) => edge)).toEqual([2048, 1536]);
    expect(prepared.shrunk?.toWidth).toBe(1536);
  });

  it("holds canvas pictures to a smaller limit when asked", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { codec, fit } = fakeCodec({
      width: 6000,
      height: 4000,
      transparent: true,
      sizes: { 2048: 5 * MB, 1536: 3 * MB },
    });
    const prepared = await prepareReferenceImage(
      picture(PNG, "image/png", 18 * MB),
      codec,
      { maxBytes: 4 * MB },
    );
    expect(fit.mock.calls.map(([edge]) => edge)).toEqual([2048, 1536]);
    expect(prepared.shrunk).toMatchObject({ toWidth: 1536, toBytes: 3 * MB });
  });

  it("says so when even the smallest size is over 8 MB", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { codec } = fakeCodec({
      width: 8000,
      height: 8000,
      transparent: true,
      sizes: { 2048: 20 * MB, 1536: 12 * MB, 1024: 9 * MB },
    });
    const error = await prepareReferenceImage(
      picture(PNG, "image/png", 30 * MB),
      codec,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReferenceImageError);
    expect(error).toMatchObject({ problem: "too_large" });
  });

  it("does not try to decode a file over 50 MB", async () => {
    const { codec, fit } = fakeCodec({ width: 1, height: 1 });
    await expect(
      prepareReferenceImage(
        picture(JPEG, "image/jpeg", REFERENCE_READ_MAX_BYTES + 1),
        codec,
      ),
    ).rejects.toMatchObject({ problem: "too_large" });
    expect(fit).not.toHaveBeenCalled();
  });

  it("uploads the original when the browser cannot shrink it but the API takes it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { codec } = fakeCodec({
      width: 1,
      height: 1,
      decodeError: new Error("no codec"),
    });
    const file = picture(JPEG, "image/jpeg", UPLOAD_MAX_BYTES - 1);
    expect((await prepareReferenceImage(file, codec)).file).toBe(file);
    await expect(
      prepareReferenceImage(
        picture(JPEG, "image/jpeg", UPLOAD_MAX_BYTES + 1),
        codec,
      ),
    ).rejects.toMatchObject({ problem: "too_large" });
  });

  // The worker's codec cannot read some pictures an <img> can: the page
  // tries those itself instead of the worker giving up on them.
  it("lets a codec that cannot read the picture hand it back", async () => {
    const { codec } = fakeCodec({
      width: 1,
      height: 1,
      decodeError: new CodecUnavailableError("worker could not decode"),
    });
    await expect(
      prepareReferenceImage(picture(JPEG, "image/jpeg", 3 * MB), codec),
    ).rejects.toBeInstanceOf(CodecUnavailableError);
  });

  it("converts HEIC where the browser reads it, and says what to do where it cannot", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const safari = fakeCodec({
      width: 4032,
      height: 3024,
      sizes: { 2048: 0.8 * MB },
    });
    const prepared = await prepareReferenceImage(
      picture(HEIC, "image/heic", 2 * MB, "IMG_0002.HEIC"),
      safari.codec,
    );
    expect(safari.encode).toHaveBeenCalledWith(2048, "image/jpeg", 0.88);
    expect(prepared.file).toMatchObject({
      type: "image/jpeg",
      name: "IMG_0002.jpg",
    });

    const chrome = fakeCodec({
      width: 1,
      height: 1,
      decodeError: new Error("unsupported"),
    });
    await expect(
      prepareReferenceImage(picture(HEIC, "image/heic", 2 * MB), chrome.codec),
    ).rejects.toMatchObject({
      problem: "unreadable",
      message: expect.stringContaining("HEIC"),
    });
  });
});

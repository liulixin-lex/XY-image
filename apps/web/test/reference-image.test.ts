// @vitest-environment jsdom

import { UPLOAD_MAX_BYTES } from "@loomic/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type DecodedImage,
  type ImageCodec,
  REFERENCE_READ_MAX_BYTES,
  REFERENCE_SEND_BYTES,
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
  it("uploads a picture up to 8 MB byte for byte", async () => {
    const { codec, encode } = fakeCodec({ width: 4000, height: 3000 });
    const file = picture(PNG, "image/png", REFERENCE_SEND_BYTES);
    const prepared = await prepareReferenceImage(file, codec);
    expect(prepared.file).toBe(file);
    expect(prepared.shrunk).toBeUndefined();
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

  // image.gguuai.com 2026-10-16/17: 12–19 MB pictures (the site's own 4K
  // results among them) were refused, then failed as a bare 500 on 重试.
  it("shrinks a 12.6 MB photo the way the server would send it: 3072 px JPEG q90", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { codec, encode, release } = fakeCodec({
      width: 5120,
      height: 2880,
      sizes: { 3072: 2.1 * MB },
    });
    const prepared = await prepareReferenceImage(
      picture(PNG, "image/png", 13_180_000, "result-4k.png"),
      codec,
    );
    expect(encode).toHaveBeenCalledWith(3072, "image/jpeg", 0.9);
    expect(prepared.file.type).toBe("image/jpeg");
    expect(prepared.file.name).toBe("result-4k.jpg");
    expect(prepared.shrunk).toMatchObject({
      fromWidth: 5120,
      fromHeight: 2880,
      toWidth: 3072,
      toHeight: 1728,
      toType: "image/jpeg",
    });
    expect(release).toHaveBeenCalled();
  });

  it("keeps transparency as PNG", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { codec, encode } = fakeCodec({
      width: 4096,
      height: 4096,
      transparent: true,
      sizes: { 3072: 6 * MB },
    });
    const prepared = await prepareReferenceImage(
      picture(PNG, "image/png", 14 * MB),
      codec,
    );
    expect(encode).toHaveBeenCalledWith(3072, "image/png", undefined);
    expect(prepared.file.type).toBe("image/png");
  });

  it("goes down to 2048 px when 3072 px is still over 8 MB", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { codec, fit } = fakeCodec({
      width: 8000,
      height: 8000,
      transparent: true,
      sizes: { 3072: 9 * MB, 2048: 4 * MB },
    });
    const prepared = await prepareReferenceImage(
      picture(PNG, "image/png", 30 * MB),
      codec,
    );
    expect(fit.mock.calls.map(([edge]) => edge)).toEqual([3072, 2048]);
    expect(prepared.shrunk?.toWidth).toBe(2048);
  });

  it("says so when even 2048 px is over 8 MB", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { codec } = fakeCodec({
      width: 8000,
      height: 8000,
      transparent: true,
      sizes: { 3072: 20 * MB, 2048: 9 * MB },
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

  it("converts HEIC where the browser reads it, and says what to do where it cannot", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const safari = fakeCodec({
      width: 4032,
      height: 3024,
      sizes: { 4096: 3 * MB },
    });
    const prepared = await prepareReferenceImage(
      picture(HEIC, "image/heic", 2 * MB, "IMG_0002.HEIC"),
      safari.codec,
    );
    expect(safari.encode).toHaveBeenCalledWith(4096, "image/jpeg", 0.9);
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

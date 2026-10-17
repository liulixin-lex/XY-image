import { UPLOAD_MAX_BYTES } from "@loomic/shared";

/**
 * A picture picked as a reference (studio 参考图, the home prompt, the chat
 * panel) is made the size the server would send it at anyway, before it is
 * uploaded. The server reads references up to 40 MB and sends anything over
 * 8 MB fitted inside 3072 px, then 2048 px, on the long edge: JPEG q90 for
 * photos, PNG when there is transparency (apps/server/src/generation/
 * providers/xy2api-reference.ts shrinkForSending). Doing the same here lets
 * phone photos and this site's own 4K results (12–15 MB) through, in a
 * fraction of the upload time, and loses nothing the model would have seen.
 * Pictures up to 8 MB go up byte for byte.
 *
 * Through 0.0.16 the page refused anything over 10 MB, then offered a 重试
 * that uploaded it anyway into the API's 10 MB limit and a bare 500
 * (image.gguuai.com, 2026-10-16/17: 17 of 48 uploads).
 */
export const REFERENCE_SEND_BYTES = 8 * 1024 * 1024;
/** Larger files are not decoded at all: a tab can run out of memory. */
export const REFERENCE_READ_MAX_BYTES = 50 * 1024 * 1024;
const FIT_EDGES = [3072, 2048];
/** HEIC is converted at full size first (a phone photo is 4032 px). */
const CONVERT_EDGES = [4096, 3072, 2048];
const JPEG_QUALITY = 0.9;

const SENDABLE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
/** iPhone photos dragged or pasted in. Safari decodes them; others cannot. */
const CONVERTIBLE_TYPES = new Set(["image/heic", "image/heif"]);
/** What the server and generation take; the file pickers ask for these. */
export const ATTACHMENT_ACCEPT = "image/png,image/jpeg,image/webp";

export type ReferenceImageProblem = "unsupported" | "too_large" | "unreadable";

/** A picture that cannot be used as it is; trying again will not help. */
export class ReferenceImageError extends Error {
  readonly problem: ReferenceImageProblem;
  constructor(problem: ReferenceImageProblem, message: string) {
    super(message);
    this.name = "ReferenceImageError";
    this.problem = problem;
  }
}

export type PreparedReference = {
  file: File;
  /** Set when the picture was re-encoded. */
  shrunk?: {
    fromBytes: number;
    fromType: string;
    fromWidth: number;
    fromHeight: number;
    toBytes: number;
    toType: string;
    toWidth: number;
    toHeight: number;
  };
};

/** A picture drawn at a size, ready to encode. */
export type FittedImage = {
  width: number;
  height: number;
  hasTransparency(): boolean;
  encode(
    type: "image/jpeg" | "image/png",
    quality?: number,
  ): Promise<Blob | null>;
  release(): void;
};

export type DecodedImage = {
  width: number;
  height: number;
  /** Draws the picture fitted inside `edge` px (never enlarged). */
  fit(edge: number): FittedImage;
  release(): void;
};

/** Decoding and drawing, swappable in tests (jsdom has no canvas). */
export type ImageCodec = { decode(blob: Blob): Promise<DecodedImage> };

const MB = 1024 * 1024;
const mb = (bytes: number) => Math.round(bytes / MB);
const mb1 = (bytes: number) => (bytes / MB).toFixed(1);

/** Whether a file the browser labels `type` can be tried at all. */
export function isCandidateImageType(type: string): boolean {
  const t = type.toLowerCase();
  return (
    t === "" ||
    t === "application/octet-stream" ||
    t === "image/jpg" ||
    SENDABLE_TYPES.has(t) ||
    CONVERTIBLE_TYPES.has(t)
  );
}

async function readHead(blob: Blob, length: number): Promise<Uint8Array> {
  const part = blob.slice(0, length);
  if (typeof part.arrayBuffer === "function")
    return new Uint8Array(await part.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(part);
  });
}

const ascii = (bytes: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...bytes.subarray(from, to));

/**
 * The picture's real type: the browser's label, or its first bytes when the
 * label is missing (some Android pickers, files without an extension).
 * Null for anything generation cannot use (GIF, SVG, BMP, not an image).
 */
export async function detectImageType(file: Blob): Promise<string | null> {
  const declared = file.type.toLowerCase();
  if (declared === "image/jpg") return "image/jpeg";
  if (SENDABLE_TYPES.has(declared) || CONVERTIBLE_TYPES.has(declared))
    return declared;
  if (!isCandidateImageType(declared)) return null;
  const head = await readHead(file, 16);
  if (head[0] === 0x89 && ascii(head, 1, 4) === "PNG") return "image/png";
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff)
    return "image/jpeg";
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WEBP")
    return "image/webp";
  if (
    ascii(head, 4, 8) === "ftyp" &&
    ["heic", "heix", "hevc", "heim", "heis", "mif1", "msf1"].includes(
      ascii(head, 8, 12),
    )
  )
    return "image/heic";
  return null;
}

function relabel(file: File, type: string): File {
  if (file.type === type) return file;
  return new File([file], file.name || "image", {
    type,
    lastModified: file.lastModified,
  });
}

function renamed(name: string, type: string): string {
  const base = (name || "image").replace(/\.[^.]*$/, "") || "image";
  return `${base}.${type === "image/png" ? "png" : "jpg"}`;
}

/**
 * The file to upload for a picture picked as a reference. Throws
 * ReferenceImageError when it cannot be used (its message is for the user).
 */
export async function prepareReferenceImage(
  file: File,
  codec: ImageCodec = browserCodec,
): Promise<PreparedReference> {
  const type = await detectImageType(file);
  if (!type)
    throw new ReferenceImageError(
      "unsupported",
      "只支持 PNG、JPEG、WebP 格式的图片",
    );
  if (file.size > REFERENCE_READ_MAX_BYTES)
    throw new ReferenceImageError(
      "too_large",
      `图片超过 ${mb(REFERENCE_READ_MAX_BYTES)} MB，换一张小一点的`,
    );
  const convert = CONVERTIBLE_TYPES.has(type);
  if (!convert && file.size <= REFERENCE_SEND_BYTES)
    return { file: relabel(file, type) };

  // What to do when this browser cannot shrink it: the API takes it up to
  // UPLOAD_MAX_BYTES and the server shrinks it when it is sent.
  const unshrunk = (reason: string, error: unknown): PreparedReference => {
    console.warn(
      `[reference-image] ${reason}: ${file.name} ${mb1(file.size)} MB ${type}`,
      error,
    );
    if (convert)
      throw new ReferenceImageError(
        "unreadable",
        "这个浏览器打不开 HEIC 图片，请先导出成 JPEG 或 PNG 再上传",
      );
    if (file.size <= UPLOAD_MAX_BYTES) return { file: relabel(file, type) };
    throw new ReferenceImageError(
      "too_large",
      `图片超过 ${mb(UPLOAD_MAX_BYTES)} MB，浏览器也没能把它压小，换一张小一点的`,
    );
  };

  let decoded: DecodedImage;
  try {
    decoded = await codec.decode(file);
  } catch (error) {
    return unshrunk("could not decode", error);
  }
  let smallest = Number.POSITIVE_INFINITY;
  try {
    for (const edge of convert ? CONVERT_EDGES : FIT_EDGES) {
      const fitted = decoded.fit(edge);
      try {
        const keepAlpha = type !== "image/jpeg" && fitted.hasTransparency();
        const toType = keepAlpha ? "image/png" : "image/jpeg";
        const blob = await fitted.encode(
          toType,
          keepAlpha ? undefined : JPEG_QUALITY,
        );
        if (!blob) throw new Error(`the browser did not encode ${toType}`);
        smallest = Math.min(smallest, blob.size);
        if (blob.size > REFERENCE_SEND_BYTES) continue;
        const shrunk = {
          fromBytes: file.size,
          fromType: type,
          fromWidth: decoded.width,
          fromHeight: decoded.height,
          toBytes: blob.size,
          toType,
          toWidth: fitted.width,
          toHeight: fitted.height,
        };
        console.info(
          `[reference-image] shrank ${file.name} ${mb1(shrunk.fromBytes)} MB ${type} ${shrunk.fromWidth}×${shrunk.fromHeight} to ${mb1(shrunk.toBytes)} MB ${toType} ${shrunk.toWidth}×${shrunk.toHeight}`,
        );
        return {
          file: new File([blob], renamed(file.name, toType), {
            type: toType,
            lastModified: file.lastModified,
          }),
          shrunk,
        };
      } finally {
        fitted.release();
      }
    }
  } catch (error) {
    return unshrunk("could not shrink", error);
  } finally {
    decoded.release();
  }
  console.warn(
    `[reference-image] ${file.name} still ${mb1(smallest)} MB at 2048 px`,
  );
  throw new ReferenceImageError(
    "too_large",
    `图片压缩后仍超过 ${mb(REFERENCE_SEND_BYTES)} MB，换一张小一点的`,
  );
}

type Drawable = ImageBitmap | HTMLImageElement;

async function decodeDrawable(blob: Blob): Promise<{
  source: Drawable;
  width: number;
  height: number;
  release(): void;
}> {
  if (typeof createImageBitmap === "function") {
    try {
      // EXIF orientation applied, as the server's sharp().rotate() does.
      const bitmap = await createImageBitmap(blob, {
        imageOrientation: "from-image",
      });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch (error) {
      // Older Safari cannot make bitmaps of some blobs; an <img> can.
      console.info(
        "[reference-image] createImageBitmap failed, trying <img>",
        error,
      );
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

export const browserCodec: ImageCodec = {
  async decode(blob) {
    const image = await decodeDrawable(blob);
    if (!image.width || !image.height) {
      image.release();
      throw new Error("decoded to an empty picture");
    }
    return {
      width: image.width,
      height: image.height,
      fit(edge) {
        const scale = Math.min(1, edge / Math.max(image.width, image.height));
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no 2d canvas");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(image.source, 0, 0, width, height);
        return {
          width,
          height,
          hasTransparency() {
            const { data } = ctx.getImageData(0, 0, width, height);
            for (let i = 3; i < data.length; i += 4)
              if (data[i] !== 255) return true;
            return false;
          },
          encode(type, quality) {
            return new Promise((resolve) =>
              canvas.toBlob(resolve, type, quality),
            );
          },
          release() {
            // Frees the backing store now rather than at the next GC (Safari
            // caps the total canvas memory of a page).
            canvas.width = 0;
            canvas.height = 0;
          },
        };
      },
      release: image.release,
    };
  },
};

/**
 * Shrinking a picture before it is uploaded: the rules, and the codecs that
 * draw it. Pure enough to run in a Web Worker (reference-image.worker.ts):
 * nothing here touches the DOM at import time or imports @loomic/shared
 * (which would put zod in the worker). The page-side entry, with the API's
 * limits filled in, is reference-image.ts.
 *
 * Why: most of the time a slow upload is the user's network, not the
 * server. image.gguuai.com 2026-10-15/17: some users upload at 50–300 KB/s,
 * so a 1.6 MB picture took 8–37 s (and was given up on 3 times), while 25 KB
 * finished in 60 ms. Through 0.0.17 only pictures over 8 MB were shrunk; a
 * 3–6 MB phone photo went up byte for byte. Now anything bigger than it
 * needs to be is fitted inside 2048 px first: the server would send at most
 * that much detail on the way to the model anyway (xy2api-reference.ts
 * shrinkForSending, 3072 then 2048 px), masks are scaled to the picture on
 * the server (mask-edit.ts, MASK_MAX_EDGE 2048), and a 4032 px photo usually
 * goes from 3–6 MB to well under 1 MB.
 */

/** Long edge a reference is fitted inside (never enlarged). */
export const REFERENCE_EDGE = 2048;
/** Then smaller, while the encoded picture is still over the limit. */
const FALLBACK_EDGES = [1536, 1024];
/** Up to this, a picture goes up as it is, without being decoded. */
export const REFERENCE_KEEP_BYTES = 512 * 1024;
/** Up to this, a picture already inside REFERENCE_EDGE goes up as it is. */
export const REFERENCE_LIGHT_BYTES = 1.5 * 1024 * 1024;
/**
 * Most a reference may weigh: the server sends larger ones on shrunk again,
 * and pictures over it were refused before 0.0.17.
 */
export const REFERENCE_SEND_BYTES = 8 * 1024 * 1024;
/** Larger files are not decoded at all: a tab can run out of memory. */
export const REFERENCE_READ_MAX_BYTES = 50 * 1024 * 1024;
/** A re-encoded picture is only used when at most this share of the original. */
const WORTH_IT = 0.8;
const JPEG_QUALITY = 0.88;

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

/**
 * The codec cannot read this picture here (a worker without HEIC support,
 * say); the caller tries again with another codec instead of giving up.
 */
export class CodecUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodecUnavailableError";
  }
}

export type ShrinkReport = {
  fromBytes: number;
  fromType: string;
  fromWidth: number;
  fromHeight: number;
  toBytes: number;
  toType: string;
  toWidth: number;
  toHeight: number;
  /** Decoding and encoding, in milliseconds. */
  ms: number;
};

export type PreparedReference = {
  file: File;
  /** Set when the picture was re-encoded. */
  shrunk?: ShrinkReport;
};

export type PrepareLimits = {
  /** Most the API takes (UPLOAD_MAX_BYTES); a picture that cannot be shrunk is sent as it is up to this. */
  uploadMaxBytes: number;
  /** Most the result may weigh; REFERENCE_SEND_BYTES by default. */
  maxBytes?: number;
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
const now = () =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

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
 * The file to upload for a picture: as it is when it is already light,
 * else fitted inside REFERENCE_EDGE (then smaller while over `maxBytes`),
 * JPEG for photos and PNG when there is transparency. A re-encode that saves
 * little is dropped for the original. Throws ReferenceImageError when the
 * picture cannot be used (its message is for the user), and
 * CodecUnavailableError when `codec` cannot read it (try another codec).
 */
export async function shrinkReferenceImage(
  file: File,
  codec: ImageCodec,
  limits: PrepareLimits,
): Promise<PreparedReference> {
  const maxBytes = limits.maxBytes ?? REFERENCE_SEND_BYTES;
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
  // Light enough: not worth decoding.
  if (!convert && file.size <= Math.min(REFERENCE_KEEP_BYTES, maxBytes))
    return { file: relabel(file, type) };

  const originalFits = !convert && file.size <= maxBytes;
  // What to do when this browser cannot shrink it: the API takes it up to
  // uploadMaxBytes and the server shrinks it when it is sent.
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
    if (file.size <= limits.uploadMaxBytes) return { file: relabel(file, type) };
    throw new ReferenceImageError(
      "too_large",
      `图片超过 ${mb(limits.uploadMaxBytes)} MB，浏览器也没能把它压小，换一张小一点的`,
    );
  };

  const startedAt = now();
  let decoded: DecodedImage;
  try {
    decoded = await codec.decode(file);
  } catch (error) {
    if (error instanceof CodecUnavailableError) throw error;
    return unshrunk("could not decode", error);
  }
  let smallest = Number.POSITIVE_INFINITY;
  try {
    const longEdge = Math.max(decoded.width, decoded.height);
    // Already the right size and light: the original is as good.
    if (originalFits && longEdge <= REFERENCE_EDGE && file.size <= REFERENCE_LIGHT_BYTES)
      return { file: relabel(file, type) };

    for (const edge of [REFERENCE_EDGE, ...FALLBACK_EDGES]) {
      // Smaller edges only for a picture that is that big.
      if (edge !== REFERENCE_EDGE && edge >= longEdge) continue;
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
        if (blob.size > maxBytes) continue;
        const shrunk: ShrinkReport = {
          fromBytes: file.size,
          fromType: type,
          fromWidth: decoded.width,
          fromHeight: decoded.height,
          toBytes: blob.size,
          toType,
          toWidth: fitted.width,
          toHeight: fitted.height,
          ms: Math.round(now() - startedAt),
        };
        // Saved too little to be worth the re-encode (a PNG with
        // transparency at its own size, an already compressed photo).
        if (originalFits && blob.size > file.size * WORTH_IT) {
          console.info(
            `[reference-image] kept ${file.name} ${mb1(file.size)} MB ${type}: re-encoding saved only ${mb1(file.size - blob.size)} MB`,
          );
          return { file: relabel(file, type) };
        }
        console.info(
          `[reference-image] shrank ${file.name} ${mb1(shrunk.fromBytes)} MB ${type} ${shrunk.fromWidth}×${shrunk.fromHeight} to ${mb1(shrunk.toBytes)} MB ${toType} ${shrunk.toWidth}×${shrunk.toHeight} in ${shrunk.ms} ms`,
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
    if (error instanceof CodecUnavailableError) throw error;
    return unshrunk("could not shrink", error);
  } finally {
    decoded.release();
  }
  if (originalFits) return { file: relabel(file, type) };
  console.warn(
    `[reference-image] ${file.name} still ${mb1(smallest)} MB at the smallest size`,
  );
  throw new ReferenceImageError(
    "too_large",
    `图片压缩后仍超过 ${mb(maxBytes)} MB，换一张小一点的`,
  );
}

// ---------------------------------------------------------------------------
// Codecs
// ---------------------------------------------------------------------------

type Drawable = ImageBitmap | HTMLImageElement;

type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Draws `source` fitted inside `edge` on a canvas `make` returns. */
function fitOn(
  source: Drawable,
  width: number,
  height: number,
  edge: number,
  make: (w: number, h: number) => {
    canvas: HTMLCanvasElement | OffscreenCanvas;
    ctx: Context2D | null;
  },
  encodeWith: (
    canvas: HTMLCanvasElement | OffscreenCanvas,
    type: string,
    quality?: number,
  ) => Promise<Blob | null>,
): FittedImage {
  const scale = Math.min(1, edge / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const { canvas, ctx } = make(w, h);
  if (!ctx) throw new Error("no 2d canvas");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, w, h);
  return {
    width: w,
    height: h,
    hasTransparency() {
      const { data } = ctx.getImageData(0, 0, w, h);
      for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) return true;
      return false;
    },
    encode(type, quality) {
      return encodeWith(canvas, type, quality);
    },
    release() {
      // Frees the backing store now rather than at the next GC (Safari
      // caps the total canvas memory of a page).
      canvas.width = 0;
      canvas.height = 0;
    },
  };
}

/** A bitmap with EXIF orientation applied, as the server's sharp().rotate() does. */
function bitmapOf(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob, { imageOrientation: "from-image" });
}

async function decodeDrawable(blob: Blob): Promise<{
  source: Drawable;
  width: number;
  height: number;
  release(): void;
}> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await bitmapOf(blob);
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

/** On the page: createImageBitmap, or an <img> where that fails; a DOM canvas. */
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
      fit: (edge) =>
        fitOn(
          image.source,
          image.width,
          image.height,
          edge,
          (w, h) => {
            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            return { canvas, ctx: canvas.getContext("2d") };
          },
          (canvas, type, quality) =>
            new Promise((resolve) =>
              (canvas as HTMLCanvasElement).toBlob(resolve, type, quality),
            ),
        ),
      release: image.release,
    };
  },
};

/**
 * In a worker: createImageBitmap and an OffscreenCanvas, so decoding,
 * drawing, the transparency scan and encoding all stay off the page's
 * thread. A picture the worker cannot decode is CodecUnavailableError: the
 * page tries it with browserCodec (an <img> reads more than a bitmap does).
 */
export const offscreenCodec: ImageCodec = {
  async decode(blob) {
    let bitmap: ImageBitmap;
    try {
      bitmap = await bitmapOf(blob);
    } catch (error) {
      throw new CodecUnavailableError(
        `worker could not decode: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!bitmap.width || !bitmap.height) {
      bitmap.close();
      throw new CodecUnavailableError("worker decoded an empty picture");
    }
    return {
      width: bitmap.width,
      height: bitmap.height,
      fit: (edge) =>
        fitOn(
          bitmap,
          bitmap.width,
          bitmap.height,
          edge,
          (w, h) => {
            const canvas = new OffscreenCanvas(w, h);
            return { canvas, ctx: canvas.getContext("2d") };
          },
          (canvas, type, quality) =>
            (canvas as OffscreenCanvas).convertToBlob({
              type,
              ...(quality !== undefined ? { quality } : {}),
            }),
        ),
      release: () => bitmap.close(),
    };
  },
};

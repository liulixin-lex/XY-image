/**
 * The picture to upload for a reference (studio 参考图, the home prompt, the
 * chat panel) or a picture dropped on the canvas: shrunk first when it is
 * heavier than it needs to be, so it goes up in a fraction of the time. The
 * rules are in reference-image-core.ts; this adds the API's limits and runs
 * the work in a Web Worker where the browser can (reference-image.worker.ts),
 * on the page otherwise.
 *
 * History: through 0.0.16 the page refused anything over 10 MB, then offered
 * a 重试 that uploaded it anyway into the API's 10 MB limit and a bare 500
 * (image.gguuai.com, 2026-10-16/17: 17 of 48 uploads). 0.0.17 shrank
 * pictures over 8 MB. Now anything over what the model can use is shrunk.
 */
import { UPLOAD_MAX_BYTES } from "@loomic/shared";

import {
  type ImageCodec,
  type PreparedReference,
  REFERENCE_KEEP_BYTES,
  ReferenceImageError,
  browserCodec,
  shrinkReferenceImage,
} from "./reference-image-core";
import type { ShrinkRequest, ShrinkResponse } from "./reference-image.worker";

export * from "./reference-image-core";

export type PrepareOptions = {
  /** Most the result may weigh (REFERENCE_SEND_BYTES by default). */
  maxBytes?: number;
  /** Most that may go up unshrunk when shrinking fails (UPLOAD_MAX_BYTES by default). */
  uploadMaxBytes?: number;
};

function limitsOf(options: PrepareOptions) {
  return {
    uploadMaxBytes: options.uploadMaxBytes ?? UPLOAD_MAX_BYTES,
    ...(options.maxBytes !== undefined ? { maxBytes: options.maxBytes } : {}),
  };
}

/** On the page's thread (tests pass a codec; jsdom has no canvas). */
export function prepareReferenceImage(
  file: File,
  codec: ImageCodec = browserCodec,
  options: PrepareOptions = {},
): Promise<PreparedReference> {
  return shrinkReferenceImage(file, codec, limitsOf(options));
}

// ---------------------------------------------------------------------------
// The worker
// ---------------------------------------------------------------------------

/** A picture taking longer than this in the worker is done on the page. */
const WORKER_TIMEOUT_MS = 30_000;

type Pending = {
  resolve: (response: ShrinkResponse) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** undefined: not started yet; null: not available in this browser (or failed). */
let worker: Worker | null | undefined;
let nextId = 1;
const pending = new Map<number, Pending>();

function workerSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof Worker === "function" &&
    typeof OffscreenCanvas === "function" &&
    typeof createImageBitmap === "function"
  );
}

/** Stops a worker that failed or hung; what it held is done on the page. */
function retire(failed: Worker, reason: string) {
  if (worker === failed) worker = null;
  failed.terminate();
  for (const [id, entry] of pending) {
    clearTimeout(entry.timer);
    entry.resolve({ id, kind: "fallback", reason });
  }
  pending.clear();
}

function shrinkWorker(): Worker | null {
  if (worker !== undefined) return worker;
  if (!workerSupported()) {
    worker = null;
    return null;
  }
  try {
    const started = new Worker(
      new URL("./reference-image.worker.ts", import.meta.url),
    );
    started.onmessage = (event: MessageEvent<ShrinkResponse>) => {
      const entry = pending.get(event.data.id);
      if (!entry) return;
      pending.delete(event.data.id);
      clearTimeout(entry.timer);
      entry.resolve(event.data);
    };
    started.onerror = (event) => {
      console.warn(
        "[reference-image] worker failed, shrinking on the page from now on",
        event.message,
      );
      retire(started, "worker failed");
    };
    worker = started;
  } catch (error) {
    console.info("[reference-image] no worker, shrinking on the page", error);
    worker = null;
  }
  return worker;
}

function askWorker(target: Worker, request: Omit<ShrinkRequest, "id">) {
  const id = nextId++;
  return new Promise<ShrinkResponse>((resolve) => {
    const timer = setTimeout(() => {
      console.warn(
        `[reference-image] worker took over ${WORKER_TIMEOUT_MS / 1000} s on ${request.file.name}, restarting on the page`,
      );
      retire(target, "worker timed out");
    }, WORKER_TIMEOUT_MS);
    pending.set(id, { resolve, timer });
    try {
      target.postMessage({ id, ...request } satisfies ShrinkRequest);
    } catch (error) {
      pending.delete(id);
      clearTimeout(timer);
      resolve({ id, kind: "fallback", reason: String(error) });
    }
  });
}

/**
 * The file to upload for a picture, shrunk in a worker when the browser has
 * one that can draw (OffscreenCanvas), on the page otherwise or when the
 * worker cannot read the picture. Throws ReferenceImageError when the
 * picture cannot be used (its message is for the user).
 */
export async function prepareReferenceImageInBackground(
  file: File,
  options: PrepareOptions = {},
): Promise<PreparedReference> {
  const limits = limitsOf(options);
  // Light pictures are not decoded at all: no worker needed.
  const light = file.size <= Math.min(REFERENCE_KEEP_BYTES, limits.maxBytes ?? Number.POSITIVE_INFINITY);
  const target = light ? null : shrinkWorker();
  if (target) {
    const response = await askWorker(target, { file, limits });
    switch (response.kind) {
      case "same":
        return { file };
      case "file":
        return {
          file: new File([response.blob], response.name, {
            type: response.type,
            lastModified: file.lastModified,
          }),
          ...(response.shrunk ? { shrunk: response.shrunk } : {}),
        };
      case "refused":
        throw new ReferenceImageError(response.problem, response.message);
      case "fallback":
        console.info(
          `[reference-image] ${file.name} shrunk on the page instead: ${response.reason}`,
        );
    }
  }
  return shrinkReferenceImage(file, browserCodec, limits);
}

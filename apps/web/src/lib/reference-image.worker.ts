/**
 * Shrinks pictures off the page's thread (reference-image.ts starts it).
 * Decoding a 4032 px photo, drawing it, scanning it for transparency and
 * encoding it takes a few hundred milliseconds; here the page keeps
 * scrolling and the upload ring keeps turning meanwhile.
 *
 * Anything this worker cannot do (a picture its bitmap decoder refuses, an
 * unexpected error) is answered with `fallback`, and the page shrinks that
 * picture itself.
 */
import {
  type PrepareLimits,
  ReferenceImageError,
  type ReferenceImageProblem,
  type ShrinkReport,
  offscreenCodec,
  shrinkReferenceImage,
} from "./reference-image-core";

export type ShrinkRequest = { id: number; file: File; limits: PrepareLimits };

export type ShrinkResponse =
  | { id: number; kind: "same" }
  | {
      id: number;
      kind: "file";
      blob: Blob;
      name: string;
      type: string;
      shrunk?: ShrinkReport;
    }
  | { id: number; kind: "refused"; problem: ReferenceImageProblem; message: string }
  | { id: number; kind: "fallback"; reason: string };

// The DOM lib types `self` as a Window; a dedicated worker only needs these.
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<ShrinkRequest>) => void) | null;
  postMessage(message: ShrinkResponse): void;
};

scope.onmessage = (event) => {
  const { id, file, limits } = event.data;
  void shrinkReferenceImage(file, offscreenCodec, limits).then(
    (prepared) => {
      if (prepared.file === file) {
        scope.postMessage({ id, kind: "same" });
        return;
      }
      scope.postMessage({
        id,
        kind: "file",
        blob: prepared.file,
        name: prepared.file.name,
        type: prepared.file.type,
        ...(prepared.shrunk ? { shrunk: prepared.shrunk } : {}),
      });
    },
    (error: unknown) => {
      if (error instanceof ReferenceImageError) {
        scope.postMessage({
          id,
          kind: "refused",
          problem: error.problem,
          message: error.message,
        });
        return;
      }
      scope.postMessage({
        id,
        kind: "fallback",
        reason: error instanceof Error ? error.message : String(error),
      });
    },
  );
};

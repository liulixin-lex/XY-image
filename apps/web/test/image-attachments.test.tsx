// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  UPLOAD_CONCURRENCY,
  attachmentsBlocker,
  attachmentsProgress,
  useImageAttachments,
  useSendWhenUploaded,
} from "../src/hooks/use-image-attachments";
import { ReferenceImageError } from "../src/lib/reference-image";
import { ApiApplicationError, UploadStalledError } from "../src/lib/server-api";

const { uploadFileMock, prepareMock } = vi.hoisted(() => ({
  uploadFileMock: vi.fn(),
  prepareMock: vi.fn(),
}));

vi.mock("../src/lib/server-api", async () => ({
  ...(await vi.importActual<typeof import("../src/lib/server-api")>(
    "../src/lib/server-api",
  )),
  uploadFileWithProgress: uploadFileMock,
}));

vi.mock("../src/lib/reference-image", async () => ({
  ...(await vi.importActual<typeof import("../src/lib/reference-image")>(
    "../src/lib/reference-image",
  )),
  prepareReferenceImageInBackground: prepareMock,
}));

type UploadOptions = {
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
  clientInfo?: { originalBytes?: number };
};

/** An upload the test finishes by hand, with its progress callback. */
function controllableUpload() {
  const calls: Array<{
    options: UploadOptions;
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
  }> = [];
  uploadFileMock.mockImplementation(
    (_token: string, _file: File, options: UploadOptions) =>
      new Promise((resolve, reject) => {
        calls.push({ options, resolve, reject });
        options.signal?.addEventListener("abort", () =>
          reject(new DOMException("upload aborted", "AbortError")),
        );
      }),
  );
  return calls;
}

const uploaded = (id: string) => ({
  asset: { id },
  url: `https://image.example/supabase/storage/v1/object/public/project-assets/ws/${id}.png`,
});

function setup() {
  const onReject = vi.fn();
  const hook = renderHook(() =>
    useImageAttachments("token_abc", undefined, { onReject }),
  );
  return { ...hook, onReject };
}

const png = (name = "ref.png") =>
  new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, {
    type: "image/png",
  });

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  prepareMock.mockImplementation(async (file: File) => ({ file }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  uploadFileMock.mockReset();
  prepareMock.mockReset();
});

describe("useImageAttachments", () => {
  it("uploads the prepared picture and offers it to the next message", async () => {
    const shrunk = new File([new Uint8Array(4)], "ref.jpg", {
      type: "image/jpeg",
    });
    prepareMock.mockResolvedValue({ file: shrunk });
    uploadFileMock.mockResolvedValue(uploaded("asset-1"));
    const { result } = setup();

    act(() => result.current.addFiles([png()]));
    expect(result.current.isUploading).toBe(true);
    expect(attachmentsBlocker(result.current.attachments)?.tone).toBe("wait");

    await waitFor(() =>
      expect(result.current.readyAttachments).toHaveLength(1),
    );
    expect(uploadFileMock).toHaveBeenCalledWith(
      "token_abc",
      shrunk,
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        clientInfo: expect.objectContaining({ originalBytes: 4 }),
      }),
    );
    expect(result.current.readyAttachments[0]).toMatchObject({
      assetId: "asset-1",
      mimeType: "image/jpeg",
      source: "upload",
    });
    expect(attachmentsBlocker(result.current.attachments)).toBeNull();
  });

  // image.gguuai.com 2026-10-16/17: a picture refused as too large showed
  // 重试, which uploaded it anyway into a bare 500, six times in a row.
  it("says why a picture cannot be used and offers no retry", async () => {
    prepareMock.mockRejectedValue(
      new ReferenceImageError(
        "too_large",
        "图片压缩后仍超过 8 MB，换一张小一点的",
      ),
    );
    const { result, onReject } = setup();

    act(() => result.current.addFiles([png("huge.png")]));
    await waitFor(() => expect(result.current.isUploading).toBe(false));
    const [att] = result.current.attachments;
    expect(att).toMatchObject({
      error: "图片压缩后仍超过 8 MB，换一张小一点的",
      retryable: false,
      preview: "blob:preview",
    });
    expect(onReject).toHaveBeenCalledWith(
      "图片压缩后仍超过 8 MB，换一张小一点的",
    );

    act(() => result.current.retryUpload(att?.id ?? ""));
    expect(prepareMock).toHaveBeenCalledTimes(1);
    expect(uploadFileMock).not.toHaveBeenCalled();
    expect(attachmentsBlocker(result.current.attachments)).toEqual({
      tone: "alert",
      message: "图片压缩后仍超过 8 MB，换一张小一点的（移除这张图片就能发送）",
    });
  });

  it("treats the API's 413 as final, not as something to retry", async () => {
    uploadFileMock.mockRejectedValue(
      new ApiApplicationError(
        "file_too_large",
        "图片超过 19 MB，换一张小一点的",
        413,
      ),
    );
    const { result } = setup();
    act(() => result.current.addFiles([png()]));
    await waitFor(() =>
      expect(result.current.attachments[0]?.error).toBeDefined(),
    );
    expect(result.current.attachments[0]).toMatchObject({
      error: "图片超过 19 MB，换一张小一点的",
      retryable: false,
    });
  });

  it("retries a failed upload through the same checks, then attaches it", async () => {
    uploadFileMock
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(uploaded("asset-2"));
    const { result, onReject } = setup();

    act(() => result.current.addFiles([png()]));
    await waitFor(() =>
      expect(result.current.attachments[0]).toMatchObject({
        error: "上传失败，点击重试",
        retryable: true,
      }),
    );
    expect(onReject).toHaveBeenCalledWith(
      "图片没传上去，可以点图片上的「重试」",
    );
    expect(attachmentsBlocker(result.current.attachments)?.message).toContain(
      "重试",
    );
    expect(result.current.readyAttachments).toEqual([]);

    act(() =>
      result.current.retryUpload(result.current.attachments[0]?.id ?? ""),
    );
    await waitFor(() =>
      expect(result.current.readyAttachments).toHaveLength(1),
    );
    expect(prepareMock).toHaveBeenCalledTimes(2);
    expect(result.current.attachments[0]?.error).toBeUndefined();
  });

  it("refuses a file that is clearly not a usable picture without adding it", () => {
    const { result, onReject } = setup();
    act(() =>
      result.current.addFiles([
        new File([new Uint8Array(4)], "a.gif", { type: "image/gif" }),
      ]),
    );
    expect(result.current.attachments).toEqual([]);
    expect(onReject).toHaveBeenCalledWith("只支持 PNG、JPEG、WebP 格式的图片");
    expect(prepareMock).not.toHaveBeenCalled();
  });

  // The chat panel's send handler depends on it: a new array on every
  // render re-created the handler, and the first message's effect with it.
  it("keeps readyAttachments the same array while nothing changes", async () => {
    uploadFileMock.mockResolvedValue(uploaded("asset-3"));
    const { result, rerender } = setup();
    act(() => result.current.addFiles([png()]));
    await waitFor(() =>
      expect(result.current.readyAttachments).toHaveLength(1),
    );
    const before = result.current.readyAttachments;
    rerender();
    expect(result.current.readyAttachments).toBe(before);
  });
  // Through 0.0.17 the whole upload showed one 8 px dot and 「图片还在上传」,
  // for 10–37 s on a slow line: it read as stuck.
  it("says how far a picture has got: shrinking, then the upload's real progress", async () => {
    const uploads = controllableUpload();
    const { result } = setup();
    act(() => result.current.addFiles([png()]));
    expect(result.current.attachments[0]?.phase).toBe("preparing");
    expect(attachmentsBlocker(result.current.attachments)?.message).toBe(
      "正在压缩图片，传完就能发送",
    );

    await waitFor(() => expect(uploads).toHaveLength(1));
    await waitFor(() =>
      expect(result.current.attachments[0]?.phase).toBe("uploading"),
    );
    act(() => uploads[0]?.options.onProgress?.(0.42));
    expect(result.current.attachments[0]?.progress).toBeCloseTo(0.42);
    expect(attachmentsProgress(result.current.attachments)).toMatchObject({
      active: 1,
      phase: "uploading",
      percent: 42,
    });
    expect(
      attachmentsBlocker(result.current.attachments, "发送", { queued: true })
        ?.message,
    ).toBe("图片上传中 42%，传完自动发送");

    act(() => uploads[0]?.resolve(uploaded("asset-p")));
    await waitFor(() => expect(result.current.isUploading).toBe(false));
    expect(result.current.attachments[0]).toMatchObject({
      assetId: "asset-p",
      uploadedAt: expect.any(Number),
    });
    expect(result.current.attachments[0]?.phase).toBeUndefined();
  });

  it(`uploads at most ${UPLOAD_CONCURRENCY} pictures at a time`, async () => {
    const uploads = controllableUpload();
    const { result } = setup();
    act(() => result.current.addFiles([png("a.png"), png("b.png"), png("c.png")]));
    await waitFor(() => expect(uploads).toHaveLength(UPLOAD_CONCURRENCY));
    expect(result.current.attachments.map((a) => a.phase)).toEqual([
      "uploading",
      "uploading",
      "queued",
    ]);

    act(() => uploads[0]?.resolve(uploaded("asset-a")));
    await waitFor(() => expect(uploads).toHaveLength(3));
    act(() => {
      uploads[1]?.resolve(uploaded("asset-b"));
      uploads[2]?.resolve(uploaded("asset-c"));
    });
    await waitFor(() =>
      expect(result.current.readyAttachments).toHaveLength(3),
    );
  });

  it("stops the upload of a picture removed on its way, without a complaint", async () => {
    const uploads = controllableUpload();
    const { result, onReject } = setup();
    act(() => result.current.addFiles([png()]));
    await waitFor(() => expect(uploads).toHaveLength(1));

    act(() =>
      result.current.removeAttachment(result.current.attachments[0]?.id ?? ""),
    );
    expect(uploads[0]?.options.signal?.aborted).toBe(true);
    expect(result.current.attachments).toEqual([]);
    await new Promise((r) => setTimeout(r, 0));
    expect(onReject).not.toHaveBeenCalled();
  });

  it("offers a retry when the upload stopped moving", async () => {
    uploadFileMock.mockRejectedValue(new UploadStalledError());
    const { result } = setup();
    act(() => result.current.addFiles([png()]));
    await waitFor(() =>
      expect(result.current.attachments[0]).toMatchObject({
        error: "网络太慢，上传停住了，点击重试",
        retryable: true,
      }),
    );
  });
});

describe("useSendWhenUploaded", () => {
  const uploading = { id: "a", preview: "", uploading: true, mimeType: "image/png", source: "upload" as const };
  const done = { ...uploading, uploading: false, assetId: "x", url: "u" };
  const failed = { ...uploading, uploading: false, error: "上传失败，点击重试", retryable: true };

  it("sends once the pictures are up when 发送 was pressed during the upload", () => {
    const send = vi.fn();
    const { result, rerender } = renderHook(
      ({ attachments }) => useSendWhenUploaded(attachments, send),
      { initialProps: { attachments: [uploading] as never[] } },
    );
    act(() => result.current.queue());
    expect(result.current.queued).toBe(true);
    expect(send).not.toHaveBeenCalled();

    rerender({ attachments: [done] as never[] });
    expect(send).toHaveBeenCalledTimes(1);
    expect(result.current.queued).toBe(false);
  });

  it("drops the waiting send when a picture fails, and can be canceled", () => {
    const send = vi.fn();
    const { result, rerender } = renderHook(
      ({ attachments }) => useSendWhenUploaded(attachments, send),
      { initialProps: { attachments: [uploading] as never[] } },
    );
    act(() => result.current.queue());
    rerender({ attachments: [failed] as never[] });
    expect(send).not.toHaveBeenCalled();
    expect(result.current.queued).toBe(false);

    rerender({ attachments: [uploading] as never[] });
    act(() => result.current.queue());
    act(() => result.current.cancel());
    rerender({ attachments: [done] as never[] });
    expect(send).not.toHaveBeenCalled();
  });
});

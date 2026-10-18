// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiApplicationError,
  ApiAuthError,
  UploadStalledError,
  uploadFileWithProgress,
} from "../src/lib/server-api";

// Through 0.0.17 attachments went up with fetch(), which cannot report
// upload progress: a 10–37 s upload on a slow line showed nothing moving.

type Listener = ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null;

class FakeXhr {
  static last: FakeXhr | null = null;
  upload: { onprogress: Listener; onload: (() => void) | null } = {
    onprogress: null,
    onload: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  status = 0;
  responseText = "";
  method = "";
  url = "";
  headers: Record<string, string> = {};
  body: FormData | null = null;
  aborted = false;
  private responseHeaders: Record<string, string> = {};
  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  getResponseHeader(name: string) {
    return this.responseHeaders[name] ?? null;
  }
  send(body: FormData) {
    this.body = body;
  }
  abort() {
    this.aborted = true;
  }
  // Test controls
  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total });
  }
  respond(status: number, body: unknown, headers: Record<string, string> = {}) {
    this.upload.onload?.();
    this.status = status;
    this.responseText = typeof body === "string" ? body : JSON.stringify(body);
    this.responseHeaders = headers;
    this.onload?.();
  }
}

const picture = () =>
  new File([new Uint8Array(2048)], "ref.jpg", { type: "image/jpeg" });

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SERVER_BASE_URL", "http://localhost:3001");
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  FakeXhr.last = null;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("uploadFileWithProgress", () => {
  it("reports progress and sends the fields the API logs before the file", async () => {
    const onProgress = vi.fn();
    const done = uploadFileWithProgress("token_abc", picture(), {
      projectId: "p1",
      onProgress,
      clientInfo: { originalBytes: 3_400_000, prepMs: 180 },
    });
    const xhr = FakeXhr.last as FakeXhr;
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe("http://localhost:3001/api/uploads");
    expect(xhr.headers.Authorization).toBe("Bearer token_abc");
    expect([...(xhr.body?.keys() ?? [])]).toEqual([
      "projectId",
      "clientOriginalBytes",
      "clientPrepMs",
      "file",
    ]);

    xhr.progress(512, 2048);
    expect(onProgress).toHaveBeenLastCalledWith(0.25);
    xhr.respond(201, { asset: { id: "a1" }, url: "https://x/a1.jpg" });
    await expect(done).resolves.toMatchObject({ asset: { id: "a1" } });
    expect(onProgress).toHaveBeenLastCalledWith(1);
  });

  it("maps the API's answers like every other call", async () => {
    const tooLarge = uploadFileWithProgress("t", picture());
    (FakeXhr.last as FakeXhr).respond(413, {
      error: { code: "file_too_large", message: "图片超过 19 MB，换一张小一点的" },
    });
    await expect(tooLarge).rejects.toMatchObject({
      constructor: ApiApplicationError,
      code: "file_too_large",
      status: 413,
    });

    const expired = uploadFileWithProgress("t", picture());
    (FakeXhr.last as FakeXhr).respond(401, { error: { code: "unauthorized" } });
    await expect(expired).rejects.toBeInstanceOf(ApiAuthError);
  });

  it("fails like fetch on a network error", async () => {
    const failed = uploadFileWithProgress("t", picture());
    (FakeXhr.last as FakeXhr).onerror?.();
    await expect(failed).rejects.toBeInstanceOf(TypeError);
  });

  it("stops when the picture is removed", async () => {
    const controller = new AbortController();
    const going = uploadFileWithProgress("t", picture(), { signal: controller.signal });
    controller.abort();
    await expect(going).rejects.toMatchObject({ name: "AbortError" });
    expect(FakeXhr.last?.aborted).toBe(true);
  });

  it("gives up when the upload stops moving instead of spinning forever", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const going = uploadFileWithProgress("t", picture(), { stallMs: 5_000 });
    const outcome = going.catch((error: unknown) => error);
    const xhr = FakeXhr.last as FakeXhr;
    vi.advanceTimersByTime(3_000);
    xhr.progress(100, 2048); // still moving
    vi.advanceTimersByTime(4_000);
    expect(xhr.aborted).toBe(false);
    vi.advanceTimersByTime(2_000);
    expect(await outcome).toBeInstanceOf(UploadStalledError);
    expect(xhr.aborted).toBe(true);
  });
});

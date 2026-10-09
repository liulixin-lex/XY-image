// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchJobMock, fetchJobsMock } = vi.hoisted(() => ({
  fetchJobMock: vi.fn(),
  fetchJobsMock: vi.fn(),
}));

vi.mock("../src/lib/server-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/server-api")>()),
  fetchJob: fetchJobMock,
  fetchJobs: fetchJobsMock,
}));

import { useJobFallbackPolling } from "../src/hooks/use-job-fallback-polling";
import { resetStoredFiles } from "../src/lib/canvas-files";
import { buildCanvasSavePayload } from "../src/lib/canvas-save";
import { saveCanvas } from "../src/lib/server-api";

// Agent images that finish after the agent stopped waiting are placed by the
// worker; the page polls the job, then merges the canvas in. Saves tell the
// server which placed images the user deleted, so it keeps the others.

describe("buildCanvasSavePayload", () => {
  it("sends live elements, and only deleted placed images as ids", () => {
    resetStoredFiles("c1", ["f1"]);
    const payload = buildCanvasSavePayload(
      "c1",
      [
        { id: "r1", type: "rectangle" },
        { id: "r2", type: "rectangle", isDeleted: true },
        {
          id: "img-1",
          type: "image",
          isDeleted: true,
          customData: { jobId: "job-1" },
        },
        { id: "img-2", type: "image", customData: { jobId: "job-2" } },
      ],
      {
        viewBackgroundColor: "#fff",
        gridModeEnabled: false,
        zoom: { value: 2 },
      } as never,
      {
        f1: {
          id: "f1",
          dataURL: "data:image/png;base64,cG5n",
          mimeType: "image/png",
        },
      },
    );
    expect(payload.content.elements.map((el) => el.id)).toEqual([
      "r1",
      "img-2",
    ]);
    expect(payload.content.appState).toEqual({
      viewBackgroundColor: "#fff",
      gridModeEnabled: false,
    });
    expect(payload.content.files.f1?.dataURL).toBeUndefined();
    expect(payload.deletedElementIds).toEqual(["img-1"]);
    expect(payload.sentWithData).toEqual([]);
  });
});

describe("saveCanvas", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("sends the deleted placed images with the content", async () => {
    vi.stubEnv("NEXT_PUBLIC_SERVER_BASE_URL", "http://localhost:3001");
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({ ok: true, missingFileIds: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const content = { elements: [], appState: {}, files: {} };
    await saveCanvas("token", "c1", content, []);
    await saveCanvas("token", "c1", content, ["img-1"]);
    const bodies = fetchMock.mock.calls.map(([, init]) =>
      JSON.parse(String(init?.body)),
    );
    expect(bodies[0]).toEqual({ content, deletedElementIds: [] });
    expect(bodies[1]).toEqual({ content, deletedElementIds: ["img-1"] });
  });
});

describe("useJobFallbackPolling", () => {
  const completed = (output: Record<string, unknown>) =>
    ({
      type: "tool.completed",
      runId: "run-1",
      toolCallId: "call-1",
      toolName: "generate_image",
      timestamp: "2026-10-09T00:00:00Z",
      output,
    }) as never;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function setup() {
    const onJobSucceeded = vi.fn();
    const { result } = renderHook(() =>
      useJobFallbackPolling({
        onJobSucceeded,
        accessTokenRef: { current: "tok" },
      }),
    );
    return {
      check: result.current.checkForTimedOutJobs,
      watch: result.current.watchCanvasJobs,
      onJobSucceeded,
    };
  }

  it("waits out storage retries past the timeout limit, then syncs the canvas", async () => {
    fetchJobMock.mockResolvedValue({
      job: { status: "queued", job_type: "image_generation" },
    });
    const { check, onJobSucceeded } = setup();
    check(
      completed({
        error: "图片已生成，正在保存",
        pending: "storage",
        jobId: "job-1",
        jobType: "image_generation",
      }),
    );

    await act(() => vi.advanceTimersByTimeAsync(14_000));
    expect(fetchJobMock).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(30 * 60_000));
    const polls = fetchJobMock.mock.calls.length;
    expect(polls).toBeGreaterThanOrEqual(120);
    expect(polls).toBeLessThanOrEqual(121);

    fetchJobMock.mockResolvedValue({
      job: {
        status: "succeeded",
        job_type: "image_generation",
        result: { element_id: "el-1" },
      },
    });
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    expect(onJobSucceeded).toHaveBeenCalledWith("job-1", "image_generation");
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(fetchJobMock.mock.calls.length).toBe(polls + 1);
  });

  it("gives up on storage retries after 90 minutes", async () => {
    fetchJobMock.mockResolvedValue({ job: { status: "queued" } });
    const { check } = setup();
    check(completed({ error: "saving", pending: "storage", jobId: "job-1" }));
    await act(() => vi.advanceTimersByTimeAsync(95 * 60_000));
    const polls = fetchJobMock.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(10 * 60_000));
    expect(fetchJobMock.mock.calls.length).toBe(polls);
    expect(polls).toBeLessThanOrEqual(361);
  });

  it("keeps the 5 s / 10 min polling for agent timeouts", async () => {
    fetchJobMock.mockResolvedValue({ job: { status: "running" } });
    const { check } = setup();
    check(completed({ error: "Job timed out after 300s", jobId: "job-1" }));
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(fetchJobMock).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(15 * 60_000));
    expect(fetchJobMock.mock.calls.length).toBeLessThanOrEqual(121);
  });

  it("does not poll failed jobs or results without a job id", async () => {
    const { check } = setup();
    check(
      completed({
        error: "Image generation failed: upstream 500",
        jobId: "job-1",
      }),
    );
    check(completed({ error: "saving", pending: "storage" }));
    check(completed({ summary: "Generated image", jobId: "job-1" }));
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(fetchJobMock).not.toHaveBeenCalled();
  });

  it("watches this canvas's image jobs still on their way (reload, stopped run)", async () => {
    const job = (id: string, extra: Record<string, unknown>) => ({
      id,
      job_type: "image_generation",
      canvas_id: "canvas-1",
      status: "running",
      error_code: null,
      ...extra,
    });
    fetchJobsMock.mockResolvedValue({
      jobs: [
        job("running", {}),
        job("held", { status: "queued", error_code: "storage_retrying" }),
        job("done", { status: "succeeded" }),
        job("other-canvas", { canvas_id: "canvas-2" }),
      ],
    });
    fetchJobMock.mockResolvedValue({ job: { status: "running" } });
    const { watch } = setup();

    let watched = 0;
    await act(async () => {
      watched = await watch("canvas-1");
    });
    expect(watched).toBe(2);
    expect(fetchJobsMock).toHaveBeenCalledWith("tok", {
      jobType: "image_generation",
    });

    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(fetchJobMock.mock.calls.map(([, id]) => id)).toEqual(["running"]);
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    const polled = new Set(fetchJobMock.mock.calls.map(([, id]) => id));
    expect([...polled].sort()).toEqual(["held", "running"]);

    // Watching again does not start a second poll for the same job.
    await act(async () => {
      await watch("canvas-1");
    });
    fetchJobMock.mockClear();
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(fetchJobMock.mock.calls.map(([, id]) => id)).toEqual(["running"]);
  });

  it("after a run ends, watches only the jobs created before it ended", async () => {
    const job = (id: string, created_at: string) => ({
      id,
      job_type: "image_generation",
      canvas_id: "canvas-1",
      status: "running",
      error_code: null,
      created_at,
    });
    fetchJobsMock.mockResolvedValue({
      jobs: [
        job("stopped-run", "2026-10-09T10:00:00Z"),
        job("next-run", "2026-10-09T10:00:05Z"),
      ],
    });
    fetchJobMock.mockResolvedValue({ job: { status: "running" } });
    const { watch } = setup();

    let watched = 0;
    await act(async () => {
      watched = await watch("canvas-1", {
        createdBefore: Date.parse("2026-10-09T10:00:03Z"),
      });
    });
    expect(watched).toBe(1);
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(fetchJobMock.mock.calls.map(([, id]) => id)).toEqual([
      "stopped-run",
    ]);
  });
});

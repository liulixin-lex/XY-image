// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createImageJobMock, fetchJobsMock, reportMock, reportCodeMock, notifyMock } = vi.hoisted(
  () => ({
    createImageJobMock: vi.fn(),
    fetchJobsMock: vi.fn(),
    reportMock: vi.fn(() => ({ title: "x" })),
    reportCodeMock: vi.fn(),
    notifyMock: vi.fn(),
  }),
);

vi.mock("../src/lib/server-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/server-api")>()),
  createImageJob: createImageJobMock,
  fetchJobs: fetchJobsMock,
  cancelJob: vi.fn(),
}));

vi.mock("../src/lib/auth-context", () => ({
  useAuth: () => ({ session: { access_token: "tok", user: { id: "u1" } } }),
}));

vi.mock("../src/lib/account-context", () => ({
  useAccount: () => ({ notifyGenerationSettled: notifyMock, refreshImageModels: vi.fn() }),
}));

vi.mock("../src/components/issues/issue-provider", () => ({
  useIssues: () => ({ report: reportMock, reportCode: reportCodeMock }),
}));

import { useStudioJobs } from "../src/hooks/use-studio-jobs";
import { ApiApplicationError } from "../src/lib/server-api";

const INPUT = { prompt: "灯塔", model: "gpt-image-2", quality: "standard" as const };

function job(status: string, extra: Record<string, unknown> = {}) {
  return {
    id: "job_1",
    job_type: "image_generation",
    status,
    payload: { prompt: "灯塔", model: "gpt-image-2", quality: "standard" },
    result: null,
    error_code: null,
    error_message: null,
    billing_status: "pending",
    created_at: "2026-10-07T10:00:00Z",
    ...extra,
  };
}

describe("useStudioJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchJobsMock.mockResolvedValue({ jobs: [] });
  });

  afterEach(() => cleanup());

  it("sends a failed submit exactly once and reports it instead of retrying", async () => {
    createImageJobMock.mockRejectedValue(
      new ApiApplicationError("upstream_unknown", "状态未知", 502),
    );
    const { result } = renderHook(() => useStudioJobs());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let ok = true;
    await act(async () => {
      ok = await result.current.submit(INPUT);
    });

    expect(ok).toBe(false);
    expect(createImageJobMock).toHaveBeenCalledTimes(1);
    expect(reportMock).toHaveBeenCalledTimes(1);
  });

  it("ignores a second click while the first submit is in flight", async () => {
    let resolve!: (value: unknown) => void;
    createImageJobMock.mockImplementation(() => new Promise((r) => (resolve = r)));
    const { result } = renderHook(() => useStudioJobs());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = result.current.submit(INPUT);
      second = result.current.submit(INPUT);
    });
    await act(async () => {
      resolve({ job: job("queued") });
      await first;
    });

    expect(await second).toBe(false);
    expect(createImageJobMock).toHaveBeenCalledTimes(1);
  });

  it("does not re-send anything when remounted", async () => {
    const first = renderHook(() => useStudioJobs());
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();
    const second = renderHook(() => useStudioJobs());
    await waitFor(() => expect(second.result.current.loading).toBe(false));

    expect(createImageJobMock).not.toHaveBeenCalled();
  });

  it("refreshes the balance and reports once when a session job fails", async () => {
    createImageJobMock.mockResolvedValue({ job: job("queued") });
    const { result } = renderHook(() => useStudioJobs());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.submit(INPUT);
    });

    fetchJobsMock.mockResolvedValue({
      jobs: [job("dead_letter", { error_code: "insufficient_balance", billing_status: "not_charged" })],
    });
    await act(async () => {
      await result.current.reload();
    });
    await act(async () => {
      await result.current.reload();
    });

    expect(reportCodeMock).toHaveBeenCalledTimes(1);
    expect(reportCodeMock).toHaveBeenCalledWith("insufficient_balance", null);
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(createImageJobMock).toHaveBeenCalledTimes(1);
  });
});

// @vitest-environment jsdom
/**
 * 设置 › 生成记录 (第 58 条): pages and totals come from the server, the
 * page size is remembered, rows still running cannot be selected, and a
 * deleted record can be brought back from the toast.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchJobsMock, deleteJobsMock, restoreJobsMock } = vi.hoisted(() => ({
  fetchJobsMock: vi.fn(),
  deleteJobsMock: vi.fn(),
  restoreJobsMock: vi.fn(),
}));

vi.mock("../src/lib/auth-context", () => ({
  useAuth: () => ({ session: { access_token: "token-1" } }),
}));

vi.mock("../src/lib/account-context", () => ({
  useAccount: () => ({ account: { data: { links: { usage: "https://main.example/usage" } } } }),
  useImageModels: () => ({ data: [] }),
}));

vi.mock("../src/lib/server-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/server-api")>()),
  fetchJobs: fetchJobsMock,
  deleteJobs: deleteJobsMock,
  restoreJobs: restoreJobsMock,
}));

import { RecordsTab } from "../src/components/settings/records-tab";
import { ToastProvider } from "../src/components/toast";

function job(index: number, status = "succeeded", extra: Record<string, unknown> = {}) {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    job_type: "image_generation",
    status,
    payload: { prompt: `第 ${index} 张`, model: "gpt-image-2", resolution: "1K", quality: "auto" },
    result: status === "succeeded" ? { signed_url: `https://media.example/${index}.png`, asset_id: `a${index}` } : null,
    error_code: null,
    error_message: null,
    billing_status: status === "succeeded" ? "charged" : "none",
    created_at: `2026-10-12T10:${String(59 - index).padStart(2, "0")}:00Z`,
    ...extra,
  };
}

function page(rows: ReturnType<typeof job>[], total: number) {
  return { jobs: rows, next_before: null, total, counts: { all: total, reconcile: 1, failed: 3 } };
}

function renderTab() {
  return render(
    <ToastProvider>
      <RecordsTab />
    </ToastProvider>,
  );
}

describe("RecordsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });
  afterEach(() => cleanup());

  it("pages through the server's totals and remembers the page size", async () => {
    fetchJobsMock.mockResolvedValue(page([job(1), job(2)], 45));
    renderTab();
    await screen.findByText("第 1 张");
    expect(fetchJobsMock).toHaveBeenCalledTimes(1);
    expect(fetchJobsMock).toHaveBeenLastCalledWith("token-1", {
      jobType: "image_generation",
      limit: 20,
      offset: 0,
      withTotal: true,
    });
    expect(screen.getByRole("radio", { name: "全部 45" })).toBeInTheDocument();
    expect(screen.getByText("第 1–20 条，共 45 条")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "第 3 页" }));
    await waitFor(() =>
      expect(fetchJobsMock).toHaveBeenLastCalledWith("token-1", expect.objectContaining({ offset: 40, limit: 20 })),
    );

    await userEvent.click(screen.getByRole("radio", { name: "50" }));
    // Row 41 stays in view: page 1 at 50 per page.
    await waitFor(() =>
      expect(fetchJobsMock).toHaveBeenLastCalledWith("token-1", expect.objectContaining({ offset: 0, limit: 50 })),
    );
    expect(localStorage.getItem("xy:records-page-size")).toBe("50");

    await userEvent.click(screen.getByRole("radio", { name: "失败 3" }));
    await waitFor(() =>
      expect(fetchJobsMock).toHaveBeenLastCalledWith("token-1", expect.objectContaining({ view: "failed", offset: 0 })),
    );
  });

  it("selects finished rows only and deletes them with 撤销", async () => {
    fetchJobsMock.mockResolvedValue(page([job(1), job(2), job(3, "running")], 3));
    deleteJobsMock.mockImplementation(async (_token: string, ids: string[]) => ({ deleted: ids, skipped: [] }));
    restoreJobsMock.mockImplementation(async (_token: string, ids: string[]) => ({ restored: ids }));
    renderTab();
    await screen.findByText("第 1 张");

    expect(screen.getByRole("checkbox", { name: "生成中，完成后才能选择" })).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox", { name: "选择本页" }));
    expect(screen.getByText("已选 2 条")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "删除" }));
    await userEvent.click(await screen.findByRole("button", { name: "删除 2 条" }));
    await waitFor(() => expect(deleteJobsMock).toHaveBeenCalledWith("token-1", [job(1).id, job(2).id]));
    // The page is read again so the totals match.
    await waitFor(() => expect(fetchJobsMock.mock.calls.length).toBeGreaterThanOrEqual(2));

    await userEvent.click(await screen.findByRole("button", { name: "撤销" }));
    await waitFor(() => expect(restoreJobsMock).toHaveBeenCalledWith("token-1", [job(1).id, job(2).id]));
  });
});

// @vitest-environment jsdom
/**
 * Billing and session rules from docs/XY2API_FRONTEND_HANDOFF.md that the
 * UI depends on: error routing, balance formatting, expiry handling, and
 * model preferences never carrying ids the current key cannot reach.
 */
import "@testing-library/jest-dom/vitest";
import type { BackgroundJob } from "@loomic/shared";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSignOut, mockGetSession, mockOnAuthStateChange } = vi.hoisted(() => ({
  mockSignOut: vi.fn(),
  mockGetSession: vi.fn(),
  mockOnAuthStateChange: vi.fn(),
}));

vi.mock("../src/lib/supabase-browser", () => ({
  getSupabaseBrowserClient: vi.fn(() => ({
    auth: {
      signOut: mockSignOut,
      getSession: mockGetSession,
      onAuthStateChange: mockOnAuthStateChange,
    },
  })),
}));

import { needsReconcile } from "../src/components/billing/billing-badge";
import { resolveImagePreference } from "../src/hooks/use-image-model-preference";
import { AuthProvider, EXPIRED_LOGIN_PATH } from "../src/lib/auth-context";
import { describeIssue, issueCodeOf } from "../src/lib/generation-errors";
import { isActiveJob, isFailedJob, isSavingJob, jobStatusLabel, toImageJobView } from "../src/lib/image-jobs";
import { safeNextPath } from "../src/lib/pending-prompt";
import { ApiApplicationError, ApiAuthError, emitAuthExpired } from "../src/lib/server-api";
import { fetchAuthConfig, formatUsd, resetAuthConfigCache } from "../src/lib/xy2api-api";

describe("issue catalog", () => {
  it("marks unknown upstream results as possibly charged and points to usage", () => {
    const spec = describeIssue("upstream_unknown");
    expect(spec.maybeCharged).toBe(true);
    expect(spec.action).toBe("usage");
    expect(spec.weight).toBe("dialog");
  });

  it("states that insufficient balance was not charged and offers recharge", () => {
    const spec = describeIssue("insufficient_balance");
    expect(spec.maybeCharged).toBe(false);
    expect(spec.action).toBe("recharge");
  });

  it("falls back to the sanitized server message for unknown codes", () => {
    const spec = describeIssue("brand_new_code", "服务端说明");
    expect(spec.message).toBe("服务端说明");
    expect(spec.maybeCharged).toBe(false);
  });

  it("derives codes from thrown errors", () => {
    expect(issueCodeOf(new ApiApplicationError("key_unavailable", "x", 403))).toBe("key_unavailable");
    expect(issueCodeOf(new ApiAuthError())).toBe("xy2api_reauth_required");
    expect(issueCodeOf(new Error("boom"))).toBe("application_error");
  });
});

describe("balance formatting", () => {
  it("keeps three decimals below one dollar so small charges stay visible", () => {
    expect(formatUsd(0.042)).toBe("$0.042");
    expect(formatUsd(12.5)).toBe("$12.50");
    expect(formatUsd(1234.5)).toBe("$1,234.50");
  });
});

describe("auth config", () => {
  beforeEach(() => {
    resetAuthConfigCache();
    vi.stubEnv("NEXT_PUBLIC_SERVER_BASE_URL", "http://localhost:3001");
  });

  it("does not cache a failed config request", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ siteName: "主站" }) });
    globalThis.fetch = fetchMock;

    await expect(fetchAuthConfig()).rejects.toMatchObject({ code: "xy2api_unavailable" });
    await expect(fetchAuthConfig()).resolves.toMatchObject({ siteName: "主站" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("session expiry", () => {
  const assign = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    mockOnAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
    mockSignOut.mockResolvedValue({ error: null });
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, pathname: "/studio", assign },
    });
  });

  afterEach(() => cleanup());

  it("signs out locally and redirects once, even for parallel 401s", async () => {
    render(
      <AuthProvider>
        <div />
      </AuthProvider>,
    );

    act(() => {
      emitAuthExpired("http");
      emitAuthExpired("ws");
      emitAuthExpired("http");
    });

    await waitFor(() => expect(assign).toHaveBeenCalledWith(EXPIRED_LOGIN_PATH));
    expect(assign).toHaveBeenCalledTimes(1);
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(mockSignOut).toHaveBeenCalledWith({ scope: "local" });
  });
});

describe("image model preference", () => {
  it("drops models the current key cannot reach", () => {
    expect(
      resolveImagePreference({ mode: "manual", models: ["gpt-image-2", "gone"] }, ["gpt-image-2"]),
    ).toEqual({ mode: "manual", models: ["gpt-image-2"] });
  });

  it("falls back to auto when nothing usable is left", () => {
    expect(resolveImagePreference({ mode: "manual", models: ["gone"] }, ["gpt-image-2"])).toBeUndefined();
    expect(resolveImagePreference({ mode: "auto", models: [] }, ["gpt-image-2"])).toBeUndefined();
  });
});

describe("image job views", () => {
  const base = {
    id: "job_1",
    workspace_id: "w1",
    job_type: "image_generation",
    status: "dead_letter",
    payload: { prompt: "雨夜的霓虹街", model: "gpt-image-2", quality: "hd", aspect_ratio: "16:9" },
    result: null,
    error_code: "upstream_unknown",
    error_message: "请求状态未知",
    billing_status: "unknown",
    xy2api_request_id: "req_123",
    created_at: "2026-10-07T10:00:00Z",
  } as unknown as BackgroundJob;

  it("reads payload, billing and request id defensively", () => {
    const view = toImageJobView(base);
    expect(view).toMatchObject({
      prompt: "雨夜的霓虹街",
      quality: "hd",
      aspectRatio: "16:9",
      billing: "unknown",
      requestId: "req_123",
      url: null,
    });
    expect(isFailedJob(view)).toBe(true);
    expect(isActiveJob(view)).toBe(false);
    expect(needsReconcile(view.billing)).toBe(true);
  });

  it("shows a charged image waiting for a storage retry as saving, not queued", () => {
    const view = toImageJobView({
      ...base,
      status: "queued",
      billing_status: "charged",
      error_code: "storage_retrying",
    } as BackgroundJob);
    expect(isActiveJob(view)).toBe(true);
    expect(isSavingJob(view)).toBe(true);
    expect(jobStatusLabel(view)).toBe("保存中");
    expect(jobStatusLabel({ ...view, errorCode: null })).toBe("排队中");
    expect(describeIssue("storage_retrying", null)).toMatchObject({
      maybeCharged: false,
      action: "none",
    });
  });

  it("treats anything but hd as 1K", () => {
    const view = toImageJobView({ ...base, payload: { prompt: "x", quality: "ultra" } } as BackgroundJob);
    expect(view.quality).toBe("standard");
  });
});

describe("post-login redirect", () => {
  it("only allows same-site paths", () => {
    expect(safeNextPath("/studio")).toBe("/studio");
    expect(safeNextPath("https://evil.example.com")).toBe("/home");
    expect(safeNextPath("//evil.example.com")).toBe("/home");
    expect(safeNextPath(null)).toBe("/home");
  });
});

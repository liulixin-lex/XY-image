// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: mockPush })),
}));

const mockFetchBrandKits = vi.fn();
vi.mock("../src/lib/brand-kit-api", () => ({
  fetchBrandKits: (...args: unknown[]) => mockFetchBrandKits(...args),
}));

const mockUpdateProject = vi.fn();
vi.mock("../src/lib/server-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/server-api")>()),
  updateProject: (...args: unknown[]) => mockUpdateProject(...args),
}));

import { BrandKitSelector } from "../src/components/brand-kit-selector";
import { ToastProvider } from "../src/components/toast";

const kit = (id: string, name: string) => ({
  id,
  name,
  is_default: false,
  cover_url: null,
  asset_count: 0,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
});

function renderSelector(onBrandKitChange = vi.fn()) {
  render(
    <ToastProvider>
      <BrandKitSelector
        accessToken="token_123"
        projectId="p1"
        currentBrandKitId="bk1"
        onBrandKitChange={onBrandKitChange}
      />
    </ToastProvider>,
  );
  return onBrandKitChange;
}

async function openMenu() {
  await userEvent.click(
    await screen.findByRole("button", { name: "品牌套件：咖啡店品牌" }),
  );
}

describe("BrandKitSelector", () => {
  beforeEach(() => {
    mockFetchBrandKits.mockResolvedValue({
      brandKits: [kit("bk1", "咖啡店品牌"), kit("bk2", "绘本系列")],
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("saves the chosen kit and reports it to the canvas", async () => {
    mockUpdateProject.mockResolvedValue({});
    const onChange = renderSelector();
    await openMenu();
    await userEvent.click(
      await screen.findByRole("menuitemradio", { name: "不使用" }),
    );

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(null));
    expect(mockUpdateProject).toHaveBeenCalledWith("token_123", "p1", {
      brand_kit_id: null,
    });
  });

  it("keeps the current kit and tells the user when saving fails", async () => {
    mockUpdateProject.mockRejectedValue(new Error("network"));
    const onChange = renderSelector();
    await openMenu();
    await userEvent.click(
      await screen.findByRole("menuitemradio", { name: "绘本系列" }),
    );

    expect(
      await screen.findByText("品牌套件没有切换成功，请稍后再试"),
    ).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "品牌套件：咖啡店品牌" }),
    ).toBeEnabled();
  });

  it("says the list failed to load instead of claiming there are no kits", async () => {
    mockFetchBrandKits.mockRejectedValue(new Error("offline"));
    renderSelector();
    await waitFor(() => expect(console.warn).toHaveBeenCalled());
    await userEvent.click(
      screen.getByRole("button", { name: "品牌套件：已选用" }),
    );

    expect(await screen.findByText("品牌套件没有加载出来")).toBeInTheDocument();
    expect(screen.queryByText("还没有品牌套件")).not.toBeInTheDocument();
  });
});

// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockFetchGoogleFonts = vi.fn();
const mockLoadFontStylesheet = vi.fn();
vi.mock("../src/lib/font-api", () => ({
  fetchGoogleFonts: (...args: unknown[]) => mockFetchGoogleFonts(...args),
  loadFontStylesheet: (...args: unknown[]) => mockLoadFontStylesheet(...args),
}));

import { FontPickerDialog } from "../src/components/brand-kit/font-picker-dialog";

function renderPicker() {
  const onSelect = vi.fn();
  render(<FontPickerDialog open onClose={() => {}} onSelect={onSelect} />);
  return { onSelect };
}

describe("FontPickerDialog", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("says the library did not load, and retries on request", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockFetchGoogleFonts.mockRejectedValueOnce(new Error("font list request failed: 502"));
    mockFetchGoogleFonts.mockResolvedValueOnce([{ family: "Lora", category: "serif", variants: ["regular"] }]);
    renderPicker();

    expect(await screen.findByText("字体库没有加载出来")).toBeInTheDocument();
    expect(screen.queryByText(/还没有|暂时是空的/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByRole("button", { name: "Lora" })).toBeInTheDocument();
    expect(mockFetchGoogleFonts).toHaveBeenCalledTimes(2);
  });

  it("points to manual entry when the library is empty", async () => {
    mockFetchGoogleFonts.mockResolvedValueOnce([]);
    renderPicker();

    // The loading notice is a status too; wait for the empty-library one.
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("手动输入字体名称"));
  });

  it("previews each font with a subset of its own name, then adds the chosen one", async () => {
    mockFetchGoogleFonts.mockResolvedValueOnce([
      { family: "Lora", category: "serif", variants: ["regular", "700"] },
      { family: "Inter", category: "sans-serif", variants: ["regular"] },
    ]);
    const { onSelect } = renderPicker();

    await userEvent.click(await screen.findByRole("button", { name: "Lora" }));
    expect(mockLoadFontStylesheet).toHaveBeenCalledWith("Lora", { text: "Lora" });
    expect(mockLoadFontStylesheet).toHaveBeenCalledWith("Inter", { text: "Inter" });

    await userEvent.click(screen.getByRole("button", { name: /添加/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ family: "Lora", category: "serif" }));
  });
});

// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import {
  PosterTabs,
  posterPanelProps,
} from "../src/components/ui/poster-tabs";

type Tab = "installed" | "marketplace" | "import";

function Harness() {
  const [value, setValue] = useState<Tab>("installed");
  return (
    <>
      <PosterTabs
        value={value}
        onValueChange={setValue}
        tabs={[
          { value: "installed", label: "已安装" },
          { value: "marketplace", label: "市场" },
          { value: "import", label: "导入" },
        ]}
        ariaLabel="技能分类"
        idPrefix="skills"
      />
      <div {...posterPanelProps("skills", value)}>{value}</div>
    </>
  );
}

describe("PosterTabs", () => {
  afterEach(cleanup);

  it("wires tabs to their panel with a single tab stop", () => {
    render(<Harness />);
    const tabs = screen.getAllByRole("tab");
    expect(screen.getByRole("tablist", { name: "技能分类" })).toBeInTheDocument();
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAccessibleName("已安装");
    expect(tabs[0]).toHaveAttribute("aria-controls", panel.id);
  });

  it("moves and opens with the arrow keys, Home and End", () => {
    render(<Harness />);
    const list = screen.getByRole("tablist");
    screen.getByRole("tab", { name: "已安装" }).focus();

    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "市场" })).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("marketplace");

    fireEvent.keyDown(list, { key: "End" });
    expect(screen.getByRole("tab", { name: "导入" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // Wraps around past the last tab.
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "已安装" })).toHaveFocus();

    fireEvent.keyDown(list, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "导入" })).toHaveFocus();
    fireEvent.keyDown(list, { key: "Home" });
    expect(screen.getByRole("tabpanel")).toHaveTextContent("installed");
  });

  it("opens a tab on click", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("tab", { name: "导入" }));
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("导入");
  });
});

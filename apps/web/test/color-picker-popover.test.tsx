// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ColorPickerPopover,
  normalizeHex,
} from "../src/components/brand-kit/color-picker-popover";

function setup() {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(
    <ColorPickerPopover
      open
      mode="create"
      onSave={onSave}
      onClose={onClose}
      anchorRef={createRef<HTMLElement>()}
    />,
  );
  return { onSave, onClose, input: screen.getByLabelText("颜色值") };
}

describe("ColorPickerPopover", () => {
  afterEach(() => cleanup());

  it("accepts a pasted hex with its # (seen on the pre-launch site: saved the default instead)", async () => {
    const { onSave, input } = setup();
    await userEvent.clear(input);
    await userEvent.click(input);
    await userEvent.paste("#e8553d");
    await userEvent.type(screen.getByPlaceholderText("颜色名称"), "主色");
    await userEvent.click(screen.getByRole("button", { name: "添加" }));
    expect(onSave).toHaveBeenCalledWith("主色", "#E8553D");
  });

  it("will not save a half-typed value", async () => {
    const { onSave, input } = setup();
    await userEvent.clear(input);
    await userEvent.type(input, "E855");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "添加" })).toBeDisabled();
    await userEvent.type(input, "{Enter}");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("normalizes the forms people type", () => {
    expect(normalizeHex(" #e8553d ")).toBe("#E8553D");
    expect(normalizeHex("f60")).toBe("#FF6600");
    expect(normalizeHex("E855")).toBeNull();
  });
});

// @vitest-environment jsdom
/**
 * The smooth-frontend pass: the shared one-second clock, list thumbnails,
 * the hero's sample strip (all samples reachable) and the render tier.
 */
import "@testing-library/jest-dom/vitest";
import type { BackgroundJob } from "@loomic/shared";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SampleStrip } from "../src/components/landing/sample-strip";
import { SHOWCASE_ITEMS } from "../src/components/landing/showcase";
import { useNow } from "../src/hooks/use-now";
import { listImage, toImageJobView } from "../src/lib/image-jobs";
import { settleRenderTier } from "../src/lib/render-tier";

afterEach(cleanup);

describe("shared clock", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function Clock({ label }: { label: string }) {
    const now = useNow(true);
    return <span data-testid={label}>{Math.floor(now / 1000)}</span>;
  }

  it("ticks every consumer from one interval and stops when they leave", () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    const view = render(
      <>
        <Clock label="a" />
        <Clock label="b" />
      </>,
    );
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    const before = Number(screen.getByTestId("a").textContent);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(Number(screen.getByTestId("a").textContent)).toBe(before + 3);
    expect(screen.getByTestId("b").textContent).toBe(screen.getByTestId("a").textContent);
    view.unmount();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
  });
});

describe("list thumbnails", () => {
  const job = (result: Record<string, unknown>) =>
    toImageJobView({
      id: "j1",
      workspace_id: "w1",
      job_type: "image_generation",
      status: "succeeded",
      payload: { prompt: "一只猫", model: "gpt-image-2", resolution: "4K" },
      result,
      error_code: null,
      error_message: null,
      billing_status: "charged",
      created_at: new Date().toISOString(),
    } as unknown as BackgroundJob);

  it("uses the thumbnail in lists and falls back to the original", () => {
    const withThumb = job({ signed_url: "https://img/j1.png", thumb_url: "https://img/j1.thumb.webp" });
    expect(withThumb.url).toBe("https://img/j1.png");
    expect(listImage(withThumb)).toBe("https://img/j1.thumb.webp");
    const older = job({ signed_url: "https://img/j1.png" });
    expect(older.thumbUrl).toBeNull();
    expect(listImage(older)).toBe("https://img/j1.png");
  });
});

describe("hero sample strip", () => {
  it("offers every sample, not only the first six", () => {
    render(<SampleStrip items={SHOWCASE_ITEMS} selected={0} onSelect={() => {}} />);
    expect(screen.getAllByRole("radio")).toHaveLength(SHOWCASE_ITEMS.length);
    expect(SHOWCASE_ITEMS.length).toBeGreaterThan(6);
  });

  it("is one tab stop; arrows move the choice and wrap", () => {
    const onSelect = vi.fn();
    const last = SHOWCASE_ITEMS.length - 1;
    const view = render(<SampleStrip items={SHOWCASE_ITEMS} selected={last} onSelect={onSelect} />);
    const radios = screen.getAllByRole("radio");
    expect(radios.filter((radio) => radio.tabIndex === 0)).toEqual([radios[last]]);
    expect(radios[last]).toHaveAttribute("aria-checked", "true");

    const group = screen.getByRole("radiogroup");
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(onSelect).toHaveBeenLastCalledWith(0);
    view.rerender(<SampleStrip items={SHOWCASE_ITEMS} selected={7} onSelect={onSelect} />);
    fireEvent.keyDown(group, { key: "ArrowLeft" });
    expect(onSelect).toHaveBeenLastCalledWith(6);
    fireEvent.keyDown(group, { key: "End" });
    expect(onSelect).toHaveBeenLastCalledWith(last);
    fireEvent.click(radios[9] as HTMLElement);
    expect(onSelect).toHaveBeenLastCalledWith(9);
  });
});

describe("render tier", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.render;
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  it("goes lite without hardware WebGL and remembers it", () => {
    // jsdom has no WebGL at all: the same answer as a software-only machine.
    settleRenderTier();
    expect(document.documentElement.dataset.render).toBe("lite");
    expect(JSON.parse(localStorage.getItem("xy-render-tier") ?? "{}")).toMatchObject({ tier: "lite" });
  });

  it("trusts a recent full detection without probing again", () => {
    localStorage.setItem("xy-render-tier", JSON.stringify({ tier: "full", at: Date.now() }));
    const probe = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
    settleRenderTier();
    expect(probe).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.render).toBeUndefined();
  });
});

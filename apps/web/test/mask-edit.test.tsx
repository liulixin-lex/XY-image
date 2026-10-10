// @vitest-environment jsdom
/**
 * 局部重绘 / 扩图 (M-G): the mask helpers the painter relies on, and how an
 * edited picture shows up in the studio feed.
 */
import "@testing-library/jest-dom/vitest";
import type { BackgroundJob } from "@loomic/shared";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BatchFeed, type FeedActions } from "../src/components/studio/batch-feed";
import { groupByBatch, toImageJobView } from "../src/lib/image-jobs";
import {
  MASK_MAX_EDGE,
  maskSize,
  nearestRatio,
  paintedShare,
  sourceRatio,
} from "../src/lib/mask-edit";

afterEach(cleanup);

describe("mask helpers", () => {
  it("paints at the picture's own size, long edge at most 2048", () => {
    expect(maskSize(1024, 768)).toEqual({ width: 1024, height: 768 });
    expect(maskSize(4096, 2048)).toEqual({ width: MASK_MAX_EDGE, height: 1024 });
    expect(maskSize(1000, 3000)).toEqual({ width: 683, height: 2048 });
    expect(maskSize(0, 0)).toEqual({ width: 1, height: 1 });
  });

  it("picks the closest listed shape", () => {
    const ratios = ["1:1", "3:2", "2:3", "16:9", "9:16"];
    expect(nearestRatio(1820, 1024, ratios)).toBe("16:9");
    expect(nearestRatio(1000, 1490, ratios)).toBe("2:3");
    expect(nearestRatio(10, 10, ["bad", "1:1"])).toBe("1:1");
    expect(nearestRatio(10, 10, [])).toBeNull();
  });

  it("repaints in the picture's own ratio when the model lists it", () => {
    const ratios = ["1:1", "4:3", "16:9"];
    expect(sourceRatio({ aspectRatio: "4:3", width: 1024, height: 768 }, ratios)).toBe("4:3");
    // Not listed: closest by the picture's real size.
    expect(sourceRatio({ aspectRatio: "21:9", width: 2100, height: 900 }, ratios)).toBe("16:9");
    // Nothing to measure: keep what it was made with.
    expect(sourceRatio({ aspectRatio: "21:9", width: null, height: null }, ratios)).toBe("21:9");
    expect(sourceRatio({ aspectRatio: null, width: null, height: null }, ratios)).toBeNull();
  });

  it("counts painted pixels the way the server does (alpha at least half)", () => {
    const rgba = new Uint8ClampedArray([
      255, 0, 0, 255, // painted
      255, 0, 0, 128, // painted (edge of the threshold)
      255, 0, 0, 127, // soft edge, not counted
      0, 0, 0, 0, // empty
    ]);
    expect(paintedShare(rgba)).toBe(0.5);
    expect(paintedShare(new Uint8ClampedArray())).toBe(0);
  });
});

const noActions: FeedActions = {
  onSelect: () => {},
  onOpen: () => {},
  onReference: () => {},
  onVariant: () => {},
  onDownload: () => {},
  onReuse: () => {},
  onCancelJob: () => {},
  onCancelBatch: () => {},
};

const edited = (edit: unknown) =>
  toImageJobView({
    id: "job_9",
    workspace_id: "w1",
    job_type: "image_generation",
    status: "succeeded",
    payload: {
      prompt: "把杯子换成红色",
      model: "gpt-image-2",
      resolution: "1K",
      aspect_ratio: "1:1",
      input_images: ["asset_1"],
      edit,
    },
    result: { url: "https://img.example/9.png", asset_id: "asset_9", width: 1024, height: 1024 },
    error_code: null,
    error_message: null,
    billing_status: "charged",
    xy2api_request_id: "req_9",
    created_at: new Date().toISOString(),
  } as unknown as BackgroundJob);

describe("edited pictures in the feed", () => {
  it("reads the edit mode defensively from the job", () => {
    expect(edited({ mode: "inpaint", mask: "https://img.example/m.png" }).edit).toBe("inpaint");
    expect(edited({ mode: "outpaint", scale: 1.5, anchor: "center" }).edit).toBe("outpaint");
    expect(edited({ mode: "warp" }).edit).toBeNull();
    expect(edited(undefined).edit).toBeNull();
  });

  it("labels the batch and opens the editor from the picture's toolbar", () => {
    const onEdit = vi.fn();
    const job = edited({ mode: "outpaint", scale: 1.5, anchor: "center" });
    const view = render(
      <BatchFeed
        groups={groupByBatch([job])}
        selectedId={job.id}
        justFinished={new Set()}
        modelName={() => "GPT Image 2"}
        usageUrl={null}
        actions={{ ...noActions, onEdit }}
      />,
    );
    expect(view.getByText(/扩图/, { selector: "p, span, div" })).toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "局部重绘" }));
    fireEvent.click(view.getByRole("button", { name: "扩图" }));
    expect(onEdit.mock.calls.map(([picked, mode]) => [picked.id, mode])).toEqual([
      ["job_9", "inpaint"],
      ["job_9", "outpaint"],
    ]);
  });

  it("offers no edit buttons when no model on the key can edit", () => {
    const job = edited(undefined);
    const view = render(
      <BatchFeed
        groups={groupByBatch([job])}
        selectedId={job.id}
        justFinished={new Set()}
        modelName={() => "GPT Image 2"}
        usageUrl={null}
        actions={noActions}
      />,
    );
    expect(view.queryByRole("button", { name: "局部重绘" })).toBeNull();
    expect(view.queryByRole("button", { name: "扩图" })).toBeNull();
  });
});

import { describe, expect, it, vi } from "vitest";

import {
  type SubmitImageJobFn,
  createImageGenerateTool,
  normalizeToolImageParams,
} from "./image-generate.js";

describe("normalizeToolImageParams", () => {
  it("reads loose case and keeps valid values", () => {
    expect(
      normalizeToolImageParams({ resolution: "4k", quality: "HIGH" }),
    ).toEqual({
      resolution: "4K",
      quality: "high",
      adjusted: [],
    });
  });

  it("reads old or unknown values instead of rejecting them", () => {
    expect(
      normalizeToolImageParams({ resolution: "2K", quality: "standard" }),
    ).toEqual({
      resolution: "2K",
      quality: "auto",
      adjusted: ["quality standard→auto"],
    });
    // The old single field meant the size when no size was given.
    expect(normalizeToolImageParams({ quality: "hd" })).toMatchObject({
      resolution: "2K",
      quality: "medium",
    });
    expect(
      normalizeToolImageParams({ resolution: "8K", quality: "best" }),
    ).toEqual({
      resolution: "2K",
      quality: "auto",
      adjusted: ["resolution 8K→2K", "quality best→auto"],
    });
  });
});

describe("generate_image tool", () => {
  it("takes an old quality name without failing the run, and sends a valid one", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const submitImageJob = vi.fn<SubmitImageJobFn>(async () => ({
      jobId: "job-1",
      imageUrl: "https://example.test/a.png",
      width: 1024,
      height: 1024,
    }));
    const generate = createImageGenerateTool({ submitImageJob });
    // The lab's mock model sends exactly this (quality from the old schema).
    await generate.invoke({
      title: "戴帽子的猫",
      prompt: "画一只戴帽子的猫",
      aspectRatio: "1:1",
      quality: "standard",
    });
    expect(submitImageJob).toHaveBeenCalledTimes(1);
    expect(submitImageJob.mock.calls[0]?.[0]).toMatchObject({
      resolution: "2K",
      quality: "auto",
    });
  });
  it("passes a settled job's code and billing state on, so the chat can tell failed from 待核对", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const submitImageJob = vi.fn<SubmitImageJobFn>(async () => ({
      jobId: "job-2",
      error: "内容未通过审核",
      errorCode: "safety_filter",
      billingStatus: "not_charged",
    }));
    const generate = createImageGenerateTool({ submitImageJob });
    const result = await generate.invoke({
      title: "猫",
      prompt: "画一只猫",
      aspectRatio: "1:1",
    });
    expect(result).toMatchObject({
      error: "内容未通过审核",
      errorCode: "safety_filter",
      billingStatus: "not_charged",
      jobId: "job-2",
    });
  });

  it("says unknown when the wait itself broke, and nothing sent when a guard refused", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const input = { title: "猫", prompt: "画一只猫", aspectRatio: "1:1" };
    const pollBroke = createImageGenerateTool({
      submitImageJob: async () => {
        throw new Error("job_query_failed");
      },
    });
    expect(await pollBroke.invoke(input)).toMatchObject({
      billingStatus: "unknown",
    });

    const refused = createImageGenerateTool({
      submitImageJob: async () => {
        throw Object.assign(new Error("主站余额不足"), {
          name: "BillingGuardError",
          code: "insufficient_balance",
        });
      },
    });
    expect(await refused.invoke(input)).toMatchObject({
      errorCode: "insufficient_balance",
      billingStatus: "none",
    });
  });
});

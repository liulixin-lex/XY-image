import { describe, expect, it } from "vitest";

import { describeMediaOutcome } from "../src/components/chat/media-outcome";

describe("describeMediaOutcome", () => {
  it("has nothing to say about a result without an error", () => {
    expect(describeMediaOutcome(undefined, "image")).toBeNull();
    expect(describeMediaOutcome({ elementId: "el-1" }, "image")).toBeNull();
  });

  it("says 「没生成出来」 only when the job settled with nothing charged", () => {
    expect(
      describeMediaOutcome(
        {
          error: "内容未通过审核",
          errorCode: "safety_filter",
          billingStatus: "not_charged",
        },
        "image",
      ),
    ).toEqual({
      tone: "failed",
      title: "没生成出来",
      message: "内容未通过审核。修改提示词或参考图后再试。",
    });
    // Refused before anything was sent (billing guard).
    expect(
      describeMediaOutcome(
        {
          error: "主站余额不足",
          errorCode: "insufficient_balance",
          billingStatus: "none",
        },
        "image",
      ),
    ).toMatchObject({
      tone: "failed",
      message: expect.stringContaining("主站余额不足"),
    });
  });

  it("keeps the server's words for a code the catalog does not know", () => {
    expect(
      describeMediaOutcome(
        {
          error: "这张图的尺寸主站不支持",
          errorCode: "something_new",
          billingStatus: "not_charged",
        },
        "image",
      ),
    ).toMatchObject({ tone: "failed", message: "这张图的尺寸主站不支持" });
  });

  it.each([
    [
      "no billing state (older messages, a tool that threw)",
      { error: "socket hang up" },
    ],
    [
      "billing unknown",
      { error: "x", errorCode: "upstream_unknown", billingStatus: "unknown" },
    ],
    ["billing still pending", { error: "x", billingStatus: "pending" }],
    [
      "a maybe-charged code before billing settled",
      { error: "x", errorCode: "upstream_unknown", billingStatus: "none" },
    ],
    ["an unrecognised billing value", { error: "x", billingStatus: "maybe" }],
  ])("calls it 待核对 with %s", (_, output) => {
    const outcome = describeMediaOutcome(output, "image");
    expect(outcome?.tone).toBe("unknown");
    expect(outcome?.title).toBe("结果待核对");
    expect(outcome?.message).toContain("图片可能已经生成");
    expect(outcome?.message).toContain("不会自动重发");
  });

  it("says a charged job without a picture was generated", () => {
    expect(
      describeMediaOutcome(
        { error: "x", errorCode: "storage_failed", billingStatus: "charged" },
        "image",
      ),
    ).toMatchObject({ tone: "charged_failed", title: "已生成，但没拿到图片" });
  });

  it("tells saving, a long wait and a stop apart from failures", () => {
    expect(
      describeMediaOutcome({ error: "x", pending: "storage" }, "image")?.tone,
    ).toBe("saving");
    expect(
      describeMediaOutcome({ error: "Job timed out after 660s" }, "image")
        ?.tone,
    ).toBe("waiting");
    expect(describeMediaOutcome({ stopped: true }, "image")).toMatchObject({
      tone: "stopped",
      message: "已经开始生成的图片仍会放到画布上。",
    });
    expect(describeMediaOutcome({ stopped: true }, "video")).toEqual({
      tone: "stopped",
      title: "已停止",
    });
    expect(
      describeMediaOutcome(
        { error: "Job canceled", errorCode: "canceled", billingStatus: "none" },
        "image",
      ),
    ).toEqual({ tone: "canceled", title: "已取消，没有发出" });
  });

  it("never mentions charging", () => {
    const outputs = [
      { error: "x" },
      { error: "x", errorCode: "safety_filter", billingStatus: "not_charged" },
      { error: "x", billingStatus: "charged" },
    ];
    for (const output of outputs) {
      const outcome = describeMediaOutcome(output, "image");
      expect(`${outcome?.title}${outcome?.message}`).not.toMatch(
        /扣费|收费|计费/,
      );
    }
  });
});

import type { StreamEvent } from "@loomic/shared";
import { describe, expect, it } from "vitest";
import {
  applyToAssistantDraft,
  createAssistantDraft,
} from "./assistant-draft.js";

const base = { runId: "run-1", timestamp: "2026-10-09T00:00:00Z" };
const events = {
  delta: (delta: string) => ({ ...base, type: "message.delta", delta }),
  started: (toolCallId: string, toolName = "generate_image") => ({
    ...base,
    type: "tool.started",
    toolCallId,
    toolName,
    input: { prompt: "灯塔" },
  }),
  completed: (toolCallId: string) => ({
    ...base,
    type: "tool.completed",
    toolCallId,
    toolName: "inspect_canvas",
    output: { count: 2 },
    outputSummary: "2 elements",
  }),
  canceled: () => ({ ...base, type: "run.canceled" }),
  failed: () => ({
    ...base,
    type: "run.failed",
    error: { code: "run_failed", message: "boom" },
  }),
};

function draftOf(list: unknown[]) {
  const draft = createAssistantDraft();
  for (const event of list) applyToAssistantDraft(draft, event as StreamEvent);
  return draft;
}

describe("assistant draft", () => {
  it("joins text deltas and pairs tool start and completion", () => {
    const draft = draftOf([
      events.delta("好的，"),
      events.delta("先看画布"),
      events.started("t1", "inspect_canvas"),
      events.completed("t1"),
      events.delta("完成"),
    ]);
    expect(draft.text.join("")).toBe("好的，先看画布完成");
    expect(draft.blocks).toEqual([
      { type: "text", text: "好的，先看画布" },
      {
        type: "tool",
        toolCallId: "t1",
        toolName: "inspect_canvas",
        status: "completed",
        input: { prompt: "灯塔" },
        output: { count: 2 },
        outputSummary: "2 elements",
      },
      { type: "text", text: "完成" },
    ]);
  });

  it("saves a tool the user stopped as stopped, not running", () => {
    const draft = draftOf([
      events.started("t1", "inspect_canvas"),
      events.completed("t1"),
      events.started("t2"),
      events.canceled(),
    ]);
    expect(draft.blocks[0]).toMatchObject({
      status: "completed",
      output: { count: 2 },
    });
    expect(draft.blocks[1]).toMatchObject({
      toolName: "generate_image",
      status: "completed",
      output: { stopped: true },
      outputSummary: "已停止",
    });
  });

  it("closes running tools when the run fails", () => {
    const draft = draftOf([events.started("t1"), events.failed()]);
    expect(draft.blocks[0]).toMatchObject({
      status: "completed",
      outputSummary: "处理失败",
    });
    expect(draft.blocks[0]).not.toHaveProperty("output");
  });

  it("leaves a line when a failed run had no reply", () => {
    const refused = draftOf([
      {
        ...events.failed(),
        error: {
          code: "run_failed",
          message: "内容未通过审核，请修改提示词",
          details: { gatewayCode: "safety_filter" },
        },
      },
    ]);
    expect(refused.blocks).toEqual([
      { type: "text", text: "没能完成：内容未通过审核，请修改提示词" },
    ]);
    expect(refused.text.join("")).toBe(
      "没能完成：内容未通过审核，请修改提示词",
    );

    expect(draftOf([events.failed()]).blocks).toEqual([
      { type: "text", text: "抱歉，处理过程中遇到问题，请重试。" },
    ]);
    // A partial reply is kept as it is.
    expect(draftOf([events.delta("好的"), events.failed()]).blocks).toEqual([
      { type: "text", text: "好的" },
    ]);
  });

  it("leaves a line when a run was stopped before any reply", () => {
    const stopped = draftOf([events.canceled()]);
    expect(stopped.blocks).toEqual([{ type: "text", text: "已停止。" }]);
    expect(stopped.text.join("")).toBe("已停止。");
  });
});

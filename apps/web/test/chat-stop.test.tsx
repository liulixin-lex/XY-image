// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { StreamEvent, ToolBlock } from "@loomic/shared";
import { ToolBlockView } from "../src/components/chat/tool-block-view";
import type { Message } from "../src/hooks/use-chat-sessions";
import { useChatStream } from "../src/hooks/use-chat-stream";

// A stopped run closes its running tools as stopped, the same way the server
// saves the message (apps/server ws/assistant-draft.ts), and the cards say so
// instead of showing a check or a failure.

afterEach(() => cleanup());

function stopped(messages: Message[]) {
  let state = messages;
  const update = vi.fn(
    (_session: string, updater: (prev: Message[]) => Message[]) => {
      state = updater(state);
    },
  );
  const { result } = renderHook(() => useChatStream(update));
  act(() =>
    result.current.applyStreamEvent(
      {
        type: "run.canceled",
        runId: "run-1",
        timestamp: "2026-10-09T00:00:00Z",
      } as StreamEvent,
      "a1",
      "s1",
    ),
  );
  return state;
}

describe("a stopped run", () => {
  it("closes running tools as stopped and keeps finished ones", () => {
    const [message] = stopped([
      {
        id: "a1",
        role: "assistant",
        contentBlocks: [
          { type: "text", text: "先看看画布" },
          {
            type: "tool",
            toolCallId: "t1",
            toolName: "inspect_canvas",
            status: "completed",
            output: { count: 1 },
          },
          {
            type: "tool",
            toolCallId: "t2",
            toolName: "generate_image",
            status: "running",
          },
        ],
      },
    ]);
    expect(message?.contentBlocks[1]).toMatchObject({
      status: "completed",
      output: { count: 1 },
    });
    expect(message?.contentBlocks[2]).toMatchObject({
      status: "completed",
      output: { stopped: true },
      outputSummary: "已停止",
    });
  });

  it("says it stopped when nothing came back yet", () => {
    const [message] = stopped([
      { id: "a1", role: "assistant", contentBlocks: [] },
    ]);
    expect(message?.contentBlocks).toEqual([
      { type: "text", text: "已停止。" },
    ]);
  });
});

describe("stopped tool cards", () => {
  const block = (toolName: string): ToolBlock => ({
    type: "tool",
    toolCallId: "t1",
    toolName,
    status: "completed",
    input: { model: "gpt-image-2", prompt: "灯塔" },
    output: { stopped: true },
    outputSummary: "已停止",
  });

  it("tells the user a started image still reaches the canvas", () => {
    render(<ToolBlockView block={block("generate_image")} />);
    expect(screen.getByText("已停止")).toBeInTheDocument();
    expect(
      screen.getByText("已经开始生成的图片仍会放到画布上。"),
    ).toBeInTheDocument();
    expect(screen.queryByText("图片生成失败")).not.toBeInTheDocument();
  });

  it("does not promise the canvas for a stopped video", () => {
    render(<ToolBlockView block={block("generate_video")} />);
    expect(screen.getByText("已停止")).toBeInTheDocument();
    expect(screen.queryByText(/放到画布上/)).not.toBeInTheDocument();
  });
});

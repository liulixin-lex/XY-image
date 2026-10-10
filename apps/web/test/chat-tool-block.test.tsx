// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ToolBlockView } from "../src/components/chat/tool-block-view";
import {
  formatModelDisplayName,
  formatParamName,
  formatParamValue,
} from "../src/components/chat/utils";

describe("chat tool formatting", () => {
  it("formats model ids the way the rest of the site names them", () => {
    expect(formatModelDisplayName("gpt-image-2")).toBe("GPT Image 2");
    expect(formatModelDisplayName("gemini-3-pro-image")).toBe(
      "Gemini 3 Pro Image",
    );
    expect(formatModelDisplayName("openai/gpt-image-1.5")).toBe(
      "GPT Image 1.5",
    );
    expect(formatModelDisplayName("dall-e-3")).toBe("DALL·E 3");
  });

  it("uses plain Chinese labels for known parameters", () => {
    expect(formatParamName("aspectRatio")).toBe("比例");
    expect(formatParamName("prompt")).toBe("提示词");
    expect(formatParamName("someNewField")).toBe("some new field");
    expect(formatParamValue(true)).toBe("是");
  });
});

describe("ToolBlockView", () => {
  afterEach(() => cleanup());

  it("says 「没生成出来」 once, with the reason, when the job settled with nothing charged", () => {
    render(
      <ToolBlockView
        block={{
          type: "tool",
          toolCallId: "t5",
          toolName: "generate_image",
          status: "completed",
          input: { model: "gemini-3-pro-image", prompt: "面料特写" },
          output: {
            error: "内容未通过审核",
            errorCode: "safety_filter",
            billingStatus: "not_charged",
          },
        }}
      />,
    );

    expect(screen.getAllByText("没生成出来")).toHaveLength(1);
    expect(
      screen.getByText("内容未通过审核。修改提示词或参考图后再试。"),
    ).toBeInTheDocument();
    // The generic "生成图片 / error: …" card does not duplicate it.
    expect(screen.queryByText("生成图片")).not.toBeInTheDocument();
    expect(screen.getByText("Gemini 3 Pro Image")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /生成记录/ }),
    ).not.toBeInTheDocument();
  });

  it("calls a failure it cannot settle 待核对, never a plain failure", () => {
    render(
      <ToolBlockView
        block={{
          type: "tool",
          toolCallId: "t7",
          toolName: "generate_image",
          status: "completed",
          input: { model: "gpt-image-2" },
          // A tool that threw, or a message saved before billing was passed on.
          output: { error: "出图过程出错了，图片可能已经生成。" },
        }}
      />,
    );

    expect(screen.getByText("结果待核对")).toBeInTheDocument();
    expect(
      screen.getByText(/图片可能已经生成/, { selector: "p" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /打开生成记录/ })).toHaveAttribute(
      "href",
      "/settings?tab=records",
    );
    expect(screen.queryByText("没生成出来")).not.toBeInTheDocument();
  });

  it.each([
    [
      { error: "图片已生成，正在重新保存", pending: "storage", jobId: "j1" },
      "图片已生成，正在保存",
      "这张已经生成，正在保存，好了会自动放到画布上，不用重新生成。",
    ],
    [
      { error: "Job timed out after 660s", jobId: "j1" },
      "图片还在生成",
      "这次等得比较久。生成好后会自动放到画布上。",
    ],
  ])(
    "does not call an image on its way a failure (%o)",
    (output, title, message) => {
      render(
        <ToolBlockView
          block={{
            type: "tool",
            toolCallId: "t6",
            toolName: "generate_image",
            status: "completed",
            input: { model: "gpt-image-2", prompt: "灯塔" },
            output,
          }}
        />,
      );

      expect(screen.getByText(title)).toBeInTheDocument();
      expect(screen.getByText(message)).toBeInTheDocument();
      expect(screen.queryByText("没生成出来")).not.toBeInTheDocument();
      expect(screen.queryByText("结果待核对")).not.toBeInTheDocument();
      expect(screen.queryByText(output.error)).not.toBeInTheDocument();
    },
  );

  it("hides raw key/value lines when the tool has a readable summary", () => {
    render(
      <ToolBlockView
        block={{
          type: "tool",
          toolCallId: "t1",
          toolName: "inspect_canvas",
          status: "completed",
          outputSummary: "画布上有 3 张图片",
          output: { elements: 3 },
        }}
      />,
    );

    expect(screen.getByText("画布上有 3 张图片")).toBeInTheDocument();
    expect(screen.queryByText(/元素: 3|elements: 3/)).not.toBeInTheDocument();
  });

  it("opens image results from a real button and offers a labelled download", () => {
    render(
      <ToolBlockView
        block={{
          type: "tool",
          toolCallId: "t3",
          toolName: "generate_image",
          status: "completed",
          input: { model: "gpt-image-2" },
          outputSummary: "方向 A",
          artifacts: [
            {
              type: "image",
              title: "方向 A",
              url: "https://example.com/a.jpg",
              mimeType: "image/jpeg",
              width: 1024,
              height: 1365,
            },
          ],
        }}
      />,
    );

    expect(
      screen.getByRole("button", { name: "查看「方向 A」的详情" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "下载图片" }),
    ).toBeInTheDocument();
    // Not placed (no element id came back): no 「已放到画布」 stamp.
    expect(screen.queryByText("已放到画布")).not.toBeInTheDocument();
  });

  it("stamps a picture the run placed on the canvas", () => {
    render(
      <ToolBlockView
        block={{
          type: "tool",
          toolCallId: "t8",
          toolName: "generate_image",
          status: "completed",
          input: { model: "gpt-image-2" },
          output: { elementId: "el-1", title: "方向 B" },
          artifacts: [
            {
              type: "image",
              title: "方向 B",
              url: "https://example.com/b.jpg",
              mimeType: "image/jpeg",
              width: 1024,
              height: 1024,
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("已放到画布")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "查看「方向 B」的详情，已放到画布" }),
    ).toBeInTheDocument();
  });
});

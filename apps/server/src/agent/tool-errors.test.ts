import {
  BaseChatModel,
  type BaseChatModelParams,
} from "@langchain/core/language_models/chat_models";
import {
  AIMessage,
  type BaseMessage,
  HumanMessage,
  ToolMessage,
} from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import { ToolInputParsingException } from "@langchain/core/tools";
import { createDeepAgent } from "deepagents";
import { tool } from "langchain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { adaptDeepAgentStream, toolFailureText } from "./stream-adapter.js";
import {
  createToolErrorMiddleware,
  mustPropagate,
  toolErrorText,
  toolInputError,
} from "./tool-errors.js";

/** Answers with the scripted messages in turn, then 「完成」. */
class ScriptedChatModel extends BaseChatModel {
  readonly seen: BaseMessage[][] = [];
  constructor(
    private readonly script: AIMessage[],
    params: BaseChatModelParams = {},
  ) {
    super(params);
  }
  _llmType() {
    return "scripted";
  }
  override bindTools() {
    return this as never;
  }
  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    this.seen.push(messages);
    const message = this.script.shift() ?? new AIMessage("完成");
    return { generations: [{ message, text: String(message.content) }] };
  }
}

const call = (name: string, args: Record<string, unknown>, id: string) =>
  new AIMessage({
    content: "",
    tool_calls: [{ name, args, id, type: "tool_call" }],
  });

// The schema the image tool had before 904d4f9: an old value fails parsing.
const strictTool = tool(async ({ quality }) => `ok ${quality}`, {
  name: "strict_tool",
  description: "Takes a quality.",
  schema: z.object({ quality: z.enum(["auto", "low", "medium", "high"]) }),
});
const brokenTool = tool(
  async () => {
    throw new Error("database unavailable");
  },
  { name: "broken_tool", description: "Always fails.", schema: z.object({}) },
);
const abortingTool = tool(
  async () => {
    const error = new Error("This operation was aborted");
    error.name = "AbortError";
    throw error;
  },
  { name: "aborting_tool", description: "Stopped.", schema: z.object({}) },
);

function agentWith(model: ScriptedChatModel, withMiddleware: boolean) {
  return createDeepAgent({
    model,
    tools: [strictTool, brokenTool, abortingTool],
    ...(withMiddleware ? { middleware: [createToolErrorMiddleware()] } : {}),
  });
}

afterEach(() => vi.restoreAllMocks());

describe("tool errors in a deep agent run", () => {
  it("without the middleware, one rejected argument ends the whole run", async () => {
    const model = new ScriptedChatModel([
      call("strict_tool", { quality: "standard" }, "call_1"),
    ]);
    await expect(
      agentWith(model, false).invoke({
        messages: [new HumanMessage("画一张")],
      }),
    ).rejects.toThrow(/strict_tool/);
  });

  it("hands rejected arguments and tool failures back to the model, and the run finishes", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const model = new ScriptedChatModel([
      call("strict_tool", { quality: "standard" }, "call_1"),
      call("strict_tool", { quality: "auto" }, "call_2"),
      call("broken_tool", {}, "call_3"),
    ]);
    const result = await agentWith(model, true).invoke({
      messages: [new HumanMessage("画一张")],
    });

    const tools = result.messages.filter((m: BaseMessage) =>
      ToolMessage.isInstance(m),
    ) as ToolMessage[];
    const byId = new Map(tools.map((m) => [m.tool_call_id, m]));
    expect(byId.get("call_1")?.status).toBe("error");
    expect(String(byId.get("call_1")?.content)).toContain("参数不符合要求");
    expect(String(byId.get("call_2")?.content)).toBe("ok auto");
    expect(byId.get("call_3")?.status).toBe("error");
    expect(String(byId.get("call_3")?.content)).toContain(
      "broken_tool 执行出错",
    );
    expect(String(result.messages.at(-1)?.content)).toBe("完成");
    // The model saw the argument error before it fixed the call.
    expect(
      model.seen[1]?.some((m) => String(m.content).includes("参数不符合要求")),
    ).toBe(true);
  });

  it("still ends the run when a tool was stopped", async () => {
    const model = new ScriptedChatModel([call("aborting_tool", {}, "call_1")]);
    await expect(
      agentWith(model, true).invoke({ messages: [new HumanMessage("停")] }),
    ).rejects.toThrow(/aborted/);
  });

  it("closes the failed tool's block in the chat and completes the run", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const model = new ScriptedChatModel([call("broken_tool", {}, "call_1")]);
    const stream = agentWith(model, true).streamEvents(
      { messages: [new HumanMessage("画一张")] },
      { version: "v2" },
    );
    const events = [];
    for await (const event of adaptDeepAgentStream({
      conversationId: "c1",
      runId: "run_1",
      sessionId: "s1",
      stream,
    })) {
      events.push(event);
    }
    const types = events.map((e) => e.type);
    expect(types).toContain("tool.started");
    const done = events.find(
      (e) => e.type === "tool.completed" && e.toolName === "broken_tool",
    );
    expect(done).toMatchObject({
      output: { error: toolFailureText("broken_tool") },
    });
    expect(types.at(-1)).toBe("run.completed");
    expect(types).not.toContain("run.failed");
  });
});

describe("tool error texts", () => {
  it("lets the model retry an argument error: nothing was sent", () => {
    const parsing = new ToolInputParsingException("bad quality", "{}");
    const wrapped = Object.assign(new Error("Error invoking tool"), {
      toolError: parsing,
    });
    expect(toolInputError(wrapped)).toBe(parsing);
    expect(toolErrorText("generate_image", wrapped)).toContain(
      "没有发出任何请求",
    );
    expect(toolErrorText("generate_image", wrapped)).toContain("重新调用");
  });

  it("tells the model not to send a paid request again after any other failure", () => {
    const text = toolErrorText("generate_image", new Error("socket hang up"));
    expect(text).toContain("不要为同一张图再次调用");
    expect(text).toContain("待核对");
    expect(toolErrorText("inspect_canvas", new Error("x"))).not.toContain(
      "待核对",
    );
  });

  it("masks secrets in what the model reads", () => {
    const text = toolErrorText(
      "inspect_canvas",
      new Error(
        "fetch https://user:pass@db.example/x with sk-abcdefghijkl failed",
      ),
    );
    expect(text).not.toContain("pass@");
    expect(text).not.toContain("sk-abcdefghijkl");
  });

  it("keeps stops and graph interrupts fatal", () => {
    const aborted = new AbortController();
    aborted.abort();
    expect(mustPropagate(new Error("x"), aborted.signal)).toBe(true);
    const abortError = Object.assign(new Error("stop"), { name: "AbortError" });
    expect(mustPropagate(abortError, undefined)).toBe(true);
    expect(
      mustPropagate(
        Object.assign(new Error("i"), { is_bubble_up: true }),
        undefined,
      ),
    ).toBe(true);
    expect(
      mustPropagate(new Error("db down"), new AbortController().signal),
    ).toBe(false);
  });

  it("does not claim a picture failed: it may have been made", () => {
    expect(toolFailureText("generate_image")).toContain("图片可能已经生成");
    expect(toolFailureText("generate_image")).not.toMatch(/扣费|收费|计费/);
  });
});

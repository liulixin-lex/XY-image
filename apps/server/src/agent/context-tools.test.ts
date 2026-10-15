import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { ContextOverflowError } from "@langchain/core/errors";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type ToolMessage,
} from "@langchain/core/messages";
import { afterEach, describe, expect, it, vi } from "vitest";

import { mapProviderStatus } from "../features/chat-providers/errors.js";
import { causeChain } from "../utils/error-chain.js";
import { isContextOverflowText } from "../utils/context-overflow.js";
import { createStreamingChatModel } from "./deep-agent.js";
import {
  PROJECT_MEMORY_PATH,
  createProjectMemoryMiddleware,
  projectMemorySection,
} from "./project-memory.js";
import {
  LOOP_GUARD_TEXT,
  createLoopGuardMiddleware,
  createReadToolRetryMiddleware,
} from "./run-guards.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(cleanups.splice(0).map((close) => close()));
});
type Hooks = {
  beforeAgent?: (state: unknown, runtime: unknown) => Promise<unknown>;
  wrapModelCall?: (request: unknown, handler: (r: unknown) => Promise<unknown>) => Promise<unknown>;
  wrapToolCall?: (request: unknown, handler: (r: unknown) => Promise<unknown>) => Promise<unknown>;
};

describe("project memory (第 67 条)", () => {
  it("reads /memories/AGENTS.md once per run and appends it to the system prompt", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const readRaw = vi.fn(async (path: string) => {
      expect(path).toBe(PROJECT_MEMORY_PATH);
      return { content: ["- 品牌主色：珊瑚红 #E5533D", "- 用户不要在产品图上放文字"] };
    });
    const mw = createProjectMemoryMiddleware({ readRaw } as never) as unknown as Hooks;
    await mw.beforeAgent?.({}, {});
    const seen: SystemMessage[] = [];
    const call = () =>
      mw.wrapModelCall?.({ systemMessage: new SystemMessage("你是设计助手"), messages: [] }, async (r) => {
        seen.push((r as { systemMessage: SystemMessage }).systemMessage);
        return new AIMessage("ok");
      });
    await call();
    await call();
    expect(readRaw).toHaveBeenCalledOnce();
    const text = JSON.stringify(seen[0]?.content);
    expect(text).toContain("你是设计助手");
    expect(text).toContain("珊瑚红");
    expect(text).toContain("<project_memory>");
    // Same text on every call of the run: the prompt cache keeps hitting.
    expect(JSON.stringify(seen[1]?.content)).toBe(text);
  });

  it("says where to keep it when there is none yet, and cuts a long one", async () => {
    const mw = createProjectMemoryMiddleware({
      readRaw: async () => {
        throw new Error("file not found");
      },
    } as never) as unknown as Hooks;
    await mw.beforeAgent?.({}, {});
    let system = "";
    await mw.wrapModelCall?.({ systemMessage: new SystemMessage("base"), messages: [] }, async (r) => {
      system = JSON.stringify((r as { systemMessage: SystemMessage }).systemMessage.content);
      return new AIMessage("ok");
    });
    expect(system).toContain("现在还是空的");
    expect(system).toContain(PROJECT_MEMORY_PATH);
    expect(projectMemorySection("长".repeat(7000))).toContain("已截断");
    expect(projectMemorySection("x")).toContain("不记任何密钥");
  });
});

describe("run guard rails", () => {
  it("refuses the same tool call a third time in a row (第 70 条, no call budget)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const mw = createLoopGuardMiddleware() as unknown as Hooks;
    const handler = vi.fn(async () => "ran");
    const call = (args: Record<string, unknown>) =>
      mw.wrapToolCall?.({ toolCall: { id: "t", name: "inspect_canvas", args } }, handler);
    expect(await call({ a: 1, b: 2 })).toBe("ran");
    // The same arguments in another key order are the same call.
    expect(await call({ b: 2, a: 1 })).toBe("ran");
    const third = (await call({ a: 1, b: 2 })) as ToolMessage;
    expect(handler).toHaveBeenCalledTimes(2);
    expect(String(third.content)).toBe(LOOP_GUARD_TEXT);
    // Anything in between starts the count again.
    expect(await call({ a: 2 })).toBe("ran");
    expect(await call({ a: 1, b: 2 })).toBe("ran");
  });

  it("tries a read-only tool again after a dropped connection, never a paid one", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const mw = createReadToolRetryMiddleware([0, 0]) as unknown as Hooks;
    let calls = 0;
    const flaky = async () => {
      calls += 1;
      if (calls < 3) throw new TypeError("fetch failed");
      return "ok";
    };
    expect(await mw.wrapToolCall?.({ toolCall: { name: "inspect_canvas" } }, flaky)).toBe("ok");
    expect(calls).toBe(3);
    calls = 0;
    await expect(mw.wrapToolCall?.({ toolCall: { name: "generate_image" } }, flaky)).rejects.toThrow("fetch failed");
    expect(calls).toBe(1);
    calls = 0;
    await expect(
      mw.wrapToolCall?.({ toolCall: { name: "inspect_canvas" } }, async () => {
        calls += 1;
        throw new Error("element_not_found");
      }),
    ).rejects.toThrow("element_not_found");
    expect(calls).toBe(1);
  });
});

describe("context overflow", () => {
  it("recognises the usual wordings", () => {
    expect(isContextOverflowText("This model's maximum context length is 128000 tokens")).toBe(true);
    expect(isContextOverflowText("context_length_exceeded")).toBe(true);
    expect(isContextOverflowText("prompt is too long: 210000 tokens > 200000 maximum")).toBe(true);
    expect(isContextOverflowText("bad image size")).toBe(false);
  });

  it("puts a ContextOverflowError in the chain for the main site and for providers", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const server = createServer(async (request, response) => {
      for await (const _ of request) {
        /* drain */
      }
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { code: "context_length_exceeded", message: "This model's maximum context length is 272000 tokens" } }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    cleanups.push(() => new Promise((resolve) => server.close(() => resolve())));
    const model = createStreamingChatModel("openai:gpt-5.4", {
      apiKey: "k",
      baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    });
    const error = await model.invoke([new HumanMessage("hi")]).catch((e: unknown) => e);
    expect([...causeChain(error)].some((e) => ContextOverflowError.isInstance(e))).toBe(true);
    const provider = mapProviderStatus(400, "prompt is too long for this model");
    expect([...causeChain(provider)].some((e) => ContextOverflowError.isInstance(e))).toBe(true);
    expect([...causeChain(mapProviderStatus(400, "bad request"))].some((e) => ContextOverflowError.isInstance(e))).toBe(false);
  });
});

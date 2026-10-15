import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { InMemoryStore, MemorySaver } from "@langchain/langgraph";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAgentBackend } from "./backends/index.js";
import {
  CONTEXT_WINDOW,
  MODEL_NODE,
  type ThreadGraph,
  compactAgentThread,
  createContextWindowMiddleware,
  cutoffForKeep,
  effectiveMessages,
  estimateTokens,
  readThreadContext,
  safeCutoff,
  textTokens,
} from "./context-window.js";
import { createLoomicDeepAgent } from "./deep-agent.js";

afterEach(() => vi.restoreAllMocks());

const quiet = () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
};

describe("context window (第 70 条)", () => {
  it("counts Chinese at about a token a character, pictures at a fixed cost", () => {
    expect(textTokens("一只橘猫趴在窗台上")).toBe(9);
    expect(textTokens("a cat on the windowsill")).toBe(6);
    const withPicture = new HumanMessage({
      content: [
        { type: "text", text: "看这张" },
        {
          type: "image_url",
          image_url: { url: `data:image/png;base64,${"A".repeat(400_000)}` },
        },
      ],
    });
    // The base64 bytes are not counted as text.
    expect(estimateTokens([withPicture])).toBeLessThan(1_100);
  });

  it("never cuts a tool result away from the call that asked for it", () => {
    const messages = [
      new HumanMessage("搭一个工作流"),
      new AIMessage({
        content: "",
        tool_calls: [{ id: "c1", name: "canvas_workflow", args: {} }],
      }),
      new ToolMessage({ content: "ok", tool_call_id: "c1" }),
      new AIMessage("好了"),
    ];
    expect(safeCutoff(messages, 2)).toBe(1);
    expect(safeCutoff(messages, 3)).toBe(3);
    // Even a tiny budget keeps the newest message.
    expect(cutoffForKeep(messages, 3)).toBe(3);
    expect(cutoffForKeep(messages, 100_000)).toBe(0);
  });

  it("summarises the older turns at 80 % of the window and reports it", async () => {
    quiet();
    const summarizer = new FakeListChatModel({
      responses: ["用户要一张橘猫海报，已经搭好 g1。"],
    });
    const middleware = createContextWindowMiddleware({
      model: summarizer as never,
      window: 2_000,
    }) as unknown as {
      wrapModelCall: (r: unknown, h: unknown) => Promise<unknown>;
    };
    const long = "很长的说明".repeat(120); // ~600 tokens each
    const messages = [
      new HumanMessage(long),
      new AIMessage(long),
      new HumanMessage(long),
      new AIMessage("短"),
      new HumanMessage("现在把背景换成蓝色"),
    ];
    let sent: unknown[] = [];
    const response = await middleware.wrapModelCall(
      {
        messages,
        state: { messages },
        systemMessage: new SystemMessage("你是设计助手"),
        tools: [],
      },
      async (request: { messages: unknown[] }) => {
        sent = request.messages;
        return new AIMessage({
          content: "好",
          usage_metadata: {
            input_tokens: 300,
            output_tokens: 2,
            total_tokens: 302,
          },
        } as never);
      },
    );
    const first = sent[0] as HumanMessage;
    expect(first.additional_kwargs.lc_source).toBe("summarization");
    expect(String(first.content)).toContain("橘猫海报");
    // The latest request is still there word for word.
    expect(String((sent.at(-1) as HumanMessage).content)).toBe(
      "现在把背景换成蓝色",
    );
    expect(sent.length).toBeLessThan(messages.length + 1);
    // The state event replaces the dropped turns for the next calls.
    const update = (
      response as { update?: { _summarizationEvent?: { cutoffIndex: number } } }
    ).update;
    expect(update?._summarizationEvent?.cutoffIndex).toBeGreaterThan(0);
  });

  it("leaves a short conversation alone", async () => {
    quiet();
    const summarizer = { invoke: vi.fn() };
    const middleware = createContextWindowMiddleware({
      model: summarizer as never,
    }) as unknown as {
      wrapModelCall: (r: unknown, h: unknown) => Promise<unknown>;
    };
    const messages = [new HumanMessage("你好")];
    const reply = new AIMessage("你好！");
    expect(
      await middleware.wrapModelCall(
        {
          messages,
          state: { messages },
          systemMessage: new SystemMessage("x"),
          tools: [],
        },
        async () => reply,
      ),
    ).toBe(reply);
    expect(summarizer.invoke).not.toHaveBeenCalled();
    expect(CONTEXT_WINDOW).toBe(100_000);
  });

  it("compacts a stored thread by hand and the next turn sees the summary (压缩)", async () => {
    quiet();
    const seen: unknown[][] = [];
    class Capturing extends FakeListChatModel {
      override bindTools() {
        return this as never;
      }
      override async _generate(
        ...args: Parameters<FakeListChatModel["_generate"]>
      ) {
        seen.push(args[0]);
        return super._generate(...args);
      }
    }
    const checkpointer = new MemorySaver();
    const store = new InMemoryStore();
    const canvasId = "00000000-0000-4000-8000-000000000002";
    const build = () =>
      createLoomicDeepAgent({
        env: { agentBackendMode: "state", agentModel: "gpt-5.4" } as never,
        canvasId,
        checkpointer,
        store,
        backendResult: createAgentBackend(
          { agentBackendMode: "state" } as never,
          canvasId,
        ),
        model: new Capturing({
          responses: [
            "好的，海报做好了。",
            "摘要：用户在做橘猫海报。",
            "已换成蓝色。",
          ],
        }) as never,
        createUserClient: (() => ({})) as never,
      });
    const config = { configurable: { thread_id: "t-compact" } };
    const run = (text: string) =>
      (
        build() as unknown as {
          invoke: (i: unknown, c: unknown) => Promise<unknown>;
        }
      ).invoke({ messages: [new HumanMessage(text)] }, config);
    await run(
      `做一张橘猫海报，暖色调，留出标题位置。参考资料：${"窗台上的橘猫在晨光里打盹，".repeat(500)}`,
    );
    const agent = build();
    expect(agent.graph).toBeDefined();
    const graph = agent.graph as unknown as ThreadGraph & {
      nodes: Record<string, unknown>;
    };
    expect(Object.keys(graph.nodes)).toContain(MODEL_NODE);
    const before = await readThreadContext(graph, "t-compact");
    const result = await compactAgentThread({
      graph,
      threadId: "t-compact",
      deps: {
        model: new FakeListChatModel({
          responses: ["用户在做一张暖色调橘猫海报，留了标题位。"],
        }) as never,
        backend: createAgentBackend(
          { agentBackendMode: "state" } as never,
          canvasId,
        ).factory,
        store,
      },
    });
    expect(result.compacted).toBe(true);
    expect(result.usedTokens).toBeLessThanOrEqual(before.usedTokens + 200);
    const after = await readThreadContext(graph, "t-compact");
    expect(after.compacted).toBe(true);
    // The history went to the project's store, readable later.
    const saved = await store.search(["projects", canvasId, "history"]);
    expect(saved.length).toBe(1);

    seen.length = 0;
    await run("把背景换成蓝色");
    const input = seen[0] as Array<{
      content: unknown;
      additional_kwargs?: Record<string, unknown>;
    }>;
    const summary = input.find(
      (m) => m.additional_kwargs?.lc_source === "summarization",
    );
    expect(String(summary?.content)).toContain("暖色调橘猫海报");
    expect(String(input.at(-1)?.content)).toBe("把背景换成蓝色");
    // The thread goes on normally after the update.
    const state = await graph.getState(config);
    const stored = (state.values as { messages: unknown[] }).messages;
    expect(stored.length).toBe(4);
    expect(
      effectiveMessages(
        stored as never,
        (state.values as { _summarizationEvent?: never })._summarizationEvent,
      ).length,
    ).toBeGreaterThan(1);
  });
});

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { HumanMessage } from "@langchain/core/messages";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { createDeepAgent } from "deepagents";
import { afterEach, describe, expect, it, vi } from "vitest";

import { mapProviderStatus } from "../features/chat-providers/errors.js";
import {
  GatewayError,
  gatewayDiagnostics,
  mapGatewayError,
} from "../features/xy2api/errors.js";
import { createStreamingChatModel } from "./deep-agent.js";
import {
  WEB_SEARCH_TOOL,
  chatEffortKwargs,
  createChatOptionsMiddleware,
  lowerChatEffort,
  refusedChatOption,
} from "./model-options.js";
import { thinkingText, webSearchCalls } from "./stream-adapter.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(cleanups.splice(0).map((close) => close()));
});

/** A gateway that records request bodies and answers in either API. */
async function gateway() {
  const bodies: Array<{ path: string; body: Record<string, unknown> }> = [];
  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw || "{}") as Record<string, unknown>;
    bodies.push({ path: request.url ?? "", body });
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    if (request.url?.endsWith("/responses")) {
      const events = [
        { type: "response.created", response: { id: "resp_1", model: body.model, output: [] } },
        { type: "response.output_item.added", output_index: 0, item: { id: "msg_1", type: "message", role: "assistant", content: [] } },
        { type: "response.output_text.delta", item_id: "msg_1", output_index: 0, content_index: 0, delta: "好" },
        {
          type: "response.completed",
          response: {
            id: "resp_1",
            model: body.model,
            status: "completed",
            output: [{ id: "msg_1", type: "message", role: "assistant", content: [{ type: "output_text", text: "好", annotations: [] }] }],
            usage: { input_tokens: 2000, input_tokens_details: { cached_tokens: 1536 }, output_tokens: 3, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 2003 },
          },
        },
      ];
      response.end(events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(""));
      return;
    }
    const chunk = {
      id: "c1",
      object: "chat.completion.chunk",
      created: 1,
      model: body.model,
      choices: [{ index: 0, delta: { role: "assistant", content: "好" }, finish_reason: "stop" }],
    };
    response.end(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  return {
    bodies,
    credentials: {
      apiKey: "synthetic-key",
      baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    },
  };
}

describe("effort and prompt cache on the wire (第 67 条)", () => {
  it("sends reasoning.effort with a summary to gpt-6 models over the Responses API", async () => {
    const g = await gateway();
    const model = createStreamingChatModel("openai:gpt-6.1-sol", g.credentials, {
      effort: "xhigh",
      promptCacheKey: "xyimg-abc",
    });
    await model.invoke([new HumanMessage("hi")]);
    expect(g.bodies[0]?.path).toBe("/v1/responses");
    expect(g.bodies[0]?.body).toMatchObject({
      model: "gpt-6.1-sol",
      reasoning: { effort: "xhigh", summary: "auto" },
      prompt_cache_key: "xyimg-abc",
    });
  });

  it("asks gpt-6 for a reasoning summary only, on 自动", async () => {
    const g = await gateway();
    await createStreamingChatModel("openai:gpt-6-sol", g.credentials, {
      effort: "auto",
    }).invoke([new HumanMessage("hi")]);
    expect(g.bodies[0]?.body.reasoning).toEqual({ summary: "auto" });
  });

  it("sends reasoning_effort to chat-completions models, with usage", async () => {
    const g = await gateway();
    await createStreamingChatModel("openai:gemini-3.8-flash", g.credentials, {
      effort: "high",
    }).invoke([new HumanMessage("hi")]);
    expect(g.bodies[0]?.path).toBe("/v1/chat/completions");
    expect(g.bodies[0]?.body).toMatchObject({
      reasoning_effort: "high",
      stream_options: { include_usage: true },
    });
    expect(g.bodies[0]?.body.reasoning).toBeUndefined();
  });

  it("moves a model with web search to the Responses API, with the effort in its shape", async () => {
    const g = await gateway();
    const model = createStreamingChatModel("openai:grok-4.7", g.credentials, {
      effort: "high",
      webSearch: true,
    }) as unknown as { bindTools: (tools: unknown[]) => { invoke: (m: unknown[]) => Promise<unknown> } };
    await model.bindTools([WEB_SEARCH_TOOL]).invoke([new HumanMessage("hi")]);
    expect(g.bodies[0]?.path).toBe("/v1/responses");
    expect(g.bodies[0]?.body).toMatchObject({
      reasoning: { effort: "high" },
      tools: [{ type: "web_search" }],
    });
    // No summary field for Grok: xAI does not document it.
    expect((g.bodies[0]?.body.reasoning as Record<string, unknown>).summary).toBeUndefined();
  });

  it("sends nothing for 自动 off the Responses API, and nothing at all when off", () => {
    expect(chatEffortKwargs("gemini-3.8-flash", "auto", false)).toEqual({});
    expect(chatEffortKwargs("gpt-6-sol", "off", true)).toEqual({});
  });
});

const refusal = (status: number, message: string) =>
  Object.assign(new Error("Connection error."), {
    cause: new GatewayError({
      ...mapGatewayError({ status, body: { error: { message } }, responseReceived: true }),
      diagnostics: gatewayDiagnostics({ status, body: { error: { message } } }),
    }),
  });

describe("a model that refuses an option", () => {
  it("reads what the refusal is about", () => {
    expect(refusedChatOption(refusal(400, "Unsupported tool type: web_search"))).toBe("web_search");
    expect(refusedChatOption(refusal(400, "reasoning effort 'max' is not supported"))).toBe("effort");
    expect(refusedChatOption(refusal(400, "bad image size"))).toBeUndefined();
    expect(refusedChatOption(refusal(503, "reasoning busy"))).toBeUndefined();
    const provider = mapProviderStatus(400, "Unrecognized request argument supplied: reasoning_effort (key synthetic-private-key)");
    expect(refusedChatOption(Object.assign(new Error("x"), { cause: provider }))).toBe("effort");
    expect(JSON.stringify(provider)).not.toContain("synthetic-private-key");
  });

  it("steps down through the levels the model takes", () => {
    const main = { source: "xy2api" as const, model: "gpt-6.1-sol" };
    expect(lowerChatEffort(main, "max")).toBe("xhigh");
    expect(lowerChatEffort(main, "low")).toBe("auto");
    expect(lowerChatEffort(main, "auto")).toBe("off");
    const gemini = { source: "xy2api" as const, model: "gemini-3.8-flash" };
    expect(lowerChatEffort(gemini, "high")).toBe("medium");
  });

  function agent(failures: Error[], options: { webSearch: boolean; effort: "auto" | "max" | "high" }) {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const seenTools: unknown[][] = [];
    const rebuilt: string[] = [];
    let calls = 0;
    class Capturing extends FakeListChatModel {
      override async _generate(...args: Parameters<FakeListChatModel["_generate"]>) {
        const failure = failures[calls++];
        if (failure) throw failure;
        return super._generate(...args);
      }
      override bindTools(tools: unknown[]) {
        seenTools.push(tools);
        return this as never;
      }
    }
    const make = () => new Capturing({ responses: ["好的"] });
    const middleware = createChatOptionsMiddleware({
      ref: { source: "xy2api", model: "gpt-6.1-sol" },
      label: "gpt-6.1-sol",
      effort: options.effort,
      webSearch: options.webSearch,
      rebuild: (effort, webSearch) => {
        rebuilt.push(webSearch ? effort : `${effort}/no-search`);
        return make() as never;
      },
    });
    const deep = createDeepAgent({ model: make() as never, middleware: [middleware] });
    return {
      seenTools,
      rebuilt,
      calls: () => calls,
      run: () => deep.invoke({ messages: [new HumanMessage("你好")] }),
    };
  }

  const hasSearch = (tools: unknown[] | undefined) =>
    (tools ?? []).some((t) => (t as { type?: unknown }).type === "web_search");

  it("offers the hosted web_search tool alongside the agent's own tools", async () => {
    const a = agent([], { webSearch: true, effort: "auto" });
    await a.run();
    expect(hasSearch(a.seenTools[0])).toBe(true);
    expect((a.seenTools[0] ?? []).length).toBeGreaterThan(1);
  });

  it("goes on without web search when the model refuses it", async () => {
    const a = agent([refusal(400, "Tool type 'web_search' is not supported")], {
      webSearch: true,
      effort: "auto",
    });
    const state = await a.run();
    expect(state.messages.at(-1)?.content).toBe("好的");
    expect(hasSearch(a.seenTools[0])).toBe(true);
    expect(hasSearch(a.seenTools.at(-1))).toBe(false);
  });

  it("goes back to the old API when a search request is refused without a reason", async () => {
    const a = agent([refusal(404, "Not Found")], { webSearch: true, effort: "high" });
    const state = await a.run();
    expect(state.messages.at(-1)?.content).toBe("好的");
    expect(a.rebuilt).toEqual(["high/no-search"]);
    expect(hasSearch(a.seenTools.at(-1))).toBe(false);
  });

  it("steps the effort down when the model refuses it", async () => {
    const a = agent(
      [refusal(400, "reasoning effort 'max' is not supported for this model")],
      { webSearch: false, effort: "max" },
    );
    const state = await a.run();
    expect(state.messages.at(-1)?.content).toBe("好的");
    expect(a.rebuilt).toEqual(["xhigh/no-search"]);
  });

  it("drops a level a provider refused without saying why", async () => {
    const a = agent([refusal(400, "invalid parameter")], { webSearch: false, effort: "max" });
    await a.run();
    expect(a.rebuilt).toEqual(["auto/no-search"]);
  });

  it("never resends a moderation refusal without search or effort", async () => {
    const moderation = Object.assign(new Error("Connection error."), {
      cause: new GatewayError({
        ...mapGatewayError({ status: 400, body: { error: { message: "Your request was rejected by the safety system.", type: "content_policy_violation" } }, responseReceived: true }),
        diagnostics: gatewayDiagnostics({ status: 400, body: { error: { message: "Your request was rejected by the safety system." } } }),
      }),
    });
    const a = agent([moderation], { webSearch: true, effort: "max" });
    await expect(a.run()).rejects.toBeTruthy();
    expect(a.calls()).toBe(1);
    expect(a.rebuilt).toEqual([]);
  });

  it("does not hide other refusals", async () => {
    const a = agent([refusal(400, "invalid parameter")], { webSearch: false, effort: "auto" });
    await expect(a.run()).rejects.toBeTruthy();
    expect(a.calls()).toBe(1);
  });
});

describe("stream adapter helpers", () => {
  it("reads reasoning parts of both shapes", () => {
    expect(thinkingText({ type: "reasoning", reasoning: "先看看画布" })).toBe("先看看画布");
    expect(thinkingText({ type: "thinking", thinking: "想想" })).toBe("想想");
    expect(thinkingText({ type: "text", text: "答" })).toBeUndefined();
  });

  it("turns web_search_call items into tool blocks", () => {
    const calls = webSearchCalls({
      additional_kwargs: {
        tool_outputs: [
          { id: "ws_1", type: "web_search_call", status: "completed", action: { type: "search", query: "2026 海报 趋势", sources: [{ type: "url", url: "https://example.com/a" }] } },
          { id: "ws_2", type: "web_search_call", status: "completed", action: { type: "open_page", url: "https://example.com/b" } },
          { id: "ci_1", type: "code_interpreter_call" },
        ],
      },
    });
    expect(calls.map((c) => c.summary)).toEqual(["搜索「2026 海报 趋势」", "打开网页 example.com"]);
    expect(calls[0]?.output).toMatchObject({ query: "2026 海报 趋势", sources: [{ url: "https://example.com/a" }] });
    expect(webSearchCalls({ additional_kwargs: {} })).toEqual([]);
  });
});

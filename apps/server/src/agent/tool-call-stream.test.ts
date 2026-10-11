import type { AIMessageChunk } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { ChatOpenAICompletions } from "@langchain/openai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createCustomChatModel } from "../features/chat-providers/chat-model.js";
import {
  createGluedToolCallMiddleware,
  splitGluedToolCalls,
  splitJsonObjects,
} from "./glued-tool-calls.js";
import { adaptDeepAgentStream } from "./stream-adapter.js";
import {
  createToolCallIndexer,
  separateToolCallIndexes,
  streamEventError,
} from "./tool-call-stream.js";

// What o10.top sent for gemini-3.1-pro on 2026-10-11: two parallel read_file
// calls, both under index 0, arguments split across chunks.
const o10Chunks = [
  {
    id: "toolu_a",
    name: "read_file",
    args: '{"file_path":"/workspace-skills/',
  },
  { args: 'xy-poster-design/SKILL.md"}' },
  {
    id: "toolu_b",
    name: "read_file",
    args: '{"file_path":"/workspace-skills/',
  },
  { args: 'json-image-prompt/SKILL.md"}' },
].map(({ id, name, args }) => ({
  id: "chatcmpl-1",
  object: "chat.completion.chunk",
  created: 1,
  model: "gemini-3.1-pro",
  choices: [
    {
      index: 0,
      delta: {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            ...(id ? { id, type: "function" } : {}),
            function: { ...(name ? { name } : {}), arguments: args },
          },
        ],
      },
      finish_reason: null,
    },
  ],
}));

// What o10.top actually sent in the live probe (2026-10-11): ONE id, the
// other call's arguments arrive as id-less continuations of the first.
const o10SingleIdChunks = [
  {
    id: "toolu_a",
    name: "read_file",
    args: '{"file_path":"/workspace-skills/xy-poster-design/SKILL.md"}',
  },
  { args: '{"file_path":"/workspace-skills/json-image-' },
  { args: 'prompt/SKILL.md"}' },
].map(({ id, name, args }) => ({
  id: "chatcmpl-2",
  object: "chat.completion.chunk",
  created: 1,
  model: "gemini-3.1-pro",
  choices: [
    {
      index: 0,
      delta: {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            ...(id ? { id, type: "function" } : {}),
            function: { ...(name ? { name } : {}), arguments: args },
          },
        ],
      },
      finish_reason: null,
    },
  ],
}));

function sse(payloads: unknown[], { split = false } = {}) {
  const text = `${payloads.map((p) => `data: ${JSON.stringify(p)}\n\n`).join("")}data: [DONE]\n\n`;
  const bytes = new TextEncoder().encode(text);
  // split: deliver in 7-byte pieces so lines arrive cut in half.
  const pieces = split
    ? Array.from({ length: Math.ceil(bytes.length / 7) }, (_, i) =>
        bytes.slice(i * 7, i * 7 + 7),
      )
    : [bytes];
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const piece of pieces) controller.enqueue(piece);
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

const readFile = tool(async () => "", {
  name: "read_file",
  description: "Read a file",
  schema: z.object({ file_path: z.string() }),
});

async function streamToolCalls(model: ChatOpenAICompletions) {
  let merged: AIMessageChunk | undefined;
  for await (const chunk of await model
    .bindTools([readFile])
    .stream("读两个技能")) {
    merged = merged ? merged.concat(chunk) : chunk;
  }
  return merged;
}

describe("parallel tool calls streamed under one index", () => {
  it("glues the calls into one broken call without the fix (the bug)", async () => {
    const model = new ChatOpenAICompletions({
      model: "gemini-3.1-pro",
      apiKey: "test",
      configuration: {
        baseURL: "https://gw.test/v1",
        fetch: async () => sse(o10Chunks),
      },
      streaming: true,
      maxRetries: 0,
    });
    const merged = await streamToolCalls(model);
    // Continuations join the first call: one call has both paths glued
    // together (unparseable), the other only "/workspace-skills/".
    expect(merged?.invalid_tool_calls?.[0]?.args).toMatch(
      /xy-poster-design\/SKILL\.md"\}json-image-prompt/,
    );
    expect(merged?.tool_calls?.map((c) => c.args.file_path)).toEqual([
      "/workspace-skills/",
    ]);
  });

  it("gives each call its own index through the custom provider model", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const model = createCustomChatModel({
      model: "gemini-3.1-pro",
      baseUrl: "https://gw.test/v1",
      transport: async () => sse(o10Chunks, { split: true }),
    });
    const merged = await streamToolCalls(model);
    expect(merged?.invalid_tool_calls ?? []).toHaveLength(0);
    expect(merged?.tool_calls?.map((c) => [c.id, c.args.file_path])).toEqual([
      ["toolu_a", "/workspace-skills/xy-poster-design/SKILL.md"],
      ["toolu_b", "/workspace-skills/json-image-prompt/SKILL.md"],
    ]);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("leaves a correctly numbered stream byte for byte", async () => {
    const good = [
      { index: 0, id: "a", function: { name: "x", arguments: "{" } },
      { index: 1, id: "b", function: { name: "y", arguments: "{" } },
      { index: 0, function: { arguments: "}" } },
      { index: 1, function: { arguments: "}" } },
    ].map((call) => ({
      choices: [{ index: 0, delta: { tool_calls: [call] } }],
    }));
    const original = await sse(good).text();
    expect(await separateToolCallIndexes(sse(good)).text()).toBe(original);
  });

  it("renumbers continuations with the call they belong to", () => {
    const renumber = createToolCallIndexer();
    const payload = (call: object) => ({
      choices: [{ index: 0, delta: { tool_calls: [call] } }],
    });
    const calls = [
      { index: 0, id: "a" },
      { index: 0 },
      { index: 0, id: "b" },
      { index: 0 },
      { id: "c" }, // no index at all
      {},
    ];
    for (const call of calls) renumber(payload(call));
    expect(calls.map((c) => (c as { index?: number }).index)).toEqual([
      0, 0, 1, 1, 2, 2,
    ]);
  });

  it("does not touch JSON bodies or non-chat payloads", async () => {
    const json = new Response('{"choices":[]}', {
      headers: { "content-type": "application/json" },
    });
    expect(separateToolCallIndexes(json)).toBe(json);
    expect(
      createToolCallIndexer()({ type: "response.output_item.added" }),
    ).toBe(false);
  });
});

describe("parallel tool calls glued into one call", () => {
  it("splits the o10 single-id stream back into two calls", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const model = createCustomChatModel({
      model: "gemini-3.1-pro",
      baseUrl: "https://gw.test/v1",
      transport: async () => sse(o10SingleIdChunks, { split: true }),
    });
    // The agent's model node calls invoke, which concatenates the stream
    // chunks the same way; invoke itself also downloads tiktoken encodings
    // to estimate usage, so the test streams to stay offline.
    const raw = await streamToolCalls(model);
    if (!raw) throw new Error("no message");
    expect(raw.tool_calls ?? []).toHaveLength(0);
    expect(raw.invalid_tool_calls?.[0]?.args).toMatch(
      /SKILL\.md"\}\{"file_path/,
    );

    const middleware = createGluedToolCallMiddleware();
    const fixed = await middleware.wrapModelCall?.(
      {} as never,
      async () => raw,
    );
    expect(fixed).not.toBe(raw);
    const message = fixed as typeof raw;
    expect(message.invalid_tool_calls ?? []).toHaveLength(0);
    expect(message.tool_calls?.map((c) => [c.id, c.name, c.args])).toEqual([
      [
        "toolu_a",
        "read_file",
        { file_path: "/workspace-skills/xy-poster-design/SKILL.md" },
      ],
      [
        "toolu_a_2",
        "read_file",
        { file_path: "/workspace-skills/json-image-prompt/SKILL.md" },
      ],
    ]);
    expect(warn).toHaveBeenCalledWith(
      "[tool-calls] split 2 glued tool calls (read_file)",
    );
    warn.mockRestore();
  });

  it("leaves messages without broken calls as they are", async () => {
    const { AIMessage } = await import("@langchain/core/messages");
    const ok = new AIMessage({
      content: "",
      tool_calls: [{ name: "x", args: {}, id: "1", type: "tool_call" }],
    });
    expect(splitGluedToolCalls(ok)).toBe(ok);
    const broken = new AIMessage({
      content: "",
      invalid_tool_calls: [
        {
          name: "x",
          args: '{"a":',
          id: "1",
          error: "bad",
          type: "invalid_tool_call",
        },
      ],
    });
    expect(splitGluedToolCalls(broken)).toBe(broken);
  });

  it("only splits text that is whole JSON objects side by side", () => {
    expect(splitJsonObjects('{"a":1}{"b":"}{"}')).toEqual([
      { a: 1 },
      { b: "}{" },
    ]);
    expect(splitJsonObjects('{"a":{"n":[1,2]}}\n {"b":"\\"}"}')).toEqual([
      { a: { n: [1, 2] } },
      { b: '"}' },
    ]);
    for (const text of [
      '{"a":1}', // a single object is not glued
      '{"a":1}x{"b":2}',
      '{"a":1}[1]',
      '{"a":1}{"b":',
      '{"a":1}}{"b":2}',
      '{"a":1}{b:2}',
      "",
    ])
      expect(splitJsonObjects(text), text).toBeNull();
  });
});

describe("a run with no output", () => {
  async function run(events: unknown[]) {
    const out = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for await (const event of adaptDeepAgentStream({
      conversationId: "c1",
      runId: "run_1",
      sessionId: "s1",
      stream: (async function* () {
        yield* events;
      })(),
    }))
      out.push(event);
    warn.mockRestore();
    return out;
  }

  it("fails with a message instead of completing blank", async () => {
    const out = await run([]);
    expect(out.at(-1)).toMatchObject({
      type: "run.failed",
      error: {
        code: "run_failed",
        message: "模型这次没有返回内容。请重试，或换一个模型",
      },
    });
  });

  it("names a broken tool call when that is why", async () => {
    const { AIMessage } = await import("@langchain/core/messages");
    const out = await run([
      {
        event: "on_chat_model_end",
        data: {
          output: new AIMessage({
            content: "",
            invalid_tool_calls: [
              {
                name: "read_file",
                args: "{}{}",
                id: "t1",
                error: "bad json",
                type: "invalid_tool_call",
              },
            ],
          }),
        },
      },
    ]);
    expect(out.at(-1)).toMatchObject({
      type: "run.failed",
      error: { message: expect.stringContaining("工具调用格式不对") },
    });
  });

  it("still completes when the model said something", async () => {
    const { AIMessageChunk } = await import("@langchain/core/messages");
    const out = await run([
      {
        event: "on_chat_model_stream",
        data: { chunk: new AIMessageChunk("好的") },
      },
    ]);
    expect(out.map((e) => e.type)).toEqual([
      "run.started",
      "message.delta",
      "run.completed",
    ]);
  });
});

// FINDINGS A2 (production 2026-10-11): runs that read a skill and the
// canvas, then lost the last turn, ended "completed" with nothing on screen.
describe("a run that only read things", () => {
  async function run(events: unknown[]) {
    const out = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    for await (const event of adaptDeepAgentStream({
      conversationId: "c1",
      runId: "run_1",
      sessionId: "s1",
      stream: (async function* () {
        yield* events;
      })(),
    }))
      out.push(event);
    warn.mockRestore();
    info.mockRestore();
    return out;
  }
  const tool = (name: string, id: string, output: unknown) => [
    { event: "on_tool_start", name, run_id: id, data: { input: {} } },
    { event: "on_tool_end", name, run_id: id, data: { output } },
  ];
  it("fails when no text, picture or canvas change came out", async () => {
    const out = await run([
      ...tool("read_file", "t1", "skill text"),
      ...tool("inspect_canvas", "t2", { elements: [] }),
    ]);
    expect(out.at(-1)).toMatchObject({
      type: "run.failed",
      error: { message: "这次没有得到回复，可以重试，或换一个对话模型" },
    });
  });
  it("completes after a canvas change without text", async () => {
    const out = await run([...tool("manipulate_canvas", "t1", { ok: true })]);
    expect(out.at(-1)).toMatchObject({ type: "run.completed" });
  });
});

// FINDINGS A2: an upstream 503 on the second turn arrived inside a 200
// Responses stream; LangChain ignored it and the turn ended empty.
describe("errors reported inside a stream", () => {
  it("recognises Responses and chat-completions error events", () => {
    expect(
      streamEventError({
        type: "error",
        code: "service_unavailable_error",
        message: "Upstream service unavailable",
      }),
    ).toMatchObject({ code: "upstream_busy" });
    expect(
      streamEventError({
        type: "response.failed",
        response: { error: { code: "server_error", message: "boom" } },
      }),
    ).toMatchObject({ code: "upstream_busy" });
    expect(
      streamEventError({
        error: { message: "内容审计命中风险规则，请调整输入后重试", type: "content_policy_violation" },
      }),
    ).toMatchObject({ code: "safety_filter" });
    expect(streamEventError({ type: "response.output_text.delta", delta: "hi" })).toBeNull();
    expect(streamEventError({ choices: [], error: null })).toBeNull();
  });
  it("turns the stream into a thrown error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const response = separateToolCallIndexes(
      sse([
        { type: "response.created", response: { id: "r1" } },
        { type: "error", code: "service_unavailable_error", message: "unavailable" },
      ]),
    );
    await expect(response.text()).rejects.toMatchObject({ code: "upstream_busy" });
    warn.mockRestore();
  });
});

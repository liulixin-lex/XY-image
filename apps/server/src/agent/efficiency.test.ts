import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { mutateCanvas } from "../features/canvas/canvas-mutation.js";
import { createLoomicDeepAgent } from "./deep-agent.js";
import {
  createChatOptionsMiddleware,
  executionEffort,
  followsToolResult,
  planningEffort,
} from "./model-options.js";
import {
  RUN_WRAP_UP_NOTE,
  createRunBudgetMiddleware,
  createToolDietMiddleware,
} from "./run-budget.js";
import { SKILLS_INLINE_BUDGET, skillsSection } from "./skills-prompt.js";

afterEach(() => vi.restoreAllMocks());

const main = (model: string) => ({ source: "xy2api" as const, model });
const custom = (model: string) => ({
  source: "custom" as const,
  providerId: "p",
  model,
});

describe("思考强度 that does not run away (第 69 条)", () => {
  it("thinks at 中 for 自动 when reading the request, at 低 after tool results", () => {
    expect(planningEffort(main("gpt-6.1-sol"), "auto")).toBe("medium");
    expect(executionEffort(main("gpt-6.1-sol"), "medium", "auto")).toBe("low");
    // Gemini on the main site and personal providers keep sending nothing.
    expect(planningEffort(main("gemini-3.8-flash"), "auto")).toBe("auto");
    expect(planningEffort(custom("deepseek-v4"), "auto")).toBe("auto");
    expect(executionEffort(custom("deepseek-v4"), "auto", "auto")).toBe("auto");
  });

  it("uses a chosen level for the first call and at most 中 afterwards", () => {
    expect(planningEffort(main("gpt-6.1-sol"), "max")).toBe("max");
    expect(executionEffort(main("gpt-6.1-sol"), "max", "max")).toBe("medium");
    expect(executionEffort(main("gpt-6.1-sol"), "high", "high")).toBe("medium");
    expect(executionEffort(main("gpt-6.1-sol"), "low", "low")).toBe("low");
    expect(executionEffort(main("gpt-6.1-sol"), "medium", "medium")).toBe(
      "medium",
    );
    expect(executionEffort(custom("x"), "high", "high")).toBe("medium");
  });

  it("knows a call that follows a tool result", () => {
    expect(followsToolResult([new HumanMessage("hi")])).toBe(false);
    expect(
      followsToolResult([
        new HumanMessage("hi"),
        new AIMessage({
          content: "",
          tool_calls: [{ id: "t1", name: "x", args: {} }],
        }),
        new ToolMessage({ content: "ok", tool_call_id: "t1" }),
      ]),
    ).toBe(true);
  });

  it("switches to the capped model only for calls after a tool result", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const built: string[] = [];
    const middleware = createChatOptionsMiddleware({
      ref: main("gpt-6.1-sol"),
      label: "gpt-6.1-sol",
      effort: "high",
      chosen: "high",
      search: "off",
      rebuild: (effort, hosted) => {
        built.push(`${effort}${hosted ? "" : "/no-search"}`);
        return new FakeListChatModel({ responses: ["x"] }) as never;
      },
    });
    const seen: unknown[] = [];
    const handler = vi.fn(async (request: { model?: unknown }) => {
      seen.push(request.model);
      return new AIMessage("ok");
    });
    const call = (messages: unknown[]) =>
      (
        middleware as unknown as {
          wrapModelCall: (r: unknown, h: unknown) => Promise<unknown>;
        }
      ).wrapModelCall({ messages, tools: [], model: "agent-model" }, handler);
    await call([new HumanMessage("海报")]);
    await call([
      new HumanMessage("海报"),
      new ToolMessage({ content: "done", tool_call_id: "a" }),
    ]);
    await call([
      new HumanMessage("海报"),
      new ToolMessage({ content: "done", tool_call_id: "b" }),
    ]);
    expect(seen[0]).toBe("agent-model");
    expect(seen[1]).not.toBe("agent-model");
    expect(seen[2]).toBe(seen[1]); // built once, reused
    expect(built).toEqual(["medium/no-search"]);
  });
});

describe("steps and tools of a run (第 69 条)", () => {
  it("asks the model to wrap up without tools near the budget, then stops", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const middleware = createRunBudgetMiddleware(4, 3) as unknown as {
      wrapModelCall: (r: unknown, h: unknown) => Promise<unknown>;
    };
    const requests: Array<{
      tools: unknown[];
      systemMessage: { content: unknown };
    }> = [];
    const handler = async (request: {
      tools: unknown[];
      systemMessage: { content: unknown };
    }) => {
      requests.push(request);
      return new AIMessage("ok");
    };
    const { SystemMessage } = await import("@langchain/core/messages");
    const request = {
      tools: [{ name: "t" }],
      systemMessage: new SystemMessage("base"),
      messages: [],
    };
    await middleware.wrapModelCall(request, handler);
    await middleware.wrapModelCall(request, handler);
    await middleware.wrapModelCall(request, handler);
    await middleware.wrapModelCall(request, handler);
    const stopped = (await middleware.wrapModelCall(
      request,
      handler,
    )) as AIMessage;
    expect(requests[1]?.tools).toHaveLength(1);
    expect(requests[2]?.tools).toEqual([]);
    expect(JSON.stringify(requests[2]?.systemMessage.content)).toContain(
      RUN_WRAP_UP_NOTE.slice(0, 20),
    );
    expect(requests).toHaveLength(4);
    expect(String(stopped.content)).toContain("步骤太多");
  });

  it("hides ls, glob and grep from the model", async () => {
    const middleware = createToolDietMiddleware() as unknown as {
      wrapModelCall: (r: unknown, h: unknown) => Promise<unknown>;
    };
    let names: string[] = [];
    await middleware.wrapModelCall(
      {
        tools: ["ls", "read_file", "glob", "grep", "canvas_workflow"].map(
          (name) => ({ name }),
        ),
      },
      async (request: { tools: Array<{ name: string }> }) => {
        names = request.tools.map((t) => t.name);
        return new AIMessage("ok");
      },
    );
    expect(names).toEqual(["read_file", "canvas_workflow"]);
  });

  it("gives the design assistant no todo list, sub-agents or directory tools", async () => {
    let bound: string[] = [];
    class Capturing extends FakeListChatModel {
      override bindTools(
        tools: Array<{ name?: string; function?: { name?: string } }>,
      ) {
        bound = tools.map((t) => t.name ?? t.function?.name ?? "");
        return this as never;
      }
    }
    const agent = createLoomicDeepAgent({
      env: { agentBackendMode: "state", agentModel: "gpt-5.4" } as never,
      canvasId: "00000000-0000-4000-8000-000000000001",
      model: new Capturing({ responses: ["好的"] }) as never,
      createUserClient: (() => ({})) as never,
      workspaceSkills: [
        {
          name: "生图提示词规范",
          description: "写提示词",
          path: "/skills/prompt/SKILL.md",
          content: "---\nname: x\n---\n按场景、主体、细节写",
          files: [],
        },
      ],
    });
    await (
      agent as unknown as { invoke: (input: unknown) => Promise<unknown> }
    ).invoke({
      messages: [new HumanMessage("你好")],
    });
    expect(bound).toEqual(
      expect.arrayContaining([
        "read_file",
        "write_file",
        "apply_patch",
        "canvas_workflow",
        "generate_image",
      ]),
    );
    for (const name of ["write_todos", "task", "ls", "glob", "grep", "execute"])
      expect(bound).not.toContain(name);
  });
});

describe("skills in the system prompt (第 69 条)", () => {
  const skill = (name: string, size: number, files = 0) => ({
    name,
    description: `${name} 的说明`,
    path: `/skills/${name}/SKILL.md`,
    content: `---\nname: ${name}\n---\n${"字".repeat(size)}`,
    files: Array.from({ length: files }, (_, i) => ({
      path: `references/${i}.md`,
      content: "x",
    })),
  });

  it("writes skills out in full, without front matter, up to the budget", () => {
    const text =
      skillsSection([skill("提示词", 3300, 1), skill("海报", 900)]) ?? "";
    expect(text).toContain("### 提示词");
    expect(text).toContain("字".repeat(3300));
    expect(text).not.toContain("name: 提示词");
    expect(text).toContain("/skills/提示词/references/0.md");
    expect(text).not.toContain("read_file `/skills/海报/SKILL.md`");
  });

  it("lists what does not fit with its path", () => {
    const text =
      skillsSection([
        skill("大", SKILLS_INLINE_BUDGET - 100),
        skill("小", 500),
      ]) ?? "";
    expect(text).toContain("### 大");
    expect(text).toContain("read_file `/skills/小/SKILL.md`");
    expect(skillsSection([])).toBeNull();
  });
});

describe("canvas writes never overwrite a save in between (第 69 条)", () => {
  it("reads and applies the change again when the canvas changed meanwhile", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let row = { content: { elements: [{ id: "a" }] }, updated_at: "t1" };
    let writes = 0;
    const client = {
      from: () => {
        const filters: Record<string, unknown> = {};
        let patch: unknown = null;
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: (column: string, value: unknown) => {
            filters[column] = value;
            return chain;
          },
          update: (value: { content: unknown }) => {
            patch = value.content;
            return chain;
          },
          single: async () => ({ data: structuredClone(row), error: null }),
          then: (resolve: (value: unknown) => void) => {
            writes++;
            // The page saved right before our first write.
            if (writes === 1)
              row = {
                content: { elements: [{ id: "a" }, { id: "page" }] },
                updated_at: "t2",
              };
            if (filters.updated_at === row.updated_at) {
              row = { content: patch as never, updated_at: `t${writes + 2}` };
              resolve({ data: [{ id: "c" }], error: null });
            } else resolve({ data: [], error: null });
          },
        };
        return chain;
      },
    };
    const ids = await mutateCanvas(client, "c", (content) => {
      content.elements?.push({ id: "agent" });
      return { changed: true, result: content.elements?.map((el) => el.id) };
    });
    expect(ids).toEqual(["a", "page", "agent"]);
    expect(row.content.elements.map((el: { id: string }) => el.id)).toEqual([
      "a",
      "page",
      "agent",
    ]);
  });
});

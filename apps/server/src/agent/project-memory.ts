import { SystemMessage } from "@langchain/core/messages";
import type { BackendFactory, BackendProtocol } from "deepagents";
import { createMiddleware } from "langchain";


/**
 * 第 67 条 上下文读取: a project memory the design assistant reads at the start
 * of every run and keeps up to date itself, like Codex's AGENTS.md.
 *
 * Each conversation of a project is its own thread, so what was settled in
 * one (the brand's voice, the palette the user picked, "never put text on
 * the product") was gone in the next. `/memories/` is stored per project
 * (backends/prod.ts), so `/memories/AGENTS.md` is shared by all of the
 * project's conversations and survives them.
 *
 * Read once per run (beforeAgent), so within a run the system prompt stays
 * the same on every model call and the prompt cache keeps hitting; an edit
 * shows from the next run on. deepagents' own MemoryMiddleware loads only
 * once per thread and pushes the model to write memory before anything
 * else; this one is quieter and in the assistant's language.
 */

export const PROJECT_MEMORY_PATH = "/memories/AGENTS.md";
/** Longer memory is cut (the model is told to tidy it). */
export const PROJECT_MEMORY_MAX_CHARS = 6000;

export function projectMemorySection(content: string | null): string {
  const body = content?.trim();
  const shown =
    body && body.length > PROJECT_MEMORY_MAX_CHARS
      ? `${body.slice(0, PROJECT_MEMORY_MAX_CHARS)}\n…（后面还有，已截断：请把这份记忆整理精简）`
      : body;
  return `## 项目记忆

${PROJECT_MEMORY_PATH} 是这个项目的长期记忆，这个项目的每段对话都会读到它。${
    shown
      ? `内容如下：\n<project_memory>\n${shown}\n</project_memory>`
      : "现在还是空的。"
  }

- 用户确定了以后都适用的东西时，顺手记进去：品牌和受众、定下的配色字体、风格偏好、反复提的要求、用户纠正过你的地方（写清为什么）。
- 不记一次性的请求、闲聊、临时状态，不记任何密钥、密码、Key。
- 用 apply_patch 或 edit_file 改（文件不存在就用 write_file 新建），写成简短的条目，按主题分组，过时的直接改掉，控制在 2000 字以内。
- 记忆写好后不用特意告诉用户，除非用户问起。`;
}

export function createProjectMemoryMiddleware(
  backend: BackendProtocol | BackendFactory,
) {
  let memory: string | null = null;
  return createMiddleware({
    name: "LoomicProjectMemory",
    beforeAgent: async (state, runtime) => {
      try {
        const resolved =
          typeof backend === "function"
            ? backend({
                state: state as never,
                store: (runtime as { store?: unknown }).store as never,
              })
            : backend;
        const raw = (await resolved.readRaw(PROJECT_MEMORY_PATH)) as {
          content?: unknown;
        };
        memory = Array.isArray(raw?.content)
          ? (raw.content as string[]).join("\n")
          : null;
      } catch {
        memory = null; // not written yet
      }
      if (memory)
        console.info(`[agent-memory] project memory loaded (${memory.length} chars)`);
      return undefined;
    },
    wrapModelCall: (request, handler) => {
      const existing = request.systemMessage?.content;
      const section = projectMemorySection(memory);
      const content = [
        ...(typeof existing === "string"
          ? [{ type: "text" as const, text: existing }]
          : Array.isArray(existing)
            ? existing
            : []),
        { type: "text" as const, text: section },
      ];
      return handler({
        ...request,
        systemMessage: new SystemMessage({ content: content as never }),
      });
    },
  });
}


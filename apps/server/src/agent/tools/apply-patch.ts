import { ToolMessage } from "@langchain/core/messages";
import { Command, getCurrentTaskInput } from "@langchain/langgraph";
import type { BackendFactory, BackendProtocol } from "deepagents";
import { tool } from "langchain";
import { z } from "zod";

/**
 * apply_patch (第 67 条 文件编辑): several edits to one or more files in one
 * call, in the patch format Codex uses (OpenAI's GPT-5/6 models are trained
 * on it). deepagents' edit_file needs one exact, unique string per call, so
 * a brief or a storyboard with five changes took five calls, and one wrong
 * space failed the call. Here:
 * - every hunk is located by its context lines, exactly first, then ignoring
 *   trailing spaces, then ignoring surrounding whitespace and full-width /
 *   half-width punctuation differences;
 * - all hunks of all files are checked before anything is written: a patch
 *   either applies whole or not at all, with the failing hunk named;
 * - files go through the same backend as read_file / write_file
 *   (/workspace/ and /memories/ are per project and persistent; other paths
 *   live in the conversation's state, returned as a state update).
 * Deleting and moving files are not offered: the store backend has no
 * delete, and the assistant has no need for either.
 */

export type PatchOp =
  | { kind: "add"; path: string; lines: string[] }
  | { kind: "update"; path: string; hunks: Hunk[] };
export type Hunk = { header: string; old: string[]; new: string[]; context: number };

export class PatchError extends Error {}

/** Parses a `*** Begin Patch` … `*** End Patch` text. */
export function parsePatch(text: string): PatchOp[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let i = lines.findIndex((l) => l.trim() === "*** Begin Patch");
  if (i < 0) throw new PatchError("补丁要以 `*** Begin Patch` 开头");
  const end = lines.findIndex((l, n) => n > i && l.trim() === "*** End Patch");
  if (end < 0) throw new PatchError("补丁要以 `*** End Patch` 结尾");
  const ops: PatchOp[] = [];
  i++;
  while (i < end) {
    const line = lines[i] ?? "";
    const add = /^\*\*\* Add File: (.+)$/.exec(line);
    const update = /^\*\*\* Update File: (.+)$/.exec(line);
    if (add) {
      const out: string[] = [];
      i++;
      while (i < end && !(lines[i] ?? "").startsWith("*** ")) {
        const l = lines[i] ?? "";
        if (!l.startsWith("+"))
          throw new PatchError(`新文件 ${add[1]} 的每一行都要以 + 开头（第 ${i + 1} 行）`);
        out.push(l.slice(1));
        i++;
      }
      ops.push({ kind: "add", path: (add[1] ?? "").trim(), lines: out });
      continue;
    }
    if (update) {
      const path = (update[1] ?? "").trim();
      i++;
      if (/^\*\*\* (Move to|Delete File):/.test(lines[i] ?? ""))
        throw new PatchError("不支持移动或删除文件，只能新建和修改");
      const hunks: Hunk[] = [];
      let hunk: Hunk | null = null;
      while (i < end && !/^\*\*\* (Add|Update|Delete) File:/.test(lines[i] ?? "")) {
        const l = lines[i] ?? "";
        if (l.startsWith("@@")) {
          hunk = { header: l.slice(2).trim(), old: [], new: [], context: 0 };
          hunks.push(hunk);
        } else if (l === "*** End of File") {
          // Optional marker; nothing to do.
        } else {
          if (!hunk) {
            hunk = { header: "", old: [], new: [], context: 0 };
            hunks.push(hunk);
          }
          const sign = l[0];
          const body = l.slice(1);
          if (sign === " " || l === "") {
            hunk.old.push(sign === " " ? body : "");
            hunk.new.push(sign === " " ? body : "");
            hunk.context++;
          } else if (sign === "-") hunk.old.push(body);
          else if (sign === "+") hunk.new.push(body);
          else
            throw new PatchError(
              `${path} 的第 ${i + 1} 行要以空格（不变）、-（删除）或 +（新增）开头`,
            );
        }
        i++;
      }
      if (!hunks.length) throw new PatchError(`${path} 没有任何改动`);
      ops.push({ kind: "update", path, hunks });
      continue;
    }
    if (/^\*\*\* Delete File:/.test(line))
      throw new PatchError("不支持删除文件，只能新建和修改");
    if (line.trim() === "") {
      i++;
      continue;
    }
    throw new PatchError(`看不懂第 ${i + 1} 行：${line.slice(0, 60)}`);
  }
  if (!ops.length) throw new PatchError("补丁里没有任何文件操作");
  return ops;
}

const FULL_TO_HALF: Record<string, string> = {
  "，": ",", "。": ".", "：": ":", "；": ";", "！": "!", "？": "?",
  "（": "(", "）": ")", "“": '"', "”": '"', "‘": "'", "’": "'", "—": "-", "－": "-",
};
const loose = (s: string) =>
  s.trim().replace(/[，。：；！？（）“”‘’—－]/g, (c) => FULL_TO_HALF[c] ?? c).replace(/\s+/g, " ");
const MATCHERS: Array<(a: string, b: string) => boolean> = [
  (a, b) => a === b,
  (a, b) => a.trimEnd() === b.trimEnd(),
  (a, b) => loose(a) === loose(b),
];

function findSequence(lines: string[], wanted: string[], from: number): number {
  if (!wanted.length) return -1;
  for (const same of MATCHERS)
    for (let start = from; start + wanted.length <= lines.length; start++)
      if (wanted.every((w, k) => same(lines[start + k] ?? "", w))) return start;
  return -1;
}

/** Applies the hunks to a file's lines; throws PatchError naming the hunk. */
export function applyHunks(path: string, original: string[], hunks: Hunk[]): string[] {
  const lines = [...original];
  let cursor = 0;
  hunks.forEach((hunk, n) => {
    let from = cursor;
    if (hunk.header) {
      const at = findSequence(lines, [hunk.header], cursor);
      if (at >= 0) from = at;
    }
    if (!hunk.old.length) {
      // Pure insertion: after the header line, else at the end.
      const at = hunk.header && from !== cursor ? from + 1 : lines.length;
      lines.splice(at, 0, ...hunk.new);
      cursor = at + hunk.new.length;
      return;
    }
    let at = findSequence(lines, hunk.old, from);
    if (at < 0 && from !== cursor) at = findSequence(lines, hunk.old, cursor);
    if (at < 0)
      throw new PatchError(
        `${path} 的第 ${n + 1} 处改动找不到要替换的内容：\n${hunk.old.slice(0, 6).join("\n")}\n先用 read_file 看一下文件现在的内容，再按原文写上下文。`,
      );
    lines.splice(at, hunk.old.length, ...hunk.new);
    cursor = at + hunk.new.length;
  });
  return lines;
}

const applyPatchSchema = z.object({
  patch: z
    .string()
    .min(1)
    .describe(
      "The patch text, from `*** Begin Patch` to `*** End Patch`.",
    ),
});

const DESCRIPTION = `Edit files: create new ones or change existing ones, several places and several files in one call. Paths are absolute (/workspace/… for project notes, /memories/AGENTS.md for project memory).

Format:
*** Begin Patch
*** Add File: /workspace/brief.md
+# 活动海报
+- 主色：珊瑚红
*** Update File: /workspace/storyboard.md
@@ ## 第 2 镜
 镜头：中景
-光线：正午顶光
+光线：黄昏逆光
 情绪：期待
*** End Patch

Rules: in an Update, lines starting with a space are unchanged context (copy them exactly, 1–3 lines around each change), "-" removes, "+" adds. "@@ <text>" may name a nearby line to search from. Every change is checked before anything is written; if one does not match, nothing is changed and you are told which one. Delete and move are not supported.`;

function resolve(backend: BackendProtocol | BackendFactory, config: unknown) {
  if (typeof backend !== "function") return backend;
  return backend({
    state: getCurrentTaskInput(config as never),
    store: (config as { store?: unknown }).store as never,
  });
}

export function createApplyPatchTool(backend: BackendProtocol | BackendFactory) {
  return tool(
    async (input, config) => {
      const b = resolve(backend, config);
      let ops: PatchOp[];
      try {
        ops = parsePatch(input.patch);
      } catch (error) {
        return `补丁格式不对，没有改任何文件：${(error as Error).message}`;
      }
      // Check everything first.
      const planned: Array<{ op: PatchOp; before?: string; after: string; added: number; removed: number }> = [];
      for (const op of ops) {
        if (op.kind === "add") {
          planned.push({ op, after: op.lines.join("\n"), added: op.lines.length, removed: 0 });
          continue;
        }
        let raw: { content: string[] } | null = null;
        try {
          raw = (await b.readRaw(op.path)) as { content: string[] };
        } catch {
          raw = null;
        }
        if (!raw || !Array.isArray(raw.content))
          return `${op.path} 不存在，没有改任何文件。新文件用 *** Add File。`;
        try {
          const after = applyHunks(op.path, raw.content, op.hunks);
          planned.push({
            op,
            before: raw.content.join("\n"),
            after: after.join("\n"),
            added: op.hunks.reduce((n, h) => n + h.new.length - h.context, 0),
            removed: op.hunks.reduce((n, h) => n + h.old.length - h.context, 0),
          });
        } catch (error) {
          if (error instanceof PatchError) return `${error.message}\n（没有改任何文件）`;
          throw error;
        }
      }
      // Then write.
      let files: Record<string, unknown> | null = null;
      const done: string[] = [];
      for (const p of planned) {
        const result =
          p.op.kind === "add"
            ? await b.write(p.op.path, p.after)
            : p.before === p.after
              ? null
              : await b.edit(p.op.path, p.before ?? "", p.after, false);
        if (result?.error) {
          console.warn(`[agent-tool] apply_patch stopped at ${p.op.path}: ${result.error}`);
          return `改到 ${p.op.path} 时失败：${result.error}${done.length ? `。已经改好的：${done.join("、")}` : "。没有改任何文件"}`;
        }
        if (result?.filesUpdate) files = { ...(files ?? {}), ...result.filesUpdate };
        done.push(`${p.op.path}（${p.op.kind === "add" ? "新建" : `+${p.added} −${p.removed}`}）`);
      }
      console.info(`[agent-tool] apply_patch ${planned.length} file(s): ${planned.map((p) => p.op.kind).join(",")}`);
      const text = `已修改 ${done.length} 个文件：${done.join("、")}`;
      const toolCallId = (config as { toolCall?: { id?: string } }).toolCall?.id ?? "";
      if (files)
        return new Command({
          update: {
            files,
            messages: [new ToolMessage({ content: text, tool_call_id: toolCallId, name: "apply_patch" })],
          },
        });
      return text;
    },
    { name: "apply_patch", description: DESCRIPTION, schema: applyPatchSchema },
  );
}

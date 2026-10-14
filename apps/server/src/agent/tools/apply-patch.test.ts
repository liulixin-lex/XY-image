import { describe, expect, it, vi } from "vitest";

import { PatchError, applyHunks, createApplyPatchTool, parsePatch } from "./apply-patch.js";

const doc = ["# 活动海报", "", "## 第 1 镜", "镜头：远景", "光线：正午顶光", "", "## 第 2 镜", "镜头：中景", "光线：正午顶光", "情绪：期待"];

describe("apply_patch parsing (第 67 条)", () => {
  it("reads add and update operations with several hunks", () => {
    const ops = parsePatch(`*** Begin Patch
*** Add File: /workspace/a.md
+一
+二
*** Update File: /workspace/b.md
@@ ## 第 2 镜
 镜头：中景
-光线：正午顶光
+光线：黄昏逆光
@@
-## 第 1 镜
+## 第一镜
*** End Patch`);
    expect(ops).toHaveLength(2);
    expect(ops[0]).toEqual({ kind: "add", path: "/workspace/a.md", lines: ["一", "二"] });
    expect(ops[1]).toMatchObject({ kind: "update", path: "/workspace/b.md" });
    expect((ops[1] as { hunks: unknown[] }).hunks).toHaveLength(2);
  });
  it("refuses what it cannot do, with a reason", () => {
    expect(() => parsePatch("hello")).toThrow(PatchError);
    expect(() => parsePatch("*** Begin Patch\n*** Delete File: /workspace/a.md\n*** End Patch")).toThrow(/删除/);
    expect(() => parsePatch("*** Begin Patch\n*** Update File: /a\n*** Move to: /b\n*** End Patch")).toThrow(/移动/);
    expect(() => parsePatch("*** Begin Patch\n*** Add File: /a\nno plus\n*** End Patch")).toThrow(/\+ 开头/);
  });
});

describe("applying hunks", () => {
  const hunk = (old: string[], next: string[], header = "", context = 0) => ({ header, old, new: next, context });
  it("uses the @@ line to pick the right one of two identical lines", () => {
    const out = applyHunks("/b", doc, [hunk(["镜头：中景", "光线：正午顶光"], ["镜头：中景", "光线：黄昏逆光"], "## 第 2 镜", 1)]);
    expect(out[4]).toBe("光线：正午顶光");
    expect(out[8]).toBe("光线：黄昏逆光");
  });
  it("tolerates trailing spaces and full-width punctuation in the context", () => {
    const out = applyHunks("/b", doc, [hunk(["镜头:中景  "], ["镜头：近景"])]);
    expect(out[7]).toBe("镜头：近景");
  });
  it("names the hunk that does not match", () => {
    expect(() => applyHunks("/b", doc, [hunk(["镜头：中景"], ["x"]), hunk(["不存在的一行"], ["y"])])).toThrow(/第 2 处改动/);
  });
  it("inserts after the header line when nothing is replaced", () => {
    const out = applyHunks("/b", doc, [hunk([], ["道具：雨伞"], "## 第 1 镜")]);
    expect(out[3]).toBe("道具：雨伞");
  });
});

describe("the tool", () => {
  function fakeBackend(files: Record<string, string>) {
    return {
      readRaw: vi.fn(async (path: string) => {
        if (!(path in files)) throw new Error("not found");
        return { content: files[path]!.split("\n") };
      }),
      write: vi.fn(async (path: string, content: string) => {
        if (path in files) return { error: `Cannot write to ${path} because it already exists.` };
        files[path] = content;
        return {};
      }),
      edit: vi.fn(async (path: string, before: string, after: string) => {
        files[path] = files[path]!.replace(before, after);
        return { occurrences: 1 };
      }),
    };
  }
  const run = (backend: unknown, patch: string) =>
    (createApplyPatchTool(backend as never) as unknown as { invoke: (i: unknown, c: unknown) => Promise<unknown> }).invoke(
      { patch },
      { toolCall: { id: "call_1", name: "apply_patch", args: { patch }, type: "tool_call" } },
    );

  it("changes several files in one call", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const files = { "/workspace/storyboard.md": doc.join("\n") };
    const backend = fakeBackend(files);
    const result = await run(backend, `*** Begin Patch
*** Update File: /workspace/storyboard.md
@@ ## 第 2 镜
 镜头：中景
-光线：正午顶光
+光线：黄昏逆光
*** Add File: /workspace/notes.md
+记住：主色珊瑚红
*** End Patch`);
    expect(JSON.stringify(result)).toContain("已修改 2 个文件");
    expect(files["/workspace/storyboard.md"]).toContain("光线：黄昏逆光");
    expect(files["/workspace/storyboard.md"]?.split("\n")[4]).toBe("光线：正午顶光");
    expect((files as Record<string, string>)["/workspace/notes.md"]).toBe("记住：主色珊瑚红");
  });

  it("writes nothing when one change does not match", async () => {
    const files = { "/workspace/storyboard.md": doc.join("\n") };
    const backend = fakeBackend(files);
    const result = await run(backend, `*** Begin Patch
*** Add File: /workspace/new.md
+x
*** Update File: /workspace/storyboard.md
-没有这一行
+y
*** End Patch`);
    expect(JSON.stringify(result)).toContain("没有改任何文件");
    expect(backend.write).not.toHaveBeenCalled();
    expect(backend.edit).not.toHaveBeenCalled();
  });
});

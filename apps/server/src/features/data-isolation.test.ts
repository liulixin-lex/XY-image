import { afterEach, describe, expect, it, vi } from "vitest";
import { createCanvasService } from "./canvas/canvas-service.js";
import { createChatService } from "./chat/chat-service.js";
import { createJobService } from "./jobs/job-service.js";
import { createProjectService } from "./projects/project-service.js";
import { createUploadService } from "./uploads/upload-service.js";

// Two-user isolation at the service layer (the lab drill is
// xy-ops/agent01/e2e/probe-isolation.mjs). The fake client plays RLS: a table
// only returns the rows listed as visible to the caller, so another user's id
// behaves exactly like a missing one.
type Rows = Record<string, Array<Record<string, unknown>>>;
function fakeClient(visible: Rows, insertErrors: Record<string, string> = {}) {
  const writes: Array<{ table: string; op: string; values: unknown }> = [];
  const uploads: string[] = [];
  function from(table: string) {
    let op = "select";
    let values: unknown;
    let counted = false;
    const filters: Array<[string, unknown]> = [];
    const result = () => {
      if (op === "insert") {
        const code = insertErrors[table];
        return code
          ? { data: null, error: { code, message: "refused" } }
          : {
              data: { id: `${table}-new`, ...(values as object) },
              error: null,
            };
      }
      const rows = (visible[table] ?? []).filter((row) =>
        filters.every(([column, value]) => row[column] === value),
      );
      return op === "update"
        ? {
            data: rows.map((row) => ({ id: row.id })),
            error: null,
            count: counted ? rows.length : null,
          }
        : { data: rows, error: null };
    };
    const one = async () => {
      const r = result();
      return {
        ...r,
        data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data,
      };
    };
    const builder = {
      select: () => builder,
      order: () => builder,
      limit: () => builder,
      eq(column: string, value: unknown) {
        filters.push([column, value]);
        return builder;
      },
      update(next: unknown, options?: { count?: string }) {
        op = "update";
        values = next;
        counted = options?.count === "exact";
        writes.push({ table, op, values: next });
        return builder;
      },
      insert(next: unknown) {
        op = "insert";
        values = next;
        writes.push({ table, op, values: next });
        return builder;
      },
      maybeSingle: one,
      single: one,
      // biome-ignore lint/suspicious/noThenProperty: mimics the awaitable query builder
      then: (
        resolve: (value: unknown) => unknown,
        reject: (e: unknown) => unknown,
      ) => Promise.resolve(result()).then(resolve, reject),
    };
    return builder;
  }
  const storage = {
    from: () => ({
      upload: async (path: string) => {
        uploads.push(path);
        return { error: null };
      },
      remove: async () => ({ error: null }),
      getPublicUrl: (path: string) => ({
        data: { publicUrl: `https://assets.test/${path}` },
      }),
    }),
  };
  return { client: { from, storage } as never, writes, uploads };
}

const user = {
  id: "user-b",
  accessToken: "token-b",
  email: "",
  userMetadata: {},
};
const mine = { id: "canvas-b", project_id: "project-b" };

afterEach(() => vi.restoreAllMocks());

describe("another user's records", () => {
  it("canvas save to a canvas the user cannot write is 404, not a silent 200", async () => {
    // The fake ignores select columns; the save reads the canvas's workspace
    // through the projects join.
    const fake = fakeClient({
      canvases: [{ ...mine, projects: { workspace_id: "ws-b" } }],
    });
    const canvases = createCanvasService({
      createUserClient: () => fake.client,
    });
    const content = { elements: [], appState: {}, files: {} };
    await expect(
      canvases.saveCanvasContent(user, "canvas-a", content),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: "canvas_not_found",
    });
    await expect(
      canvases.saveCanvasContent(user, "canvas-b", content),
    ).resolves.toEqual({ missingFileIds: [] });
  });

  it("chat writes RLS refuses are 404; other failures stay 500", async () => {
    const refused = fakeClient(
      { chat_sessions: [] },
      { chat_sessions: "42501", chat_messages: "42501" },
    );
    const chat = createChatService({
      createUserClient: () => refused.client,
      threadService: { createThreadId: () => "thread-1" },
    });
    await expect(
      chat.createSession(user, "canvas-a", "x"),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: "canvas_not_found",
    });
    await expect(
      chat.createMessage(user, "session-a", { role: "user", content: "x" }),
    ).rejects.toMatchObject({ statusCode: 404, code: "session_not_found" });
    await expect(
      chat.updateSessionTitle(user, "session-a", "x"),
    ).rejects.toMatchObject({
      statusCode: 404,
    });
    const broken = fakeClient({}, { chat_sessions: "XX000" });
    const failing = createChatService({
      createUserClient: () => broken.client,
      threadService: { createThreadId: () => "thread-1" },
    });
    await expect(
      failing.createSession(user, "canvas-b", "x"),
    ).rejects.toMatchObject({
      statusCode: 500,
    });
  });

  it("a project only links the user's own brand kit, and a hidden project is 404", async () => {
    const fake = fakeClient({
      projects: [{ id: "project-b" }],
      brand_kits: [{ id: "kit-b" }],
    });
    const projects = createProjectService({
      createUserClient: () => fake.client,
      viewerService: {} as never,
    });
    await expect(
      projects.updateProject(user, "project-b", { brand_kit_id: "kit-a" }),
    ).rejects.toMatchObject({ statusCode: 404, code: "brand_kit_not_found" });
    expect(fake.writes).toEqual([]);
    await projects.updateProject(user, "project-b", { brand_kit_id: "kit-b" });
    expect(fake.writes).toHaveLength(1);
    await expect(
      projects.updateProject(user, "project-a", { name: "x" }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: "project_not_found",
    });
  });

  it("an upload into another workspace's project is 404 and stores nothing", async () => {
    const fake = fakeClient({
      projects: [{ id: "project-b", workspace_id: "ws-b" }],
    });
    const uploads = createUploadService({
      createUserClient: () => fake.client,
    });
    const input = {
      bucket: "project-assets" as const,
      fileName: "a.png",
      fileBuffer: Buffer.from("x"),
      mimeType: "image/png",
      workspaceId: "ws-b",
    };
    await expect(
      uploads.uploadFile(user, { ...input, projectId: "project-a" }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: "project_not_found",
    });
    expect(fake.uploads).toEqual([]);
    await uploads.uploadFile(user, { ...input, projectId: "project-b" });
    expect(fake.uploads).toHaveLength(1);
  });

  it("an image job only points at the user's own project, canvas and session", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // The job service reads with the admin client: everything is visible, so
    // the workspace filter is what keeps strangers out.
    const fake = fakeClient({
      workspace_members: [{ workspace_id: "ws-b", user_id: "user-b" }],
      projects: [
        { id: "project-a", workspace_id: "ws-a" },
        { id: "project-b", workspace_id: "ws-b" },
      ],
      canvases: [{ id: "canvas-a", project_id: "project-a" }, mine],
      chat_sessions: [
        { id: "session-a", canvas_id: "canvas-a" },
        { id: "session-b", canvas_id: "canvas-b" },
      ],
    });
    const send = vi.fn(async () => {});
    const jobs = createJobService({
      createUserClient: () => fake.client,
      getAdminClient: () => fake.client,
      pgmq: { send } as never,
    });
    const base = {
      workspaceId: "ws-b",
      jobType: "image_generation" as const,
      xy2apiKeyId: 7,
      payload: { prompt: "x" },
    };
    for (const foreign of [
      { projectId: "project-a" },
      { canvasId: "canvas-a" },
      { sessionId: "session-a" },
      { canvasId: "canvas-b", sessionId: "session-a" },
      { canvasId: "canvas-missing" },
    ])
      await expect(
        jobs.createJob(user, { ...base, ...foreign }),
        JSON.stringify(foreign),
      ).rejects.toMatchObject({
        statusCode: 404,
      });
    expect(fake.writes).toEqual([]);
    expect(send).not.toHaveBeenCalled();

    const job = await jobs.createJob(user, {
      ...base,
      projectId: "project-b",
      canvasId: "canvas-b",
      sessionId: "session-b",
    });
    expect(job.canvas_id).toBe("canvas-b");
    expect(send).toHaveBeenCalledOnce();
  });
});

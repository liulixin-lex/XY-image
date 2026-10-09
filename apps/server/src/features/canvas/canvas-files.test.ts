import { afterEach, describe, expect, it, vi } from "vitest";
import { insertImageElement } from "./canvas-element-writer.js";
import { createCanvasService } from "./canvas-service.js";

// Canvas images in Supabase Storage. Until 10-09 the save path wrote to
// canvas-files/<canvas>/…, which project-assets RLS refuses (the first folder
// must be a workspace), so every image stayed inline as base64.
const PNG = `data:image/png;base64,${Buffer.from("png-bytes").toString("base64")}`;
const marker = (fileId: string) =>
  `oss://project-assets/ws-1/canvas-files/canvas-1/${fileId}.png`;
const user = {
  id: "user-1",
  accessToken: "token-1",
  email: "",
  userMetadata: {},
};
const image = (fileId: string) => ({
  type: "image",
  id: `el-${fileId}`,
  fileId,
});

type Files = Record<string, Record<string, unknown>>;
function fakeClient(
  options: {
    stored?: Files;
    visible?: boolean;
    refuse?: (path: string) => boolean;
  } = {},
) {
  const uploads: Array<{
    path: string;
    contentType?: string;
    upsert?: boolean;
  }> = [];
  const saved: Array<{ files: Files; elements: unknown[] }> = [];
  const downloads: string[] = [];
  const visible = options.visible ?? true;
  const row = {
    id: "canvas-1",
    name: "Canvas",
    project_id: "project-1",
    files: options.stored ?? {},
    content: { elements: [], appState: {}, files: options.stored ?? {} },
    projects: { workspace_id: "ws-1" },
  };
  function from() {
    let updating = false;
    const builder = {
      select: () => builder,
      eq: () => builder,
      update(values: { content: { files: Files; elements: unknown[] } }) {
        updating = true;
        saved.push(values.content);
        return builder;
      },
      maybeSingle: async () => ({ data: visible ? row : null, error: null }),
      single: async () => ({ data: visible ? row : null, error: null }),
      // biome-ignore lint/suspicious/noThenProperty: mimics the awaitable query builder
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({
          data: updating && visible ? [{ id: row.id }] : [],
          error: null,
        }).then(resolve),
    };
    return builder;
  }
  const storage = {
    from: (bucket: string) => ({
      upload: async (
        path: string,
        _body: Buffer,
        opts: { contentType?: string; upsert?: boolean },
      ) => {
        uploads.push({ path: `${bucket}/${path}`, ...opts });
        return options.refuse?.(path)
          ? { error: { message: "new row violates row-level security policy" } }
          : { error: null };
      },
      download: async (path: string) => {
        downloads.push(path);
        return { data: null, error: { message: "not expected" } };
      },
      getPublicUrl: (path: string) => ({
        data: {
          publicUrl: `https://db.test/storage/v1/object/public/${bucket}/${path}`,
        },
      }),
    }),
  };
  return { client: { from, storage } as never, uploads, saved, downloads };
}

function save(
  fake: ReturnType<typeof fakeClient>,
  files: Files,
  elements: unknown[],
) {
  const service = createCanvasService({ createUserClient: () => fake.client });
  return service.saveCanvasContent(user, "canvas-1", {
    elements: elements as Array<Record<string, unknown>>,
    appState: {},
    files,
  });
}

afterEach(() => vi.restoreAllMocks());

describe("canvas images in storage", () => {
  it("moves a new image to the workspace folder and keeps a marker", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const fake = fakeClient();
    const result = await save(
      fake,
      { f1: { id: "f1", dataURL: PNG, mimeType: "image/png", created: 1 } },
      [image("f1")],
    );
    expect(result).toEqual({ missingFileIds: [] });
    expect(fake.uploads).toEqual([
      {
        path: "project-assets/ws-1/canvas-files/canvas-1/f1.png",
        contentType: "image/png",
        upsert: true,
      },
    ]);
    expect(fake.saved[0]?.files.f1).toEqual({
      id: "f1",
      dataURL: marker("f1"),
      mimeType: "image/png",
      created: 1,
    });
  });

  it("does not upload a file the canvas already has in storage", async () => {
    const fake = fakeClient({
      stored: { f1: { id: "f1", dataURL: marker("f1") } },
    });
    await save(
      fake,
      { f1: { id: "f1", dataURL: PNG, mimeType: "image/png" } },
      [image("f1")],
    );
    expect(fake.uploads).toEqual([]);
    expect(fake.saved[0]?.files.f1?.dataURL).toBe(marker("f1"));
  });

  it("keeps stored files sent without data and those the client has not loaded yet", async () => {
    const stored = {
      f1: { id: "f1", dataURL: marker("f1"), mimeType: "image/png" },
      f2: { id: "f2", dataURL: marker("f2"), mimeType: "image/png" },
      gone: { id: "gone", dataURL: marker("gone") },
    };
    const fake = fakeClient({ stored });
    const result = await save(
      fake,
      { f1: { id: "f1", mimeType: "image/png" } },
      [image("f1"), image("f2")],
    );
    expect(result.missingFileIds).toEqual([]);
    expect(fake.uploads).toEqual([]);
    // f2's image is on the canvas but its file was still loading; "gone" is
    // used by nothing and was not sent, so it is dropped as before.
    expect(fake.saved[0]?.files).toEqual({ f1: stored.f1, f2: stored.f2 });
  });

  it("moves an image stored inline before 10-09 on the next save", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const fake = fakeClient({
      stored: { f1: { id: "f1", dataURL: PNG, mimeType: "image/png" } },
    });
    await save(fake, { f1: { id: "f1", mimeType: "image/png" } }, [
      image("f1"),
    ]);
    expect(fake.uploads.map((u) => u.path)).toEqual([
      "project-assets/ws-1/canvas-files/canvas-1/f1.png",
    ]);
    expect(fake.saved[0]?.files.f1?.dataURL).toBe(marker("f1"));
  });

  it("asks the client to resend a file nobody has, and ignores markers into other workspaces", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const fake = fakeClient();
    const result = await save(
      fake,
      {
        f3: { id: "f3", mimeType: "image/png" },
        foreign: {
          id: "foreign",
          dataURL: "oss://project-assets/ws-2/secret.png",
        },
      },
      [image("f3"), image("foreign")],
    );
    expect(result.missingFileIds).toEqual(["f3", "foreign"]);
    expect(fake.saved[0]?.files).toEqual({});
  });

  it("keeps a file inline when its id or type is not storable, or storage refuses it", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const html = `data:text/html;base64,${Buffer.from("<script>").toString("base64")}`;
    const fake = fakeClient({
      refuse: (path) => path.endsWith("/refused.png"),
    });
    const files = {
      "../x": { id: "../x", dataURL: PNG },
      page: { id: "page", dataURL: html },
      refused: { id: "refused", dataURL: PNG },
    };
    await save(fake, files, [image("../x"), image("page"), image("refused")]);
    expect(fake.uploads.map((u) => u.path)).toEqual([
      "project-assets/ws-1/canvas-files/canvas-1/refused.png",
    ]);
    expect(fake.saved[0]?.files).toEqual(files);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("refused.png not stored, kept inline"),
    );
  });

  it("uploads nothing for a canvas the user cannot see", async () => {
    const fake = fakeClient({ visible: false });
    await expect(
      save(fake, { f1: { id: "f1", dataURL: PNG } }, [image("f1")]),
    ).rejects.toMatchObject({ statusCode: 404, code: "canvas_not_found" });
    expect(fake.uploads).toEqual([]);
    expect(fake.saved).toEqual([]);
  });

  it("loads a stored image as its public URL", async () => {
    const fake = fakeClient({
      stored: {
        f1: { id: "f1", dataURL: marker("f1"), mimeType: "image/png" },
      },
    });
    const service = createCanvasService({
      createUserClient: () => fake.client,
    });
    const canvas = await service.getCanvas(user, "canvas-1");
    expect(canvas.content.files.f1).toEqual({
      id: "f1",
      mimeType: "image/png",
      dataURL: undefined,
      storageUrl:
        "https://db.test/storage/v1/object/public/project-assets/ws-1/canvas-files/canvas-1/f1.png",
    });
  });

  it("agent images point at the stored image instead of embedding it", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const fake = fakeClient();
    await insertImageElement(fake.client, {
      canvasId: "canvas-1",
      objectPath: "ws-1/generated/job-1.png",
      width: 1024,
      height: 1024,
      mimeType: "image/png",
    });
    expect(fake.downloads).toEqual([]);
    const files = Object.values(fake.saved[0]?.files ?? {});
    expect(files).toHaveLength(1);
    expect(files[0]?.dataURL).toBe(
      "oss://project-assets/ws-1/generated/job-1.png",
    );
  });
});

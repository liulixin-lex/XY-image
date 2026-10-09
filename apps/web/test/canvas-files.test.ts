// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildFilesPayload,
  forgetStoredFiles,
  loadCanvasFiles,
  markFilesStored,
  resetStoredFiles,
} from "../src/lib/canvas-files";
import { saveCanvas } from "../src/lib/server-api";

const PNG = "data:image/png;base64,cG5n";
const file = (id: string) => ({
  id,
  dataURL: PNG,
  mimeType: "image/png",
  created: 1,
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("canvas save payload", () => {
  it("sends a file's data until the server has it", () => {
    resetStoredFiles("c1", ["old"]);
    const scene = { old: file("old"), new: file("new") };

    const first = buildFilesPayload("c1", scene);
    expect(first.sentWithData).toEqual(["new"]);
    expect(first.files.old).toEqual({
      id: "old",
      mimeType: "image/png",
      created: 1,
    });
    expect(first.files.new?.dataURL).toBe(PNG);

    markFilesStored("c1", first.sentWithData);
    expect(buildFilesPayload("c1", scene).sentWithData).toEqual([]);

    // The server reported "old" missing: its data goes again.
    forgetStoredFiles("c1", ["old"]);
    expect(buildFilesPayload("c1", scene).sentWithData).toEqual(["old"]);
  });

  it("tracks each canvas on its own", () => {
    resetStoredFiles("c1", ["f"]);
    resetStoredFiles("c2", []);
    expect(buildFilesPayload("c1", { f: file("f") }).sentWithData).toEqual([]);
    expect(buildFilesPayload("c2", { f: file("f") }).sentWithData).toEqual([
      "f",
    ]);
  });
});

describe("loading canvas files", () => {
  it("keeps inline files and reads stored ones as data URLs", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // A plain stub: Node's Response does not take jsdom's Blob.
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith("/gone.png")
        ? { ok: false, status: 404 }
        : {
            ok: true,
            status: 200,
            blob: async () => new Blob(["png"], { type: "image/png" }),
          },
    );
    const loaded = await loadCanvasFiles(
      {
        inline: {
          id: "inline",
          dataURL: PNG,
          mimeType: "image/png",
          created: 5,
        },
        stored: { id: "stored", storageUrl: "https://db.test/a/stored.png" },
        gone: { id: "gone", storageUrl: "https://db.test/a/gone.png" },
        empty: { id: "empty" },
      },
      fetchImpl as unknown as typeof fetch,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(loaded.map((f) => f.id)).toEqual(["inline", "stored"]);
    expect(loaded[0]).toEqual({
      id: "inline",
      dataURL: PNG,
      mimeType: "image/png",
      created: 5,
    });
    expect(loaded[1]?.mimeType).toBe("image/png");
    expect(loaded[1]?.dataURL).toMatch(/^data:image\/png;base64,/);
  });
});

describe("saveCanvas", () => {
  it("returns the files the server asked for again", async () => {
    vi.stubEnv("NEXT_PUBLIC_SERVER_BASE_URL", "http://localhost:3001");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: true, missingFileIds: ["f1", 2] })),
    );
    const content = { elements: [], appState: {}, files: {} };
    await expect(saveCanvas("token", "c1", content)).resolves.toEqual({
      missingFileIds: ["f1"],
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: true })),
    );
    await expect(saveCanvas("token", "c1", content)).resolves.toEqual({
      missingFileIds: [],
    });
  });
});

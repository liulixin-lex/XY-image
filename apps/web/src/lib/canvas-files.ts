/**
 * Canvas image files between Excalidraw and the server.
 *
 * The server keeps canvas images in Supabase Storage and returns them with a
 * `storageUrl` instead of a data URL; Excalidraw needs data URLs, so they are
 * fetched here. A save sends each file's data once: files the server already
 * has go without `dataURL` and the server keeps its stored copy. When an image
 * still uses a file the server has no data for, the save answer lists it in
 * `missingFileIds` and the editor sends it again with its data.
 */

export type ServerCanvasFile = {
  id?: unknown;
  dataURL?: unknown;
  mimeType?: unknown;
  created?: unknown;
  storageUrl?: unknown;
};

export type ExcalidrawFile = {
  id: string;
  dataURL: string;
  mimeType: string;
  created: number;
};

type SceneFile = {
  id?: string;
  dataURL?: string;
  mimeType?: string;
  created?: number;
};

// Per canvas, the file ids the server holds. Module-level so the canvas page
// (agent sync) and the editor (load, saves) share it.
const storedByCanvas = new Map<string, Set<string>>();

function storedSet(canvasId: string) {
  let set = storedByCanvas.get(canvasId);
  if (!set) {
    set = new Set();
    storedByCanvas.set(canvasId, set);
  }
  return set;
}

/** Starts tracking a freshly loaded canvas: every file it came with is stored. */
export function resetStoredFiles(canvasId: string, ids: Iterable<string>) {
  storedByCanvas.set(canvasId, new Set(ids));
}

export function markFilesStored(canvasId: string, ids: Iterable<string>) {
  const set = storedSet(canvasId);
  for (const id of ids) set.add(id);
}

export function forgetStoredFiles(canvasId: string, ids: Iterable<string>) {
  const set = storedSet(canvasId);
  for (const id of ids) set.delete(id);
}

/**
 * The files map for a save. Files the server holds are sent without their
 * data; `sentWithData` lists the rest, to mark stored once the save succeeds.
 */
export function buildFilesPayload(
  canvasId: string,
  sceneFiles: Record<string, SceneFile>,
): {
  files: Record<string, Record<string, unknown>>;
  sentWithData: string[];
} {
  const stored = storedSet(canvasId);
  const files: Record<string, Record<string, unknown>> = {};
  const sentWithData: string[] = [];
  for (const [id, file] of Object.entries(sceneFiles)) {
    const entry: Record<string, unknown> = {
      id: file.id ?? id,
      mimeType: file.mimeType,
      created: file.created,
    };
    if (!stored.has(id) && typeof file.dataURL === "string") {
      entry.dataURL = file.dataURL;
      sentWithData.push(id);
    }
    files[id] = entry;
  }
  return { files, sentWithData };
}

/**
 * Turns the server's files into Excalidraw files: inline data URLs as they
 * are, storage URLs fetched and read as data URLs. Files that fail to load are
 * left out (the image shows as missing; the server still has it).
 */
export async function loadCanvasFiles(
  files: Record<string, ServerCanvasFile>,
  fetchImpl: typeof fetch = fetch,
): Promise<ExcalidrawFile[]> {
  const loaded = await Promise.all(
    Object.entries(files).map(async ([fileId, file]) => {
      const base = {
        id: typeof file.id === "string" ? file.id : fileId,
        mimeType: typeof file.mimeType === "string" ? file.mimeType : "",
        created: typeof file.created === "number" ? file.created : Date.now(),
      };
      if (
        typeof file.dataURL === "string" &&
        file.dataURL.startsWith("data:")
      ) {
        return { ...base, dataURL: file.dataURL };
      }
      if (typeof file.storageUrl !== "string" || !file.storageUrl) return null;
      try {
        const response = await fetchImpl(file.storageUrl);
        if (!response.ok) {
          console.warn(
            `[canvas-files] file ${fileId} not loaded: ${response.status}`,
          );
          return null;
        }
        const blob = await response.blob();
        return {
          ...base,
          mimeType: base.mimeType || blob.type,
          dataURL: await readAsDataURL(blob),
        };
      } catch (error) {
        console.warn(`[canvas-files] file ${fileId} not loaded:`, error);
        return null;
      }
    }),
  );
  return loaded.filter((file): file is ExcalidrawFile => file !== null);
}

function readAsDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

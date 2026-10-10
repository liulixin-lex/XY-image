/**
 * Canvas image files between the node canvas and the server.
 *
 * The server keeps canvas images in Supabase Storage and returns them with a
 * `storageUrl` instead of a data URL; the canvas shows them from that URL. A
 * save sends each file's data once: files the server already has go without
 * `dataURL` and the server keeps its stored copy. When an image still uses a
 * file the server has no data for, the save answer lists it in
 * `missingFileIds` and the editor sends it again with its data.
 */

export type ServerCanvasFile = {
  id?: unknown;
  dataURL?: unknown;
  mimeType?: unknown;
  created?: unknown;
  storageUrl?: unknown;
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

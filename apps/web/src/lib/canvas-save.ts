/**
 * The body of a canvas save.
 *
 * A save replaces the stored elements with the page's, except for images the
 * worker placed after the page loaded (a generation that finished late): the
 * server keeps those unless the page lists them in `deletedElementIds`. So the
 * page sends the ids of the placed images its user deleted (only those matter,
 * which keeps the list short), and nothing a user did not see is lost.
 */
import { buildFilesPayload } from "./canvas-files";

export type SaveContent = {
  elements: Record<string, unknown>[];
  appState: Record<string, unknown>;
  files: Record<string, Record<string, unknown>>;
};

export type SavePayload = {
  content: SaveContent;
  deletedElementIds: string[];
  // Files sent with their data, to mark stored once the save succeeds.
  sentWithData: string[];
};

type SceneElement = Record<string, unknown>;

/**
 * `elements` is the scene including deleted elements (Excalidraw's onChange
 * and getSceneElementsIncludingDeleted). Deleted ones are left out; deleted
 * placed images go as ids.
 */
export function buildCanvasSavePayload(
  canvasId: string,
  elements: readonly SceneElement[],
  appState: { viewBackgroundColor?: unknown; gridModeEnabled?: unknown },
  sceneFiles: Parameters<typeof buildFilesPayload>[1],
): SavePayload {
  const live: Record<string, unknown>[] = [];
  const deletedElementIds: string[] = [];
  for (const element of elements) {
    if (!element.isDeleted) live.push(element);
    else if (typeof element.id === "string" && isPlacedImage(element)) {
      deletedElementIds.push(element.id);
    }
  }
  const { files, sentWithData } = buildFilesPayload(canvasId, sceneFiles);
  return {
    content: {
      elements: live,
      appState: {
        viewBackgroundColor: appState.viewBackgroundColor,
        gridModeEnabled: appState.gridModeEnabled,
      },
      files,
    },
    deletedElementIds,
    sentWithData,
  };
}

// Set by the server's canvas writer on images it places for a job.
function isPlacedImage(element: SceneElement) {
  return (
    typeof (element.customData as { jobId?: unknown } | undefined)?.jobId ===
    "string"
  );
}

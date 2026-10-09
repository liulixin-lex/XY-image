import type { CanvasContent, CanvasDetail, Json } from "@loomic/shared";

import type { AuthenticatedUser, UserSupabaseClient } from "../../supabase/user.js";

export class CanvasServiceError extends Error {
  readonly statusCode: number;
  readonly code: "canvas_not_found" | "canvas_save_failed";

  constructor(
    code: "canvas_not_found" | "canvas_save_failed",
    message: string,
    statusCode: number,
  ) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

export type CanvasSaveResult = {
  /**
   * Files an image element still uses that neither this save nor the stored
   * canvas has. The client resends them with their data.
   */
  missingFileIds: string[];
};

export type CanvasService = {
  getCanvas(user: AuthenticatedUser, canvasId: string): Promise<CanvasDetail>;
  saveCanvasContent(
    user: AuthenticatedUser,
    canvasId: string,
    content: CanvasContent,
  ): Promise<CanvasSaveResult>;
};

/**
 * Marker prefix for files that have been extracted to Supabase Storage.
 * Format: `oss://bucket/objectPath`
 */
const OSS_MARKER_PREFIX = "oss://";
const CANVAS_FILES_BUCKET = "project-assets";
// Canvas images live at `<workspaceId>/canvas-files/<canvasId>/<fileId>.<ext>`:
// project-assets RLS only accepts writes under a workspace the user
// administers. (Until 10-09 the path lacked the workspace folder, every upload
// was refused and images stayed inline as base64 in canvases.content; such
// canvases move to storage on their next save.)
// Excalidraw file ids are the SHA-1 of the file (nanoid without WebCrypto) and
// the agent writer uses short random ids, so an id never changes content.
// Anything that would not make a plain path segment stays inline.
// TODO: objects of files a canvas no longer uses (and of deleted canvases)
// stay in storage; a sweep would compare canvas-files/ against
// canvases.content->files.
const SAFE_FILE_ID = /^[A-Za-z0-9_-]{1,128}$/;
// The types the upload route accepts into the same bucket.
const STORABLE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
]);
const UPLOAD_CONCURRENCY = 4;

export function createCanvasService(options: {
  createUserClient: (accessToken: string) => UserSupabaseClient;
}): CanvasService {
  return {
    async getCanvas(user, canvasId) {
      const client = options.createUserClient(user.accessToken);
      const { data, error } = await client
        .from("canvases")
        .select("id, name, project_id, content")
        .eq("id", canvasId)
        .single();

      if (error || !data) {
        throw new CanvasServiceError("canvas_not_found", "Canvas not found.", 404);
      }

      const content = (data.content as CanvasContent) ?? { elements: [], appState: {} };

      // Resolve OSS-stored files back to base64 dataURLs for the frontend
      const resolvedContent = await resolveFilesFromStorage(client, content);

      return {
        id: data.id,
        name: data.name,
        projectId: data.project_id,
        content: resolvedContent,
      };
    },

    async saveCanvasContent(user, canvasId, content) {
      const client = options.createUserClient(user.accessToken);

      // Only the stored files map is read: it has the storage markers to reuse
      // and the files this save may leave out (the client sends each file's
      // data once). The project gives the workspace folder for uploads.
      const { data: canvas, error: readError } = await client
        .from("canvases")
        .select("id, files:content->files, projects(workspace_id)")
        .eq("id", canvasId)
        .maybeSingle();
      if (readError) {
        throw new CanvasServiceError("canvas_save_failed", "Unable to save canvas.", 500);
      }
      const workspaceId = (canvas?.projects as { workspace_id?: string } | null)
        ?.workspace_id;
      // RLS hides other users' canvases: nothing is uploaded or saved.
      if (!canvas || !workspaceId) {
        throw new CanvasServiceError("canvas_not_found", "Canvas not found.", 404);
      }

      const stored = asFileRecord(canvas.files);
      const { files, missingFileIds, summary } = await storeCanvasFiles(client, {
        workspaceId,
        canvasId,
        content,
        stored,
      });
      if (summary) console.info(`[canvas-service] canvas ${canvasId}: ${summary}`);
      const leanContent = { ...content, files } as CanvasContent;

      const { data, error } = await client
        .from("canvases")
        .update({ content: leanContent as unknown as Json })
        .eq("id", canvasId)
        .select("id");

      if (error) {
        throw new CanvasServiceError("canvas_save_failed", "Unable to save canvas.", 500);
      }
      // RLS hides canvases the user cannot write (another user's, or deleted
      // in another tab): nothing was saved, so do not report success.
      if (!data?.length) {
        throw new CanvasServiceError("canvas_not_found", "Canvas not found.", 404);
      }
      return { missingFileIds };
    },
  };
}

// ---------------------------------------------------------------------------
// File storage (save path): base64 dataURL → Supabase Storage + oss:// marker
// ---------------------------------------------------------------------------

type CanvasFileRecord = Record<string, Record<string, unknown>>;

type PendingUpload = {
  fileId: string;
  fileData: Record<string, unknown>;
  dataURL: string;
};

/**
 * Builds the files map to store. Per file:
 * - data URL from the client: reuse the stored marker for the same id, else
 *   upload it;
 * - no data (the client sent it in an earlier save): keep the stored entry,
 *   moving it to storage if it is still inline (canvases from before 10-09);
 * - an image element's file missing from the save (still loading from storage
 *   when the client saved): keep the stored entry, or report it missing.
 * A failed or refused upload keeps the file inline, as before.
 */
async function storeCanvasFiles(
  client: UserSupabaseClient,
  input: {
    workspaceId: string;
    canvasId: string;
    content: CanvasContent;
    stored: CanvasFileRecord;
  },
): Promise<{ files: CanvasFileRecord; missingFileIds: string[]; summary: string | null }> {
  const incoming = asFileRecord((input.content as { files?: unknown }).files);
  const folder = `${input.workspaceId}/canvas-files/${input.canvasId}/`;
  const files: CanvasFileRecord = {};
  const uploads: PendingUpload[] = [];
  let reused = 0;

  const keepStored = (fileId: string) => {
    const previous = input.stored[fileId];
    if (!previous) return false;
    files[fileId] = previous;
    const dataURL = previous.dataURL;
    if (typeof dataURL === "string" && dataURL.startsWith("data:")) {
      uploads.push({ fileId, fileData: previous, dataURL });
    }
    return true;
  };

  for (const [fileId, fileData] of Object.entries(incoming)) {
    const dataURL = typeof fileData.dataURL === "string" ? fileData.dataURL : undefined;
    if (dataURL?.startsWith("data:")) {
      const previous = input.stored[fileId]?.dataURL;
      if (typeof previous === "string" && previous.startsWith(OSS_MARKER_PREFIX)) {
        files[fileId] = { ...fileData, dataURL: previous };
        reused++;
      } else {
        files[fileId] = fileData;
        uploads.push({ fileId, fileData, dataURL });
      }
      continue;
    }
    if (keepStored(fileId)) continue;
    // A marker the server did not write is only kept inside this workspace.
    if (dataURL?.startsWith(`${OSS_MARKER_PREFIX}${CANVAS_FILES_BUCKET}/${input.workspaceId}/`)) {
      files[fileId] = fileData;
    }
  }

  const missingFileIds: string[] = [];
  for (const fileId of imageFileIds(input.content)) {
    if (!files[fileId] && !keepStored(fileId)) missingFileIds.push(fileId);
  }

  let moved = 0;
  const inline: string[] = [];
  for (let index = 0; index < uploads.length; index += UPLOAD_CONCURRENCY) {
    await Promise.all(
      uploads.slice(index, index + UPLOAD_CONCURRENCY).map(async (upload) => {
        const marker = await uploadFile(client, folder, upload);
        if (marker) {
          files[upload.fileId] = { ...upload.fileData, dataURL: marker };
          moved++;
        } else {
          inline.push(upload.fileId);
        }
      }),
    );
  }

  const parts = [
    moved ? `${moved} file(s) moved to storage` : "",
    inline.length ? `${inline.length} left inline (${inline.slice(0, 5).join(", ")})` : "",
    missingFileIds.length
      ? `${missingFileIds.length} missing, client asked to resend (${missingFileIds.slice(0, 5).join(", ")})`
      : "",
  ].filter(Boolean);
  if (parts.length && reused) parts.push(`${reused} already stored`);
  return { files, missingFileIds, summary: parts.length ? parts.join("; ") : null };
}

/** Uploads one data URL; the oss:// marker on success, null to keep it inline. */
async function uploadFile(
  client: UserSupabaseClient,
  folder: string,
  upload: PendingUpload,
): Promise<string | null> {
  if (!SAFE_FILE_ID.test(upload.fileId)) return null;
  let parsed: { buffer: Buffer; mimeType: string };
  try {
    parsed = parseDataURL(upload.dataURL);
  } catch {
    return null;
  }
  if (!STORABLE_TYPES.has(parsed.mimeType)) return null;
  const objectPath = `${folder}${upload.fileId}.${mimeToExt(parsed.mimeType)}`;
  // Upsert: a retried save may upload the same file again.
  const { error } = await client.storage
    .from(CANVAS_FILES_BUCKET)
    .upload(objectPath, parsed.buffer, { contentType: parsed.mimeType, upsert: true });
  if (error) {
    console.warn(
      `[canvas-service] ${objectPath} not stored, kept inline: ${String(error.message).slice(0, 200)}`,
    );
    return null;
  }
  return `${OSS_MARKER_PREFIX}${CANVAS_FILES_BUCKET}/${objectPath}`;
}

/** File ids used by the canvas's live image elements. */
function imageFileIds(content: CanvasContent): Set<string> {
  const ids = new Set<string>();
  for (const element of content.elements ?? []) {
    if (element.type === "image" && !element.isDeleted && typeof element.fileId === "string") {
      ids.add(element.fileId);
    }
  }
  return ids;
}

function asFileRecord(value: unknown): CanvasFileRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as CanvasFileRecord)
    : {};
}

// ---------------------------------------------------------------------------
// File resolution (load path): oss:// marker → base64 dataURL
// ---------------------------------------------------------------------------

async function resolveFilesFromStorage(
  client: UserSupabaseClient,
  content: CanvasContent,
): Promise<CanvasContent> {
  const files = (content as { files?: CanvasFileRecord }).files;
  if (!files || Object.keys(files).length === 0) {
    return content;
  }

  // Separate OSS files from inline files
  const updatedFiles: CanvasFileRecord = {};
  const ossEntries: Array<{ fileId: string; fileData: Record<string, unknown>; bucket: string; objectPath: string }> = [];

  for (const [fileId, fileData] of Object.entries(files)) {
    const dataURL = fileData.dataURL as string | undefined;
    if (!dataURL?.startsWith(OSS_MARKER_PREFIX)) {
      updatedFiles[fileId] = fileData;
      continue;
    }

    const ref = dataURL.slice(OSS_MARKER_PREFIX.length);
    const slashIdx = ref.indexOf("/");
    if (slashIdx === -1) continue;
    ossEntries.push({
      fileId,
      fileData,
      bucket: ref.slice(0, slashIdx),
      objectPath: ref.slice(slashIdx + 1),
    });
  }

  if (ossEntries.length === 0) {
    return content;
  }

  // Resolve public URLs instead of downloading each file
  // Group by bucket (normally all in one bucket)
  const byBucket = new Map<string, typeof ossEntries>();
  for (const entry of ossEntries) {
    const list = byBucket.get(entry.bucket) ?? [];
    list.push(entry);
    byBucket.set(entry.bucket, list);
  }

  for (const [bucket, entries] of byBucket) {
    for (const entry of entries) {
      const { data } = client.storage
        .from(bucket)
        .getPublicUrl(entry.objectPath);
      updatedFiles[entry.fileId] = {
        ...entry.fileData,
        dataURL: undefined,
        storageUrl: data.publicUrl,
      };
    }
  }

  return {
    ...content,
    files: updatedFiles,
  } as CanvasContent;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function parseDataURL(dataURL: string): { buffer: Buffer; mimeType: string } {
  // Format: data:[<mediatype>][;base64],<data>
  const match = dataURL.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) {
    throw new Error("Invalid data URL");
  }
  return {
    mimeType: match[1]!,
    buffer: Buffer.from(match[2]!, "base64"),
  };
}

function mimeToExt(mimeType: string): string {
  switch (mimeType) {
    case "image/png": return "png";
    case "image/jpeg": return "jpg";
    case "image/webp": return "webp";
    case "image/svg+xml": return "svg";
    case "image/gif": return "gif";
    default: return "bin";
  }
}

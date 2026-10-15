/**
 * Read-change-write of a canvas's content that never overwrites a save made
 * in between (第 69 条). The open page saves the whole content too; the
 * design assistant's canvas tools used to read, change and write it back
 * blindly, so a save from the page during a tool call was lost (or the
 * tool's change was). Like the worker's canvas-element-writer, the write
 * lands only if `updated_at` is still what was read; otherwise the content
 * is read again and the change applied again (it must be a pure function of
 * the content).
 */

export type CanvasElement = Record<string, unknown>;
export type CanvasContent = {
  elements?: CanvasElement[];
  files?: Record<string, Record<string, unknown>>;
  appState?: Record<string, unknown>;
  [key: string]: unknown;
};

export class CanvasMissingError extends Error {
  constructor(canvasId: string) {
    super(`canvas ${canvasId} not found or not accessible`);
    this.name = "CanvasMissingError";
  }
}

export const CANVAS_WRITE_ATTEMPTS = 5;

type Client = { from: (table: string) => any };

/**
 * `change` gets a private copy of the content and returns whether it changed
 * it, and what to hand back. Nothing is written when it did not change.
 * A read that failed without a PostgREST code (a dropped connection) throws
 * a plain Error, so callers can retry reads.
 */
export async function mutateCanvas<T>(
  client: Client,
  canvasId: string,
  change: (content: CanvasContent) => { changed: boolean; result: T },
  label = "canvas",
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const { data, error } = await client
      .from("canvases")
      .select("content, updated_at")
      .eq("id", canvasId)
      .single();
    if (error && !error.code)
      throw new Error(`canvas read failed: ${error.message}`);
    if (error || !data) throw new CanvasMissingError(canvasId);
    const content = structuredClone((data.content ?? {}) as CanvasContent);
    if (!Array.isArray(content.elements)) content.elements = [];
    const { changed, result } = change(content);
    if (!changed) return result;
    const { data: written, error: writeError } = await client
      .from("canvases")
      .update({ content })
      .eq("id", canvasId)
      .eq("updated_at", data.updated_at)
      .select("id");
    if (writeError)
      throw new Error(`canvas write failed: ${writeError.message}`);
    if (written?.length) return result;
    if (attempt >= CANVAS_WRITE_ATTEMPTS)
      throw new Error(`canvas ${canvasId} kept changing; ${label} not saved`);
    console.warn(
      `[${label}] canvas ${canvasId} changed while writing, retry ${attempt}`,
    );
    await new Promise((resolve) =>
      setTimeout(resolve, 80 * attempt + Math.random() * 120),
    );
  }
}

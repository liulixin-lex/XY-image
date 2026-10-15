import { tool } from "langchain";
import { z } from "zod";

const inspectCanvasSchema = z.object({
  detail_level: z
    .enum(["summary", "full"])
    .default("summary")
    .describe(
      "Level of detail: summary (id, type, position, size) or full (all properties)",
    ),
  element_id: z.string().optional().describe("Query a specific element by ID"),
  filter_type: z
    .array(z.string())
    .optional()
    .describe(
      "Filter by element type(s), e.g. ['text', 'image', 'video', 'rectangle']. Use 'video' to match video elements (stored internally as image elements with isVideo metadata).",
    ),
  filter_region: z
    .object({
      min_x: z.number(),
      min_y: z.number(),
      max_x: z.number(),
      max_y: z.number(),
    })
    .optional()
    .describe("Filter to elements within a bounding box region"),
});

type CanvasElement = Record<string, unknown>;

const DEFAULT_STROKE_COLOR = "#1e1e1e";
const DEFAULT_BACKGROUND_COLOR = "transparent";
const SHAPE_TYPES = new Set(["rectangle", "ellipse", "diamond"]);

function summarizeElement(el: CanvasElement) {
  const base: Record<string, unknown> = {
    id: el.id,
    type: el.type,
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
  };

  if (el.type === "text" && typeof el.text === "string") {
    base.text = el.text.length > 50 ? el.text.slice(0, 47) + "..." : el.text;
    base.fontSize = el.fontSize;
  }
  // Node canvas: a prompt card feeds the generators it is connected to.
  if (el.type === "prompt" && typeof el.text === "string") {
    base.text = el.text.length > 120 ? `${el.text.slice(0, 117)}...` : el.text;
  }
  // Node canvas: a generator node, its settings in customData.generator.
  if (el.type === "generator") {
    const generator = (
      el.customData as { generator?: Record<string, unknown> } | undefined
    )?.generator;
    for (const key of [
      "model",
      "aspectRatio",
      "resolution",
      "quality",
      "count",
    ] as const) {
      if (generator?.[key] !== undefined && generator[key] !== "")
        base[key] = generator[key];
    }
    if (typeof generator?.prompt === "string" && generator.prompt) {
      base.prompt =
        generator.prompt.length > 120
          ? `${generator.prompt.slice(0, 117)}...`
          : generator.prompt;
    }
  }
  // An arrow bound at both ends is an edge of the node canvas: from → to.
  if (el.type === "arrow") {
    const from = (el.startBinding as { elementId?: unknown } | null | undefined)
      ?.elementId;
    const to = (el.endBinding as { elementId?: unknown } | null | undefined)
      ?.elementId;
    if (typeof from === "string" && typeof to === "string") {
      base.from = from;
      base.to = to;
    }
  }

  if (el.type === "image") {
    const customData = el.customData as Record<string, unknown> | undefined;
    // Video elements are stored as Excalidraw image elements with customData.isVideo = true
    if (customData?.isVideo === true) {
      base.type = "video";
      if (customData.videoUrl) base.videoUrl = customData.videoUrl;
      if (customData.mimeType) base.mimeType = customData.mimeType;
      if (customData.durationSeconds !== undefined)
        base.durationSeconds = customData.durationSeconds;
    } else {
      if (customData?.title) {
        base.title = customData.title;
      }
    }
  }

  // Embeddable elements: video elements are stored as Excalidraw embeddable with customData.isVideo
  if (el.type === "embeddable") {
    const customData = el.customData as Record<string, unknown> | undefined;
    if (customData?.isVideo === true) {
      base.type = "video";
      if (customData.title) base.title = customData.title;
      if (customData.prompt) base.prompt = customData.prompt;
      if (customData.mimeType) base.mimeType = customData.mimeType;
      if (customData.durationSeconds !== undefined)
        base.durationSeconds = customData.durationSeconds;
    }
  }

  if (SHAPE_TYPES.has(el.type as string)) {
    if (el.strokeColor && el.strokeColor !== DEFAULT_STROKE_COLOR) {
      base.strokeColor = el.strokeColor;
    }
    if (el.backgroundColor && el.backgroundColor !== DEFAULT_BACKGROUND_COLOR) {
      base.backgroundColor = el.backgroundColor;
    }
  }

  const groupIds = el.groupIds as unknown[] | undefined;
  if (Array.isArray(groupIds) && groupIds.length > 0) {
    base.grouped = true;
  }

  return base;
}

function computeBoundingBox(elements: CanvasElement[]) {
  if (elements.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Number.POSITIVE_INFINITY,
    minY = Number.POSITIVE_INFINITY,
    maxX = Number.NEGATIVE_INFINITY,
    maxY = Number.NEGATIVE_INFINITY;
  for (const el of elements) {
    const x = Number(el.x) || 0;
    const y = Number(el.y) || 0;
    const w = Number(el.width) || 0;
    const h = Number(el.height) || 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + w > maxX) maxX = x + w;
    if (y + h > maxY) maxY = y + h;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Build a compact canvas summary for injecting into user message context.
 * Reuses the existing summarizeElement / computeBoundingBox helpers so the
 * format stays consistent with inspect_canvas output.
 * Returns null if canvas is empty (no visible elements).
 */
export function buildCanvasSummaryForContext(
  elements: Array<Record<string, unknown>>,
): string | null {
  const visible = elements.filter((el) => !el.isDeleted);
  if (visible.length === 0) return null;

  const bbox = computeBoundingBox(visible);
  // 第 69 条: pictures placed for a generator run carry the job id; a
  // generator shows how much of its latest run is on the canvas.
  const placedJobs = new Set(
    visible.flatMap((el) => {
      const jobId = (el.customData as { jobId?: unknown } | undefined)?.jobId;
      return el.type === "image" && typeof jobId === "string" ? [jobId] : [];
    }),
  );
  const nodes = visible.filter((el) => !(el.type === "arrow" && boundEnds(el)));
  const edges = visible.filter((el) => el.type === "arrow" && boundEnds(el));
  const summaries = nodes.map((el) => summarizeElement(el));

  // Compact format: element count + bounding box + per-element one-liner
  const lines: string[] = [
    `Canvas: ${nodes.length} nodes, ${edges.length} edges, bounds (${Math.round(bbox.minX)},${Math.round(bbox.minY)})→(${Math.round(bbox.maxX)},${Math.round(bbox.maxY)})`,
  ];

  // Cap the list to keep the context small.
  const toShow = summaries.slice(0, SUMMARY_NODES);
  for (const [index, s] of toShow.entries()) {
    const parts = [`${s.type}#${s.id}`];
    parts.push(`@(${Math.round(s.x as number)},${Math.round(s.y as number)})`);
    parts.push(
      `${Math.round(s.width as number)}x${Math.round(s.height as number)}`,
    );
    if (s.text) parts.push(`"${s.text}"`);
    if (s.title) parts.push(`title="${s.title}"`);
    if (s.from && s.to) parts.push(`${s.from}→${s.to}`);
    if (s.type === "generator") {
      for (const key of [
        "model",
        "aspectRatio",
        "resolution",
        "quality",
        "count",
      ]) {
        if (s[key] !== undefined) parts.push(`${key}=${s[key]}`);
      }
      if (s.prompt) parts.push(`prompt="${s.prompt}"`);
      const run = (
        (
          nodes[index]?.customData as
            | { generator?: { run?: { jobs?: Array<{ jobId?: unknown }> } } }
            | undefined
        )?.generator?.run?.jobs ?? []
      ).filter((job) => typeof job.jobId === "string");
      if (run.length)
        parts.push(
          `last_run=${run.filter((job) => placedJobs.has(job.jobId as string)).length}/${run.length} on canvas`,
        );
    }
    if (s.type === "video") {
      if (s.durationSeconds) parts.push(`${s.durationSeconds}s`);
      if (s.prompt)
        parts.push(`prompt="${(s.prompt as string).slice(0, 120)}"`);
    }
    if (s.strokeColor) parts.push(`stroke=${s.strokeColor}`);
    if (s.backgroundColor) parts.push(`fill=${s.backgroundColor}`);
    lines.push(`  ${parts.join(" ")}`);
  }
  if (summaries.length > SUMMARY_NODES) {
    lines.push(
      `  ... and ${summaries.length - SUMMARY_NODES} more nodes (inspect_canvas for the rest)`,
    );
  }
  if (edges.length) {
    const shown = edges.slice(0, SUMMARY_EDGES).map((el) => {
      const [from, to] = boundEnds(el) as [string, string];
      return `${from}→${to}`;
    });
    lines.push(
      `  edges: ${shown.join(", ")}${edges.length > SUMMARY_EDGES ? ` … and ${edges.length - SUMMARY_EDGES} more` : ""}`,
    );
  }

  return lines.join("\n");
}

const SUMMARY_NODES = 60;
const SUMMARY_EDGES = 80;

function boundEnds(el: Record<string, unknown>): [string, string] | null {
  const from = (el.startBinding as { elementId?: unknown } | null | undefined)
    ?.elementId;
  const to = (el.endBinding as { elementId?: unknown } | null | undefined)
    ?.elementId;
  return typeof from === "string" && typeof to === "string" ? [from, to] : null;
}

export function createInspectCanvasTool(deps: {
  createUserClient: (accessToken: string) => any;
}) {
  return tool(
    async (input, config) => {
      const canvasId = (config as any)?.configurable?.canvas_id;
      const accessToken = (config as any)?.configurable?.access_token;

      if (!canvasId || !accessToken) {
        return JSON.stringify({
          error: "no_canvas_context",
          message:
            "This tool requires a canvas context. Ensure the conversation is linked to a canvas.",
        });
      }

      const client = deps.createUserClient(accessToken);
      const { data, error } = await client
        .from("canvases")
        .select("content")
        .eq("id", canvasId)
        .single();

      // 第 67 条: a dropped connection (no PostgREST code) is thrown, so the
      // read-only retry (run-guards.ts) tries again; not "not found".
      if (error && !error.code)
        throw new Error(`canvas read failed: ${error.message}`);
      if (error || !data) {
        return JSON.stringify({
          error: "canvas_not_found",
          message: "Canvas not found or access denied.",
        });
      }

      const content = data.content as {
        elements?: CanvasElement[];
        appState?: Record<string, unknown>;
      };

      const elements = (content.elements ?? []).filter((el) => !el.isDeleted);

      if (input.element_id) {
        const found = elements.find((el) => el.id === input.element_id);
        if (!found) {
          return JSON.stringify({
            error: "element_not_found",
            message: `Element ${input.element_id} not found on canvas.`,
          });
        }
        return JSON.stringify(
          input.detail_level === "full" ? found : summarizeElement(found),
        );
      }

      // Apply optional filters
      let filtered = elements;

      if (input.filter_type && input.filter_type.length > 0) {
        filtered = filtered.filter((el) => {
          // Resolve logical type: image/embeddable elements with customData.isVideo are treated as "video"
          const customData = el.customData as
            | Record<string, unknown>
            | undefined;
          const isVideoElement =
            (el.type === "image" || el.type === "embeddable") &&
            customData?.isVideo === true;
          const logicalType = isVideoElement ? "video" : (el.type as string);
          return input.filter_type!.includes(logicalType);
        });
      }

      if (input.filter_region) {
        const r = input.filter_region;
        filtered = filtered.filter((el) => {
          const ex = Number(el.x) || 0;
          const ey = Number(el.y) || 0;
          const ew = Number(el.width) || 0;
          const eh = Number(el.height) || 0;
          // Element overlaps region if it's not completely outside
          return !(
            ex + ew < r.min_x ||
            ex > r.max_x ||
            ey + eh < r.min_y ||
            ey > r.max_y
          );
        });
      }

      const summaryElements =
        input.detail_level === "full"
          ? filtered
          : filtered.map(summarizeElement);

      return JSON.stringify({
        canvasId,
        elementCount: elements.length,
        matchedCount: filtered.length,
        boundingBox: computeBoundingBox(filtered),
        viewport: {
          backgroundColor:
            (content.appState as any)?.viewBackgroundColor ?? "#ffffff",
        },
        elements: summaryElements,
      });
    },
    {
      name: "inspect_canvas",
      description:
        "Inspect the current canvas state. Returns element positions, sizes, and types. Use before placing new elements to avoid overlaps. Set detail_level='full' for complete properties, or query a specific element_id. Use filter_type to narrow by element type(s) and filter_region to narrow by spatial area.",
      schema: inspectCanvasSchema,
    },
  );
}

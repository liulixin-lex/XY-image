import {
  GENERATOR_NODE_SIZE,
  IMAGE_ASPECT_RATIOS,
  OUTPUT_GAP,
  OUTPUT_LONG_EDGE,
  OUTPUT_OFFSET,
  PROMPT_NODE_SIZE,
  type Rect,
  boundsOf,
  normalizeImageParams,
  outputSlots,
} from "@loomic/shared";
import { tool } from "langchain";
import { z } from "zod";

import {
  type CanvasContent,
  type CanvasElement,
  CanvasMissingError,
  mutateCanvas,
} from "../../features/canvas/canvas-mutation.js";
import type { AvailableModel } from "../../generation/providers/registry.js";
import { measureTextWidth } from "./canvas-element-helpers.js";
import { resolveToolModel } from "./image-generate.js";

/**
 * 第 69 条: the node canvas workflow from the chat.
 *
 * The canvas is a node canvas (apps/web lib/node-canvas): 提示词卡片
 * (`prompt` elements), 生成节点 (`generator`, settings in
 * `customData.generator`), pictures, notes and frames, joined by arrows bound
 * at both ends (edges). A generator sends its own description after the text
 * of the prompt cards connected into it, the connected pictures as
 * references, and an upstream generator's latest pictures (链式).
 *
 * - canvas_workflow builds or edits that graph in one call: nodes get `ref`
 *   names so later operations of the same call can connect them, and nodes
 *   without coordinates are laid out left to right (cards → generator →
 *   its pictures → the next generator), right of what is on the canvas.
 * - run_workflow runs generators the way the 生成 button does
 *   (features/jobs/image-batch.ts): one batch per generator, picture slots
 *   right of it (the same outputSlots as the page), the run written into the
 *   generator so an open page shows the pending pictures, the worker places
 *   each one with an edge from the generator. Upstream generators run (and
 *   finish) first.
 * Both write through mutateCanvas: a save from the page in between is kept.
 */

export const CANVAS_WORKFLOW_TOOL = "canvas_workflow";
export const RUN_WORKFLOW_TOOL = "run_workflow";
/** Pictures one generator may ask for from the chat (the page allows more). */
export const WORKFLOW_COUNT_MAX = 8;

const NODE_KINDS = new Set(["prompt", "generator", "text", "image"]);
/** Column spacing of the automatic layout. */
const CARD_TO_GENERATOR = PROMPT_NODE_SIZE.width + 120;
const GENERATOR_TO_NEXT =
  GENERATOR_NODE_SIZE.width +
  OUTPUT_OFFSET +
  2 * OUTPUT_LONG_EDGE +
  OUTPUT_GAP +
  160;
const LANE_GAP = 80;
const FRAME_PADDING = 48;
/**
 * Generators and prompt cards size themselves to their content on the page
 * (adapter.ts AUTO_HEIGHT): a generator with every settings row shows about
 * 530 px tall, more than its stored 440. Frames and lanes use these.
 */
const SHOWN_HEIGHT: Record<string, number> = { generator: 600, prompt: 160 };

function shownRect(el: CanvasElement): Rect {
  const rect = rectOf(el);
  return {
    ...rect,
    height: Math.max(rect.height, SHOWN_HEIGHT[String(el.type)] ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------

function newId(): string {
  let id = "";
  while (id.length < 20) id += Math.random().toString(36).slice(2);
  return id.slice(0, 20);
}

const randomInt = () => Math.floor(Math.random() * 2_000_000_000);

/** Fields every stored element has, as the page creates them (element.ts). */
function createElement(
  type: string,
  geometry: { x: number; y: number; width: number; height: number },
  extra: Record<string, unknown> = {},
): CanvasElement {
  return {
    id: newId(),
    type,
    ...geometry,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    boundElements: null,
    index: null,
    seed: randomInt(),
    version: 1,
    versionNonce: randomInt(),
    isDeleted: false,
    updated: Date.now(),
    link: null,
    locked: false,
    ...extra,
  };
}

function bump(el: CanvasElement, patch: Record<string, unknown> = {}) {
  Object.assign(el, patch);
  el.version = (Number(el.version) || 0) + 1;
  el.versionNonce = randomInt();
  el.updated = Date.now();
}

function rectOf(el: CanvasElement): Rect {
  return {
    x: Number(el.x) || 0,
    y: Number(el.y) || 0,
    width: Number(el.width) || 0,
    height: Number(el.height) || 0,
  };
}

/** Arrow from the right middle of `from` to the left middle of `to`. */
function edgeGeometry(from: CanvasElement, to: CanvasElement) {
  const a = rectOf(from);
  const b = rectOf(to);
  const x = a.x + a.width;
  const y = a.y + a.height / 2;
  const dx = b.x - x;
  const dy = b.y + b.height / 2 - y;
  return {
    x,
    y,
    width: Math.abs(dx),
    height: Math.abs(dy),
    points: [
      [0, 0],
      [dx, dy],
    ],
  };
}

function bindingId(binding: unknown): string | null {
  const id = (binding as { elementId?: unknown } | null | undefined)?.elementId;
  return typeof id === "string" ? id : null;
}

function isEdge(el: CanvasElement, from?: string, to?: string) {
  if (el.type !== "arrow" || el.isDeleted) return false;
  const start = bindingId(el.startBinding);
  const end = bindingId(el.endBinding);
  return (
    Boolean(start && end) && (!from || start === from) && (!to || end === to)
  );
}

export type GeneratorSettings = {
  model: string;
  keyId: number | null;
  aspectRatio: string;
  resolution: string;
  quality: string;
  outputFormat: string | null;
  outputCompression: number | null;
  background: string;
  moderation: string;
  count: number;
  prompt: string;
  run?: {
    batchId: string | null;
    jobs: Array<{ jobId: string; slot: Rect }>;
    startedAt: number;
  };
};

const GENERATOR_DEFAULTS: GeneratorSettings = {
  model: "",
  keyId: null,
  aspectRatio: "1:1",
  resolution: "2K",
  quality: "auto",
  outputFormat: null,
  outputCompression: null,
  background: "auto",
  moderation: "auto",
  count: 1,
  prompt: "",
};

export function readGenerator(el: CanvasElement): GeneratorSettings {
  const raw = ((el.customData as { generator?: unknown } | undefined)
    ?.generator ?? {}) as Record<string, unknown>;
  const { resolution, quality } = normalizeImageParams(raw, {
    resolution: "2K",
    quality: "auto",
  });
  const run = raw.run as GeneratorSettings["run"] | undefined;
  return {
    ...GENERATOR_DEFAULTS,
    model: typeof raw.model === "string" ? raw.model : "",
    keyId: typeof raw.keyId === "number" && raw.keyId > 0 ? raw.keyId : null,
    aspectRatio:
      typeof raw.aspectRatio === "string" &&
      (IMAGE_ASPECT_RATIOS as readonly string[]).includes(raw.aspectRatio)
        ? raw.aspectRatio
        : "1:1",
    resolution,
    quality,
    outputFormat:
      typeof raw.outputFormat === "string" ? raw.outputFormat : null,
    outputCompression:
      typeof raw.outputCompression === "number" ? raw.outputCompression : null,
    background: typeof raw.background === "string" ? raw.background : "auto",
    moderation: typeof raw.moderation === "string" ? raw.moderation : "auto",
    count: Math.min(100, Math.max(1, Math.round(Number(raw.count) || 1))),
    prompt: typeof raw.prompt === "string" ? raw.prompt : "",
    ...(run && Array.isArray(run.jobs) ? { run } : {}),
  };
}

// ---------------------------------------------------------------------------
// canvas_workflow
// ---------------------------------------------------------------------------

const operationSchema = z.object({
  action: z
    .enum([
      "add_prompt",
      "add_generator",
      "add_note",
      "connect",
      "disconnect",
      "update_prompt",
      "update_generator",
      "delete",
      "move",
      "add_frame",
    ])
    .describe("What to do"),
  ref: z
    .string()
    .max(40)
    .optional()
    .describe(
      "Your short name for a node created by this operation (p1, g1…), usable as an id in later operations of the same call",
    ),
  id: z
    .string()
    .optional()
    .describe(
      "The node to change, delete or move: an element id from canvas_state, or a ref from this call",
    ),
  text: z
    .string()
    .max(4000)
    .optional()
    .describe("add_prompt / add_note / update_prompt: the text"),
  prompt: z
    .string()
    .max(4000)
    .optional()
    .describe(
      "add_generator / update_generator: the generator's own description (sent after the text of connected prompt cards)",
    ),
  model: z
    .string()
    .optional()
    .describe(
      "add_generator / update_generator: image model id from generate_image's list; leave out for the user's default",
    ),
  aspect_ratio: z
    .string()
    .optional()
    .describe(`Picture ratio, one of ${IMAGE_ASPECT_RATIOS.join(", ")}`),
  resolution: z.string().optional().describe("1K, 2K or 4K"),
  quality: z
    .string()
    .optional()
    .describe("auto, low, medium, high, xhigh or max (the model's own levels)"),
  count: z
    .number()
    .int()
    .optional()
    .describe(`Pictures per run, 1–${WORKFLOW_COUNT_MAX}`),
  from: z
    .string()
    .optional()
    .describe(
      "connect / disconnect: source node (prompt card, note, picture or generator), id or ref",
    ),
  to: z
    .string()
    .optional()
    .describe("connect / disconnect: the generator it feeds, id or ref"),
  title: z.string().max(80).optional().describe("add_frame: the frame's name"),
  contains: z
    .array(z.string())
    .optional()
    .describe("add_frame: ids or refs of the nodes the frame goes around"),
  x: z
    .number()
    .optional()
    .describe("Left edge; leave out for automatic layout"),
  y: z.number().optional().describe("Top edge; leave out for automatic layout"),
});

const workflowSchema = z.object({
  operations: z.array(operationSchema).min(1).max(60),
});

type Operation = z.infer<typeof operationSchema>;

export type WorkflowResult = {
  summary: string;
  created: Record<string, string>;
  nodes: Array<{
    id: string;
    ref?: string;
    type: string;
    x: number;
    y: number;
  }>;
  edges: number;
  errors: string[];
};

function settingsFrom(
  op: Operation,
  models: AvailableModel[],
  errors: string[],
) {
  const patch: Partial<GeneratorSettings> = {};
  if (op.prompt !== undefined) patch.prompt = op.prompt.trim();
  if (op.model) {
    const resolved = models.length
      ? resolveToolModel(op.model, models)
      : { id: op.model, adjusted: false };
    const key = (value: string) => value.toLowerCase().replace(/[\s_]+/g, "-");
    const known = models.some(
      (m) =>
        key(m.id) === key(op.model ?? "") ||
        key(m.displayName) === key(op.model ?? ""),
    );
    if (models.length && !known)
      errors.push(
        `model "${op.model.slice(0, 40)}" is not in the list; used ${resolved.id}`,
      );
    patch.model = resolved.id;
  }
  if (op.aspect_ratio) {
    if ((IMAGE_ASPECT_RATIOS as readonly string[]).includes(op.aspect_ratio))
      patch.aspectRatio = op.aspect_ratio;
    else
      errors.push(
        `aspect_ratio ${op.aspect_ratio} is not offered; kept ${GENERATOR_DEFAULTS.aspectRatio}`,
      );
  }
  if (op.resolution !== undefined || op.quality !== undefined) {
    const params = normalizeImageParams(
      { resolution: op.resolution, quality: op.quality },
      { resolution: "2K", quality: "auto" },
    );
    if (op.resolution !== undefined) patch.resolution = params.resolution;
    if (op.quality !== undefined) patch.quality = params.quality;
  }
  if (op.count !== undefined)
    patch.count = Math.min(
      WORKFLOW_COUNT_MAX,
      Math.max(1, Math.round(op.count)),
    );
  return patch;
}

/**
 * Applies the operations to a copy of the canvas content. Pure apart from
 * fresh ids, so mutateCanvas can apply it again after a concurrent save.
 */
export function applyWorkflow(
  content: CanvasContent,
  operations: readonly Operation[],
  models: AvailableModel[] = [],
): { changed: boolean; result: WorkflowResult } {
  const elements = content.elements as CanvasElement[];
  const live = () => elements.filter((el) => !el.isDeleted);
  const byId = new Map(live().map((el) => [String(el.id), el]));
  const refs = new Map<string, string>();
  const created: Record<string, string> = {};
  const errors: string[] = [];
  const placed = new Set<string>(); // new nodes with explicit coordinates
  const fresh: CanvasElement[] = []; // new nodes, in order
  const freshEdges: CanvasElement[] = [];
  const touched = new Set<string>(); // nodes moved or created: re-route their edges
  const frames: Array<{ op: Operation; index: number }> = [];
  const contentBefore = live().filter((el) => el.type !== "arrow");
  let changes = 0;

  const resolve = (value: string | undefined) => {
    if (!value) return null;
    const id = refs.get(value) ?? value;
    return byId.get(id) ? id : null;
  };
  const add = (el: CanvasElement, op: Operation, index: number) => {
    elements.push(el);
    byId.set(String(el.id), el);
    fresh.push(el);
    touched.add(String(el.id));
    if (op.x !== undefined && op.y !== undefined) placed.add(String(el.id));
    const key = op.ref ?? `op_${index}`;
    refs.set(key, String(el.id));
    created[key] = String(el.id);
    changes++;
  };
  const at = (op: Operation) => ({ x: op.x ?? 0, y: op.y ?? 0 });

  operations.forEach((op, index) => {
    switch (op.action) {
      case "add_prompt": {
        const text = (op.text ?? op.prompt ?? "").trim();
        if (!text)
          return void errors.push(`op ${index}: add_prompt needs text`);
        add(
          createElement(
            "prompt",
            { ...at(op), ...PROMPT_NODE_SIZE },
            {
              text,
              strokeColor: "transparent",
            },
          ),
          op,
          index,
        );
        return;
      }
      case "add_generator": {
        const settings = {
          ...GENERATOR_DEFAULTS,
          ...settingsFrom(op, models, errors),
        };
        add(
          createElement(
            "generator",
            { ...at(op), ...GENERATOR_NODE_SIZE },
            {
              strokeColor: "transparent",
              customData: { generator: settings },
            },
          ),
          op,
          index,
        );
        return;
      }
      case "add_note": {
        const text = (op.text ?? "").trim();
        if (!text) return void errors.push(`op ${index}: add_note needs text`);
        const lines = text.split("\n");
        const width = Math.min(
          520,
          Math.max(60, ...lines.map((line) => measureTextWidth(line, 20))) + 8,
        );
        add(
          createElement(
            "text",
            { ...at(op), width, height: lines.length * 25 },
            {
              text,
              originalText: text,
              fontSize: 20,
              fontFamily: 2,
              textAlign: "left",
              verticalAlign: "top",
              containerId: null,
              lineHeight: 1.25,
              autoResize: true,
            },
          ),
          op,
          index,
        );
        return;
      }
      case "connect": {
        const from = resolve(op.from);
        const to = resolve(op.to);
        const target = to ? byId.get(to) : undefined;
        const source = from ? byId.get(from) : undefined;
        if (!source || !target)
          return void errors.push(
            `op ${index}: connect needs existing from and to (got ${op.from ?? "?"} → ${op.to ?? "?"})`,
          );
        if (target.type !== "generator")
          return void errors.push(
            `op ${index}: connect goes into a generator; ${op.to} is a ${String(target.type)}`,
          );
        if (!NODE_KINDS.has(String(source.type)) || from === to)
          return void errors.push(
            `op ${index}: ${op.from} (${String(source.type)}) cannot feed a generator`,
          );
        if (live().some((el) => isEdge(el, from ?? undefined, to ?? undefined)))
          return;
        const arrow = createElement(
          "arrow",
          { x: 0, y: 0, width: 1, height: 1 },
          {
            points: [
              [0, 0],
              [1, 0],
            ],
            startBinding: { elementId: from, focus: 0, gap: 4 },
            endBinding: { elementId: to, focus: 0, gap: 4 },
            startArrowhead: null,
            endArrowhead: "arrow",
            strokeWidth: 2,
            roundness: { type: 2 },
          },
        );
        elements.push(arrow);
        freshEdges.push(arrow);
        changes++;
        return;
      }
      case "disconnect": {
        const from = resolve(op.from);
        const to = resolve(op.to);
        const gone = live().filter((el) => isEdge(el, from ?? "", to ?? ""));
        if (!gone.length)
          return void errors.push(
            `op ${index}: no connection ${op.from} → ${op.to}`,
          );
        for (const el of gone) bump(el, { isDeleted: true });
        changes += gone.length;
        return;
      }
      case "update_prompt": {
        const id = resolve(op.id);
        const el = id ? byId.get(id) : undefined;
        const text = (op.text ?? op.prompt ?? "").trim();
        if (!el || (el.type !== "prompt" && el.type !== "text") || !text)
          return void errors.push(
            `op ${index}: update_prompt needs a prompt card or note id and text`,
          );
        bump(el, {
          text,
          ...(el.type === "text" ? { originalText: text } : {}),
        });
        changes++;
        return;
      }
      case "update_generator": {
        const id = resolve(op.id);
        const el = id ? byId.get(id) : undefined;
        if (!el || el.type !== "generator")
          return void errors.push(
            `op ${index}: update_generator needs a generator id`,
          );
        const current =
          (el.customData as { generator?: Record<string, unknown> } | undefined)
            ?.generator ?? {};
        bump(el, {
          customData: {
            ...(el.customData as Record<string, unknown> | undefined),
            generator: { ...current, ...settingsFrom(op, models, errors) },
          },
        });
        changes++;
        return;
      }
      case "delete": {
        const id = resolve(op.id);
        const el = id ? byId.get(id) : undefined;
        if (!el)
          return void errors.push(`op ${index}: nothing to delete at ${op.id}`);
        bump(el, { isDeleted: true });
        byId.delete(String(el.id));
        // Its edges go too; a generator's pictures stay.
        for (const edge of live().filter(
          (e) =>
            isEdge(e) &&
            (bindingId(e.startBinding) === id ||
              bindingId(e.endBinding) === id),
        ))
          bump(edge, { isDeleted: true });
        changes++;
        return;
      }
      case "move": {
        const id = resolve(op.id);
        const el = id ? byId.get(id) : undefined;
        if (!el || op.x === undefined || op.y === undefined)
          return void errors.push(`op ${index}: move needs an id, x and y`);
        bump(el, { x: op.x, y: op.y });
        touched.add(String(el.id));
        changes++;
        return;
      }
      case "add_frame":
        frames.push({ op, index });
        return;
    }
  });

  layout(
    fresh.filter((el) => !placed.has(String(el.id))),
    contentBefore,
    elements,
  );

  // Edges of new and moved nodes follow them.
  for (const edge of [...freshEdges, ...live().filter((el) => isEdge(el))]) {
    const from = byId.get(bindingId(edge.startBinding) ?? "");
    const to = byId.get(bindingId(edge.endBinding) ?? "");
    if (!from || !to) continue;
    if (
      !freshEdges.includes(edge) &&
      !touched.has(String(from.id)) &&
      !touched.has(String(to.id))
    )
      continue;
    const geometry = edgeGeometry(from, to);
    if (freshEdges.includes(edge)) Object.assign(edge, geometry);
    else bump(edge, geometry);
  }

  for (const { op, index } of frames) {
    const members = (op.contains ?? [])
      .map((value) => resolve(value))
      .flatMap((id) => (id ? [byId.get(id) as CanvasElement] : []));
    const box = boundsOf(members.map(shownRect));
    if (!box) {
      errors.push(`op ${index}: add_frame needs the nodes it contains`);
      continue;
    }
    const frame = createElement(
      "frame",
      {
        x: box.x - FRAME_PADDING,
        y: box.y - FRAME_PADDING - 24,
        width: box.width + FRAME_PADDING * 2,
        height: box.height + FRAME_PADDING * 2 + 24,
      },
      { name: op.title?.trim() || null },
    );
    elements.push(frame);
    const key = op.ref ?? `op_${index}`;
    refs.set(key, String(frame.id));
    created[key] = String(frame.id);
    changes++;
  }

  const refOf = new Map([...refs.entries()].map(([ref, id]) => [id, ref]));
  const nodes = fresh.map((el) => ({
    id: String(el.id),
    ...(refOf.get(String(el.id)) && !refOf.get(String(el.id))?.startsWith("op_")
      ? { ref: refOf.get(String(el.id)) as string }
      : {}),
    type: String(el.type),
    x: Math.round(Number(el.x)),
    y: Math.round(Number(el.y)),
  }));
  const kinds = fresh.reduce<Record<string, number>>((acc, el) => {
    const label =
      el.type === "prompt"
        ? "提示词卡片"
        : el.type === "generator"
          ? "生成节点"
          : "文字";
    acc[label] = (acc[label] ?? 0) + 1;
    return acc;
  }, {});
  const parts = Object.entries(kinds).map(([label, n]) => `${n} 个${label}`);
  if (freshEdges.length) parts.push(`${freshEdges.length} 条连线`);
  const frameCount =
    frames.length - errors.filter((e) => /add_frame/.test(e)).length;
  if (frameCount > 0) parts.push(`${frameCount} 个分组框`);
  const summary = parts.length
    ? `加了 ${parts.join("、")}`
    : changes
      ? `改了 ${changes} 处`
      : "没有改动";
  return {
    changed: changes > 0,
    result: { summary, created, nodes, edges: freshEdges.length, errors },
  };
}

/**
 * Left-to-right lanes right of the existing content: each generator that
 * is not fed by another one starts a lane; its new cards and notes sit in
 * the column before it; a generator fed by another goes one column after
 * its upstream (past that one's pictures). New nodes not connected to any
 * generator get a lane of their own.
 */
function layout(
  nodes: CanvasElement[],
  existing: CanvasElement[],
  all: CanvasElement[],
) {
  if (!nodes.length) return;
  const bounds = boundsOf(existing.map(rectOf));
  const baseX = bounds ? bounds.x + bounds.width + 160 : 0;
  let laneTop = bounds ? bounds.y : 0;
  const pending = new Set(nodes.map((el) => String(el.id)));
  const isNew = new Set(pending);
  const byId = new Map(
    all.filter((el) => !el.isDeleted).map((el) => [String(el.id), el]),
  );
  const edges = all.filter((el) => isEdge(el));
  const sourcesOf = (id: string) =>
    edges
      .filter((e) => bindingId(e.endBinding) === id)
      .map((e) => byId.get(bindingId(e.startBinding) ?? ""))
      .filter((el): el is CanvasElement => Boolean(el));
  const column = new Map<string, number>();
  const lane = new Map<string, number>();
  const generators = nodes.filter((el) => el.type === "generator");

  const columnOf = (el: CanvasElement, seen = new Set<string>()): number => {
    const id = String(el.id);
    const known = column.get(id);
    if (known !== undefined) return known;
    if (seen.has(id)) return 1;
    seen.add(id);
    const upstream = sourcesOf(id).filter(
      (src) => src.type === "generator" && isNew.has(String(src.id)),
    );
    const value = upstream.length
      ? Math.max(...upstream.map((u) => columnOf(u, seen))) + 1
      : 1;
    column.set(id, value);
    return value;
  };
  const xOf = (col: number) =>
    baseX + CARD_TO_GENERATOR + (col - 1) * GENERATOR_TO_NEXT;

  for (const generator of generators) {
    const id = String(generator.id);
    const upstream = sourcesOf(id).find(
      (src) => src.type === "generator" && lane.has(String(src.id)),
    );
    const col = columnOf(generator);
    let top: number;
    if (upstream) {
      top = lane.get(String(upstream.id)) as number;
    } else {
      top = laneTop;
    }
    lane.set(id, top);
    generator.x = xOf(col);
    generator.y = top;
    // Its new cards and notes, stacked left of it.
    let y = top;
    for (const src of sourcesOf(id)) {
      if (!pending.has(String(src.id)) || src.type === "generator") continue;
      src.x = xOf(col) - CARD_TO_GENERATOR;
      src.y = y;
      y += shownRect(src).height + 32;
      pending.delete(String(src.id));
    }
    pending.delete(id);
    const settings = readGenerator(generator);
    const rows =
      settings.count <= 1
        ? 1
        : Math.ceil(
            settings.count /
              (settings.count <= 4 ? 2 : Math.ceil(Math.sqrt(settings.count))),
          );
    const laneHeight = Math.max(
      shownRect(generator).height,
      y - top,
      rows * (OUTPUT_LONG_EDGE + OUTPUT_GAP),
    );
    if (!upstream) laneTop = top + laneHeight + LANE_GAP;
  }
  // Whatever is left (cards with no generator, notes): their own lane.
  let x = baseX;
  for (const el of nodes) {
    if (!pending.has(String(el.id))) continue;
    el.x = x;
    el.y = laneTop;
    x += Number(el.width) + 48;
  }
}

export function createCanvasWorkflowTool(deps: {
  createUserClient: (accessToken: string) => any;
  availableModels?: AvailableModel[];
}) {
  return tool(
    async (input, config) => {
      const canvasId = (config as any)?.configurable?.canvas_id;
      const accessToken = (config as any)?.configurable?.access_token;
      if (!canvasId || !accessToken)
        return JSON.stringify({
          error: "no_canvas_context",
          message: "This tool needs a canvas.",
        });
      try {
        const result = await mutateCanvas(
          deps.createUserClient(accessToken),
          canvasId,
          (content) =>
            applyWorkflow(
              content,
              input.operations,
              deps.availableModels ?? [],
            ),
          CANVAS_WORKFLOW_TOOL,
        );
        console.info(
          `[agent-tool] canvas_workflow ${input.operations.length} op(s): ${result.summary}${result.errors.length ? `, ${result.errors.length} error(s)` : ""}`,
        );
        return JSON.stringify(result);
      } catch (error) {
        if (error instanceof CanvasMissingError)
          return JSON.stringify({
            error: "canvas_not_found",
            message: "Canvas not found or access denied.",
          });
        throw error;
      }
    },
    {
      name: CANVAS_WORKFLOW_TOOL,
      description: `Build or change an image workflow on the node canvas in ONE call: prompt cards (add_prompt), 生成 nodes (add_generator with model/aspect_ratio/resolution/quality/count and its own prompt), notes (add_note), connections into generators (connect from a prompt card, note, picture or upstream generator to a generator; an upstream generator feeds its latest pictures as references = a chain), frames around a group (add_frame), and edits (update_prompt, update_generator, disconnect, move, delete). Give new nodes a ref (p1, g1…) and use the refs in connect within the same call. Leave out x/y: nodes are laid out left to right next to the existing content. This only builds the graph; nothing is generated until you call run_workflow.`,
      schema: workflowSchema,
    },
  );
}

// ---------------------------------------------------------------------------
// run_workflow
// ---------------------------------------------------------------------------

export type WorkflowJobOutcome = {
  id: string;
  status: string;
  elementId?: string;
  errorCode?: string;
  errorMessage?: string;
  billingStatus?: string;
};

export type SubmitWorkflowBatchFn = (input: {
  prompt: string;
  title: string;
  model: string;
  keyId: number | null;
  aspectRatio: string;
  resolution: string;
  quality: string;
  count: number;
  inputImages: string[];
  canvasSourceId: string;
  slots: Rect[];
  outputFormat?: string | null;
  outputCompression?: number | null;
  background?: string;
  moderation?: string;
}) => Promise<{
  batchId: string;
  requested: number;
  jobs: Array<{ id: string; batchIndex: number }>;
}>;

export type WaitForJobsFn = (jobIds: string[]) => Promise<WorkflowJobOutcome[]>;

/** What feeds a generator (the page's generatorInputs, runtime.ts). */
export function generatorInputs(content: CanvasContent, generatorId: string) {
  const live = (content.elements ?? []).filter((el) => !el.isDeleted);
  const byId = new Map(live.map((el) => [String(el.id), el]));
  const sources = live
    .filter((el) => isEdge(el) && bindingId(el.endBinding) === generatorId)
    .flatMap((edge) => {
      const node = byId.get(bindingId(edge.startBinding) ?? "");
      return node ? [node] : [];
    })
    .sort(
      (a, b) =>
        (Number(a.y) || 0) - (Number(b.y) || 0) ||
        (Number(a.x) || 0) - (Number(b.x) || 0),
    );
  const placed = new Map<string, CanvasElement>();
  for (const el of live) {
    const jobId = (el.customData as { jobId?: unknown } | undefined)?.jobId;
    if (el.type === "image" && typeof jobId === "string") placed.set(jobId, el);
  }
  const prompts: string[] = [];
  const images: CanvasElement[] = [];
  const upstream: Array<{ id: string; pictures: number; waiting: boolean }> =
    [];
  for (const node of sources) {
    if (
      (node.type === "prompt" || node.type === "text") &&
      typeof node.text === "string" &&
      node.text.trim()
    )
      prompts.push(node.text.trim());
    else if (node.type === "image") images.push(node);
    else if (node.type === "generator") {
      const run = readGenerator(node).run;
      let pictures = 0;
      let waiting = false;
      for (const job of run?.jobs ?? []) {
        const picture = placed.get(job.jobId);
        if (picture) {
          images.push(picture);
          pictures++;
        } else waiting = true;
      }
      upstream.push({ id: String(node.id), pictures, waiting });
    }
  }
  return { prompts, images, upstream };
}

/** Requested generators, upstream ones first (a generator fed by another runs after it). */
function runOrder(content: CanvasContent, ids: string[]): string[] {
  const wanted = new Set(ids);
  const live = (content.elements ?? []).filter((el) => !el.isDeleted);
  const deps = new Map<string, string[]>();
  for (const id of ids)
    deps.set(
      id,
      live
        .filter((el) => isEdge(el) && bindingId(el.endBinding) === id)
        .map((el) => bindingId(el.startBinding) as string)
        .filter((src) => wanted.has(src)),
    );
  const order: string[] = [];
  const visit = (id: string, path = new Set<string>()) => {
    if (order.includes(id) || path.has(id)) return;
    path.add(id);
    for (const dep of deps.get(id) ?? []) visit(dep, path);
    order.push(id);
  };
  for (const id of ids) visit(id);
  return order;
}

export function createRunWorkflowTool(deps: {
  createUserClient: (accessToken: string) => any;
  submitBatch: SubmitWorkflowBatchFn;
  waitForJobs: WaitForJobsFn;
  pictureUrl: (
    client: any,
    element: CanvasElement,
    files: CanvasContent["files"],
  ) => string | null;
  notifyCanvas?: () => void;
}) {
  return tool(
    async (input, config) => {
      const canvasId = (config as any)?.configurable?.canvas_id;
      const accessToken = (config as any)?.configurable?.access_token;
      if (!canvasId || !accessToken)
        return JSON.stringify({
          error: "no_canvas_context",
          message: "This tool needs a canvas.",
        });
      const client = deps.createUserClient(accessToken);
      const read = async (): Promise<CanvasContent> => {
        const { data, error } = await client
          .from("canvases")
          .select("content")
          .eq("id", canvasId)
          .single();
        if (error && !error.code)
          throw new Error(`canvas read failed: ${error.message}`);
        if (error || !data) throw new CanvasMissingError(canvasId);
        return (data.content ?? {}) as CanvasContent;
      };
      let content: CanvasContent;
      try {
        content = await read();
      } catch (error) {
        if (error instanceof CanvasMissingError)
          return JSON.stringify({
            error: "canvas_not_found",
            message: "Canvas not found or access denied.",
          });
        throw error;
      }
      const live = (content.elements ?? []).filter((el) => !el.isDeleted);
      const unknown = input.generator_ids.filter(
        (id) => !live.some((el) => el.id === id && el.type === "generator"),
      );
      const ids = input.generator_ids.filter((id) => !unknown.includes(id));
      const order = runOrder(content, ids);
      const reserved: Rect[] = [];
      const runs: Array<Record<string, unknown>> = [];
      let pictures = 0;
      let failed = 0;
      for (const [position, id] of order.entries()) {
        content = await read();
        const generator = (content.elements ?? []).find(
          (el) => el.id === id && !el.isDeleted,
        );
        if (!generator) {
          runs.push({ id, error: "这个生成节点已经不在画布上" });
          continue;
        }
        const settings = readGenerator(generator);
        const inputs = generatorInputs(content, id);
        const blocked = inputs.upstream.find((u) => u.pictures === 0);
        if (blocked) {
          runs.push({
            id,
            error: blocked.waiting
              ? "上游生成节点还在出图，等它出完再运行"
              : "上游生成节点还没有图：先运行它（可以在同一次 run_workflow 里一起传，上游会先运行）",
          });
          continue;
        }
        const prompt = [...inputs.prompts, settings.prompt.trim()]
          .filter(Boolean)
          .join("\n\n")
          .slice(0, 4000);
        if (!prompt) {
          runs.push({
            id,
            error: "这个生成节点没有描述：连一张提示词卡片，或给它写描述",
          });
          continue;
        }
        const references = inputs.images
          .map((el) => deps.pictureUrl(client, el, content.files))
          .filter((url): url is string => Boolean(url));
        const liveNow = (content.elements ?? []).filter((el) => !el.isDeleted);
        const obstacles = [
          ...liveNow
            .filter(
              (el) =>
                el.id !== id &&
                !["frame", "magicframe", "arrow", "line"].includes(
                  String(el.type),
                ),
            )
            .map(shownRect),
          ...reserved,
        ];
        const slots = outputSlots(
          shownRect(generator),
          settings.count,
          settings.aspectRatio,
          obstacles,
        ).map((slot) => ({
          x: Math.round(slot.x),
          y: Math.round(slot.y),
          width: Math.round(slot.width),
          height: Math.round(slot.height),
        }));
        reserved.push(...slots);
        let batch: Awaited<ReturnType<SubmitWorkflowBatchFn>>;
        try {
          batch = await deps.submitBatch({
            prompt,
            title: prompt.slice(0, 24),
            model: settings.model,
            keyId: settings.keyId,
            aspectRatio: settings.aspectRatio,
            resolution: settings.resolution,
            quality: settings.quality,
            count: settings.count,
            inputImages: references,
            canvasSourceId: id,
            slots,
            outputFormat: settings.outputFormat,
            outputCompression: settings.outputCompression,
            background: settings.background,
            moderation: settings.moderation,
          });
        } catch (error) {
          const message = (error as Error).message?.slice(0, 200) || "没有发出";
          console.warn(
            `[agent-tool] run_workflow ${id}: not sent (${message})`,
          );
          runs.push({ id, error: message });
          continue;
        }
        const run = {
          batchId: batch.batchId,
          jobs: batch.jobs.flatMap((job, index) => {
            const slot = slots[job.batchIndex] ?? slots[index];
            return slot ? [{ jobId: job.id, slot }] : [];
          }),
          startedAt: Date.now(),
        };
        await mutateCanvas(
          client,
          canvasId,
          (fresh) => {
            const el = (fresh.elements ?? []).find(
              (e) => e.id === id && !e.isDeleted,
            );
            if (!el) return { changed: false, result: null };
            const custom = (el.customData ?? {}) as Record<string, unknown>;
            bump(el, {
              customData: {
                ...custom,
                generator: {
                  ...((custom.generator as Record<string, unknown>) ?? {}),
                  run,
                },
              },
            });
            return { changed: true, result: null };
          },
          RUN_WORKFLOW_TOOL,
        );
        deps.notifyCanvas?.();
        console.info(
          `[agent-tool] run_workflow ${id}: batch ${batch.batchId} ${batch.jobs.length}/${batch.requested} queued (${references.length} reference(s))`,
        );
        // Wait when asked, or when a later generator of this call needs these pictures.
        const feedsLater = order
          .slice(position + 1)
          .some((next) =>
            (content.elements ?? []).some((el) => isEdge(el, id, next)),
          );
        const entry: Record<string, unknown> = {
          id,
          sent: batch.jobs.length,
          ...(batch.jobs.length < batch.requested
            ? { requested: batch.requested }
            : {}),
        };
        if (input.wait !== false || feedsLater) {
          const outcomes = await deps.waitForJobs(
            batch.jobs.map((job) => job.id),
          );
          const done = outcomes.filter((o) => o.status === "succeeded");
          const pending = outcomes.filter(
            (o) => o.status === "queued" || o.status === "running",
          );
          const bad = outcomes.filter(
            (o) => !done.includes(o) && !pending.includes(o),
          );
          pictures += done.length;
          failed += bad.length;
          entry.pictures = done.flatMap((o) =>
            o.elementId ? [o.elementId] : [],
          );
          if (pending.length) entry.still_running = pending.length;
          if (bad.length)
            entry.failed = bad.map((o) => ({
              status: o.billingStatus === "unknown" ? "待核对" : o.status,
              ...(o.errorMessage
                ? { reason: o.errorMessage.slice(0, 120) }
                : {}),
            }));
          deps.notifyCanvas?.();
        }
        runs.push(entry);
      }
      for (const id of unknown)
        runs.push({ id, error: "画布上没有这个生成节点" });
      const sent = runs.reduce((n, r) => n + (Number(r.sent) || 0), 0);
      const summary = sent
        ? input.wait === false
          ? `发出了 ${sent} 张图，正在生成`
          : `出了 ${pictures} 张图${failed ? `，${failed} 张没有成功` : ""}`
        : "没有发出任何生成";
      console.info(
        `[agent-tool] run_workflow ${order.length} generator(s): ${summary}`,
      );
      return JSON.stringify({ summary, runs });
    },
    {
      name: RUN_WORKFLOW_TOOL,
      description:
        "Run 生成 nodes on the canvas, exactly like the user pressing 生成: each generator sends its description (connected prompt cards first, then its own), connected pictures as references and an upstream generator's latest pictures, with its own model and settings; the pictures appear right of it. Upstream generators in the same call run (and finish) first, so a whole chain runs in one call. Waits for the pictures by default and returns their element ids (view them with view_images if you need to check them). Each picture is a paid generation: run only what the user asked for.",
      schema: z.object({
        generator_ids: z
          .array(z.string())
          .min(1)
          .max(12)
          .describe(
            "Generator element ids (from canvas_workflow's result or canvas_state)",
          ),
        wait: z
          .boolean()
          .optional()
          .describe(
            "Wait for the pictures (default true). false: send and return at once.",
          ),
      }),
    },
  );
}

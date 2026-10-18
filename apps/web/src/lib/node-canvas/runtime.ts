/**
 * Generator runs on the node canvas: sending and following them.
 *
 * Billing rules (same as the studio, use-studio-jobs.ts):
 * - One click on 生成 sends one batch request; the generator is locked while
 *   it is in flight, and nothing is ever re-sent automatically.
 * - Each picture is its own job and charge. Pictures still waiting at the
 *   server's dispatch gate can be canceled for free; sent ones run to the end.
 * - A result the page cannot account for is "待核对", never "failed".
 *
 * The worker places each finished picture in the slot the run reserved
 * (server canvas-element-writer), with an edge from the generator. The page
 * only polls the jobs for their state and fetches the canvas when one
 * finishes, so a closed tab loses nothing.
 *
 * 第 56 条: each generator sends its own model through its own key, and a
 * generator connected into another feeds it the pictures of its latest run
 * (链式：上游出图 → 下游参考图). Several generators can be run with one
 * click (`generateMany`), one batch each.
 */
import type {
  ImageBackground,
  ImageModeration,
  ImageOutputFormat,
  ImageQuality,
  ImageResolution,
} from "@loomic/shared";

import type { IssueSpec } from "../generation-errors";
import { dataUrlToBlob } from "../image-blob";
import {
  type ImageJobView,
  isActiveJob,
  isFailedJob,
  toImageJobView,
} from "../image-jobs";
import type {
  CreateImageBatchInput,
  cancelJob,
  createImageBatch,
  fetchJob,
  uploadFile,
} from "../server-api";
import { jobIdOf } from "./element";
import { readGenerator, updateGenerator } from "./generator";
import { type Rect, outputSlots } from "./layout";
import { imageSourceOf } from "./render";
import type { NodeCanvasStore } from "./store";
import type { SceneElement, SceneNode } from "./types";

export const POLL_MS = 4000;
/** Polls after a success before a picture that never showed up is called missing. */
const PLACEMENT_GRACE_POLLS = 4;
const PROMPT_MAX = 4000;

export type RuntimeApi = {
  createImageBatch: typeof createImageBatch;
  fetchJob: typeof fetchJob;
  cancelJob: typeof cancelJob;
  uploadFile: typeof uploadFile;
};

export type RuntimeDeps = {
  getToken: () => string | null;
  projectId: string;
  api: RuntimeApi;
  /** A job this page sent settled: refresh the balance. */
  onSettled: () => void;
  report: (error: unknown) => IssueSpec | null;
  reportCode: (code: string, message?: string | null) => IssueSpec;
  /** Fetch and merge the server's copy of the canvas (worker-placed pictures). */
  requestSync: () => void;
  onModelsStale?: () => void;
  /**
   * Shrinks a picture before it is uploaded as a reference (the editor
   * passes lib/reference-image.ts); as it is when left out (tests).
   */
  prepareReference?: (file: File) => Promise<File>;
};

const passThrough = async (file: File) => file;

export type SendParams = {
  model: string;
  /** The key the model goes through; omitted = the server's default key. */
  keyId?: number | null;
  aspectRatio: string;
  resolution: ImageResolution;
  quality: ImageQuality;
  /** 第 66 条: OpenAI output options as resolved for the model (defaults left out). */
  outputFormat?: ImageOutputFormat | null;
  outputCompression?: number | null;
  background?: ImageBackground;
  moderation?: ImageModeration;
};

export type RuntimeState = {
  jobs: ReadonlyMap<string, ImageJobView>;
  /** Generators with a batch request in flight. */
  sending: ReadonlySet<string>;
  /** Why a generator's last click sent nothing (this page only). */
  errors: ReadonlyMap<string, IssueSpec>;
  /** Batches the server queued only part of. */
  partial: ReadonlyMap<string, { queued: number; requested: number }>;
  /** Finished jobs whose picture has not reached the canvas. */
  missing: ReadonlySet<string>;
};

/** One edge into a generator, for its input list (and its 断开 button). */
export type InputLink = {
  edgeId: string;
  sourceId: string;
  kind: "prompt" | "text" | "image" | "generator" | "other";
};

/** A generator connected into another (链式): what its latest run gives. */
export type UpstreamRun = {
  id: string;
  /** Pictures of its latest run now on the canvas. */
  pictures: number;
  /** Its latest run still has pictures on the way. */
  waiting: boolean;
};

export type GeneratorInputs = {
  /** Text of connected prompt cards and text nodes, top to bottom. */
  prompts: string[];
  /**
   * Connected pictures, top to bottom; an upstream generator's latest
   * pictures come in its place, in their slot order.
   */
  images: SceneElement[];
  upstream: UpstreamRun[];
  /** Every edge into the generator, top to bottom by source. */
  links: InputLink[];
};

function rectOf(node: SceneNode): Rect {
  return {
    x: node.position.x,
    y: node.position.y,
    width: node.width ?? node.measured?.width ?? node.data.el.width,
    height: node.height ?? node.measured?.height ?? node.data.el.height,
  };
}

/**
 * The pictures an upstream generator hands on: those of its latest run that
 * are on the canvas, in slot order; and whether more are on the way.
 */
function latestRunPictures(
  generator: SceneNode,
  placed: ReadonlyMap<string, SceneElement>,
): { pictures: SceneElement[]; waiting: boolean } {
  const run = readGenerator(generator.data.el).run;
  if (!run) return { pictures: [], waiting: false };
  const pictures: SceneElement[] = [];
  let waiting = false;
  for (const job of run.jobs) {
    const picture = placed.get(job.jobId);
    if (picture) pictures.push(picture);
    else waiting = true;
  }
  return { pictures, waiting };
}

/** What feeds a generator: nodes with an edge into it. */
export function generatorInputs(
  nodes: readonly SceneNode[],
  edges: readonly { id: string; source: string; target: string }[],
  generatorId: string,
): GeneratorInputs {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const sources = edges
    .filter((edge) => edge.target === generatorId)
    .flatMap((edge) => {
      const node = byId.get(edge.source);
      return node ? [{ edge, node }] : [];
    })
    .sort(
      (a, b) =>
        a.node.position.y - b.node.position.y ||
        a.node.position.x - b.node.position.x,
    );
  const prompts: string[] = [];
  const images: SceneElement[] = [];
  const upstream: UpstreamRun[] = [];
  const links: InputLink[] = [];
  let placed: Map<string, SceneElement> | null = null;
  for (const { edge, node } of sources) {
    const text = node.data.el.text;
    const kind: InputLink["kind"] =
      node.type === "prompt" ||
      node.type === "text" ||
      node.type === "image" ||
      node.type === "generator"
        ? node.type
        : "other";
    links.push({ edgeId: edge.id, sourceId: node.id, kind });
    if (
      (node.type === "prompt" || node.type === "text") &&
      typeof text === "string" &&
      text.trim()
    )
      prompts.push(text.trim());
    else if (node.type === "image") images.push(node.data.el);
    else if (node.type === "generator") {
      if (!placed) {
        placed = new Map();
        for (const n of nodes) {
          const jobId = n.type === "image" ? jobIdOf(n.data.el) : null;
          if (jobId) placed.set(jobId, n.data.el);
        }
      }
      const run = latestRunPictures(node, placed);
      images.push(...run.pictures);
      upstream.push({
        id: node.id,
        pictures: run.pictures.length,
        waiting: run.waiting,
      });
    }
  }
  return { prompts, images, upstream, links };
}

/**
 * Why a generator's inputs can't be sent yet, if they can't: an upstream
 * generator (链式) with no pictures to hand on.
 */
export function upstreamBlocker(upstream: readonly UpstreamRun[]): string | null {
  const empty = upstream.find((run) => run.pictures === 0);
  if (!empty) return null;
  return empty.waiting
    ? "上游「生成」还在出图，等它出完再生成"
    : "上游「生成」还没有图，先生成上游";
}

/** The description sent for a generator: connected prompts, then its own. */
export function composePrompt(
  inputs: Pick<GeneratorInputs, "prompts">,
  own: string,
): string {
  return [...inputs.prompts, own.trim()]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, PROMPT_MAX);
}

/** Decoded in the page: `fetch(data:)` is refused by connect-src (lib/image-blob.ts). */
function dataUrlToFile(dataURL: string, baseName: string): File {
  const blob = dataUrlToBlob(dataURL);
  const type = blob.type || "image/png";
  const extension = type === "image/jpeg" ? "jpg" : type === "image/webp" ? "webp" : "png";
  return new File([blob], `${baseName}.${extension}`, { type });
}

export class GeneratorRuntime {
  private state: RuntimeState = {
    jobs: new Map(),
    sending: new Set(),
    errors: new Map(),
    partial: new Map(),
    missing: new Set(),
  };
  private readonly listeners = new Set<() => void>();
  /** Jobs this page sent: they report their outcome and refresh the balance. */
  private readonly sessionJobs = new Set<string>();
  private readonly settled = new Set<string>();
  /** Polls since success, for jobs whose picture is not on the canvas yet. */
  private readonly sinceSuccess = new Map<string, number>();
  /** Uploaded copies of pictures that only exist in this page (fileId → URL). */
  private readonly referenceUrls = new Map<string, string>();
  /**
   * Slots of runs being sent, by generator, until their pending pictures
   * are on the canvas: generators sent together (全部生成) must not pick
   * the same free space for their pictures.
   */
  private readonly reservedSlots = new Map<string, Rect[]>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private polling = false;
  private disposed = false;
  private unsubscribeStore: (() => void) | null = null;

  constructor(
    private readonly store: NodeCanvasStore,
    private readonly deps: RuntimeDeps,
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = () => this.state;

  private set(patch: Partial<RuntimeState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  /** Starts following the pending pictures of the canvas. */
  start() {
    // React strict mode disposes and starts again on its double mount.
    this.disposed = false;
    this.unsubscribeStore?.();
    this.unsubscribeStore = this.store.subscribe(() => this.schedule());
    this.schedule(0);
  }

  dispose() {
    this.disposed = true;
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Job ids of the pictures shown as pending. */
  private pendingJobIds(): string[] {
    return this.store.scene.nodes.flatMap((node) =>
      node.type === "pending" && node.data.pending
        ? [node.data.pending.jobId]
        : [],
    );
  }

  private needsPoll(jobId: string) {
    const job = this.state.jobs.get(jobId);
    if (!job) return true;
    if (isActiveJob(job)) return true;
    // Finished but not on the canvas yet: keep fetching the canvas a while.
    return job.status === "succeeded" && !this.state.missing.has(jobId);
  }

  private schedule(delay = POLL_MS) {
    if (this.disposed || this.timer || this.polling) return;
    if (!this.pendingJobIds().some((id) => this.needsPoll(id))) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.poll();
    }, delay);
  }

  /** One round: fetch each pending job that is not settled. */
  async poll() {
    const token = this.deps.getToken();
    if (!token || this.polling) return;
    const visible =
      typeof document === "undefined" || document.visibilityState === "visible";
    const ids = this.pendingJobIds().filter((id) => this.needsPoll(id));
    if (!visible || ids.length === 0) {
      this.schedule();
      return;
    }
    this.polling = true;
    let sync = false;
    try {
      const jobs = new Map(this.state.jobs);
      const missing = new Set(this.state.missing);
      for (const id of ids) {
        let view: ImageJobView;
        try {
          view = toImageJobView((await this.deps.api.fetchJob(token, id)).job);
        } catch (error) {
          console.warn(`[node-canvas/runtime] job ${id} not fetched:`, error);
          continue;
        }
        const before = jobs.get(id);
        jobs.set(id, view);
        if (view.status === "succeeded") {
          const polls = (this.sinceSuccess.get(id) ?? 0) + 1;
          this.sinceSuccess.set(id, polls);
          sync = true;
          if (polls > PLACEMENT_GRACE_POLLS) {
            missing.add(id);
            console.warn(
              `[node-canvas/runtime] job ${id} finished but its picture is not on the canvas`,
            );
          }
        }
        if (!isActiveJob(view) && before?.status !== view.status)
          this.settle(view);
      }
      this.set({ jobs, missing });
    } finally {
      this.polling = false;
    }
    if (sync) this.deps.requestSync();
    this.schedule();
  }

  /** A job reached its end: tell the page once, for jobs it sent. */
  private settle(job: ImageJobView) {
    if (this.settled.has(job.id) || !this.sessionJobs.has(job.id)) return;
    this.settled.add(job.id);
    this.deps.onSettled();
    if (isFailedJob(job)) {
      this.deps.reportCode(
        job.errorCode ?? "upstream_unknown",
        job.errorMessage,
      );
      if (job.errorCode === "model_not_accessible") this.deps.onModelsStale?.();
    }
    console.info(`[node-canvas/runtime] job ${job.id} ${job.status}`);
  }

  /** URLs the server accepts for the connected pictures (uploads page-only ones). */
  private async referenceUrlsFor(
    images: SceneElement[],
    token: string,
  ): Promise<string[]> {
    const files = this.store.files;
    const urls: string[] = [];
    for (const image of images) {
      const fileId = typeof image.fileId === "string" ? image.fileId : null;
      const file = fileId ? files[fileId] : undefined;
      const stored =
        file?.storageUrl ??
        (fileId ? this.referenceUrls.get(fileId) : undefined);
      if (stored) {
        urls.push(stored);
        continue;
      }
      const source = imageSourceOf(image, files);
      if (!source) throw new Error("reference_missing");
      if (!source.startsWith("data:")) {
        urls.push(source);
        continue;
      }
      // A picture not saved yet (still inline): shrunk like any reference
      // before it goes up (canvases from before 0.0.18 hold originals of up
      // to 10 MB).
      const original = dataUrlToFile(source, image.id);
      const prepared = await (this.deps.prepareReference ?? passThrough)(original);
      if (prepared !== original)
        console.info(
          `[node-canvas/runtime] reference ${image.id} shrunk ${original.size} → ${prepared.size} bytes before upload`,
        );
      const upload = await this.deps.api.uploadFile(
        token,
        prepared,
        this.deps.projectId,
      );
      if (fileId) this.referenceUrls.set(fileId, upload.url);
      urls.push(upload.url);
    }
    return urls;
  }

  /**
   * Sends one batch for a generator. Returns false when nothing was sent
   * (the reason is in `errors` and the issue center).
   */
  async generate(generatorId: string, params: SendParams): Promise<boolean> {
    if (this.state.sending.has(generatorId)) return false;
    const token = this.deps.getToken();
    const node = this.store.scene.nodes.find((n) => n.id === generatorId);
    if (!token || !node || node.type !== "generator") return false;

    const config = readGenerator(node.data.el);
    const inputs = generatorInputs(
      this.store.scene.nodes,
      this.store.scene.edges,
      generatorId,
    );
    const prompt = composePrompt(inputs, config.prompt);
    if (!prompt) return false;
    const blocked = upstreamBlocker(inputs.upstream);
    if (blocked) {
      console.info("[node-canvas/runtime] not sent:", blocked, { generator: generatorId });
      return false;
    }

    const errors = new Map(this.state.errors);
    errors.delete(generatorId);
    const partial = new Map(this.state.partial);
    partial.delete(generatorId);
    this.set({
      sending: new Set([...this.state.sending, generatorId]),
      errors,
      partial,
    });
    const done = () => {
      const sending = new Set(this.state.sending);
      sending.delete(generatorId);
      return sending;
    };

    let references: string[] = [];
    try {
      references = await this.referenceUrlsFor(inputs.images, token);
    } catch (error) {
      console.warn(
        "[node-canvas/runtime] reference upload failed; nothing sent",
        error,
      );
      const spec = this.deps.report(error);
      const next = new Map(this.state.errors);
      if (spec) next.set(generatorId, spec);
      this.set({ sending: done(), errors: next });
      return false;
    }

    const obstacles = [
      ...this.store.scene.nodes
        .filter(
          (n) => n.id !== generatorId && n.type !== "frame" && n.type !== "line",
        )
        .map(rectOf),
      ...[...this.reservedSlots.entries()].flatMap(([id, rects]) =>
        id === generatorId ? [] : rects,
      ),
    ];
    const slots = outputSlots(
      rectOf(node),
      config.count,
      params.aspectRatio,
      obstacles,
    ).map((slot) => ({
      x: Math.round(slot.x),
      y: Math.round(slot.y),
      width: Math.round(slot.width),
      height: Math.round(slot.height),
    }));
    this.reservedSlots.set(generatorId, slots);
    const body: CreateImageBatchInput = {
      prompt,
      model: params.model,
      ...(params.keyId ? { key_id: params.keyId } : {}),
      aspect_ratio: params.aspectRatio,
      resolution: params.resolution,
      quality: params.quality,
      ...(params.outputFormat ? { output_format: params.outputFormat } : {}),
      ...(params.outputCompression != null
        ? { output_compression: params.outputCompression }
        : {}),
      ...(params.background && params.background !== "auto"
        ? { background: params.background }
        : {}),
      ...(params.moderation && params.moderation !== "auto"
        ? { moderation: params.moderation }
        : {}),
      count: config.count,
      project_id: this.deps.projectId,
      canvas_id: this.store.canvasId,
      canvas_source_id: generatorId,
      canvas_slots: slots,
      ...(references.length ? { input_images: references } : {}),
    };
    console.info("[node-canvas/runtime] batch sent", {
      generator: generatorId,
      model: params.model,
      key: params.keyId ?? null,
      upstream: inputs.upstream.map((run) => run.id),
      count: config.count,
      resolution: params.resolution,
      quality: params.quality,
      aspectRatio: params.aspectRatio,
      format: params.outputFormat ?? null,
      background: params.background ?? "auto",
      references: references.length,
    });

    let batch: Awaited<ReturnType<RuntimeApi["createImageBatch"]>>;
    try {
      batch = await this.deps.api.createImageBatch(token, body);
    } catch (error) {
      this.reservedSlots.delete(generatorId);
      const spec = this.deps.report(error);
      if (spec?.action === "reload_models") this.deps.onModelsStale?.();
      const next = new Map(this.state.errors);
      if (spec) next.set(generatorId, spec);
      this.set({ sending: done(), errors: next });
      console.warn("[node-canvas/runtime] batch rejected", spec?.title);
      return false;
    }

    const views = batch.jobs.map(toImageJobView);
    const jobs = new Map(this.state.jobs);
    for (const view of views) {
      jobs.set(view.id, view);
      this.sessionJobs.add(view.id);
    }
    const run = {
      batchId: batch.batch_id ?? null,
      jobs: views.flatMap((view, index) => {
        const slot = slots[view.batchIndex] ?? slots[index];
        return slot ? [{ jobId: view.id, slot }] : [];
      }),
      startedAt: Date.now(),
    };
    this.store.updateElement(
      generatorId,
      (el) => updateGenerator(el, { run }),
      { record: false },
    );
    this.store.showPending(generatorId, run.jobs);
    // The pending pictures now hold their slots on the canvas themselves.
    this.reservedSlots.delete(generatorId);
    const nextPartial = new Map(this.state.partial);
    if (views.length < batch.requested)
      nextPartial.set(generatorId, {
        queued: views.length,
        requested: batch.requested,
      });
    this.set({ sending: done(), jobs, partial: nextPartial });
    console.info("[node-canvas/runtime] batch queued", {
      batch: batch.batch_id,
      queued: views.length,
      requested: batch.requested,
    });
    this.schedule();
    return true;
  }

  /**
   * 并行生成: one batch per generator, all at once (each still its own
   * request and lock). Returns how many were sent.
   */
  async generateMany(
    runs: readonly { generatorId: string; params: SendParams }[],
  ): Promise<number> {
    console.info("[node-canvas/runtime] parallel run", {
      generators: runs.map((run) => run.generatorId),
    });
    const sent = await Promise.all(
      runs.map((run) => this.generate(run.generatorId, run.params)),
    );
    return sent.filter(Boolean).length;
  }

  /** Cancels a picture the server has not sent yet (free). */
  async cancel(jobId: string) {
    const token = this.deps.getToken();
    if (!token) return;
    try {
      const view = toImageJobView(
        (await this.deps.api.cancelJob(token, jobId)).job,
      );
      this.settled.add(view.id);
      this.set({ jobs: new Map(this.state.jobs).set(view.id, view) });
      console.info(`[node-canvas/runtime] job ${jobId} canceled`);
    } catch (error) {
      // Most likely already sent: it can no longer be canceled.
      this.deps.report(error);
      void this.poll();
    }
  }

  /** Stops showing pictures of a run (failed or canceled ones). */
  dismiss(generatorId: string, jobIds: readonly string[]) {
    this.store.dismissJobs(generatorId, jobIds);
  }
}

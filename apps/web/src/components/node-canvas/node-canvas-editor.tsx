"use client";

/**
 * The node canvas editor (React Flow 12, MIT; its attribution stays visible).
 *
 * State lives in a NodeCanvasStore (lib/node-canvas/store.ts) and generator
 * runs in a GeneratorRuntime (runtime.ts); this component wires them to
 * React Flow and to the page:
 * - saves: 1.5 s after the last change, only what changed since the server
 *   last saw it (canvas-save.ts: files once, deleted placed pictures as ids);
 *   a pending save is flushed on tab close (keepalive) and on unmount
 * - the project thumbnail and the design assistant's `canvas.screenshot`
 *   come from the 2D renderer (render.ts)
 * - selection goes to the chat as attachments (storage URLs preferred)
 * - uploads by picker, paste and drop; keyboard shortcuts
 *
 * The page talks to it through the NodeCanvasHandle given to `onReady`.
 */
import "@xyflow/react/dist/base.css";
import "./node-canvas.css";

import {
  IMAGE_ASPECT_RATIOS,
  type ImageArtifact,
  aspectRatioValue,
} from "@loomic/shared";
import {
  Background,
  BackgroundVariant,
  type EdgeTypes,
  MiniMap,
  type NodeTypes,
  type OnSelectionChangeParams,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
} from "@xyflow/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { useCanvasTheme } from "../../hooks/use-canvas-theme";
import type { WebSocketHandle } from "../../hooks/use-websocket";
import { useAccount } from "../../lib/account-context";
import { fetchAsDataURL, scaleToFit } from "../../lib/canvas-elements";
import {
  forgetStoredFiles,
  markFilesStored,
  resetStoredFiles,
} from "../../lib/canvas-files";
import {
  type SavePayload,
  buildCanvasSavePayload,
} from "../../lib/canvas-save";
import { downloadImage } from "../../lib/download";
import { getServerBaseUrl } from "../../lib/env";
import {
  createElement,
  jobIdOf,
  newElementId,
} from "../../lib/node-canvas/element";
import {
  GENERATOR_DEFAULTS,
  GENERATOR_WIDTH,
} from "../../lib/node-canvas/generator";
import {
  type Rect,
  boundsOf,
  freeSpotNear,
  rightOfEverything,
} from "../../lib/node-canvas/layout";
import { imageSourceOf, renderSceneToBlob } from "../../lib/node-canvas/render";
import { GeneratorRuntime } from "../../lib/node-canvas/runtime";
import {
  type CanvasContent,
  NodeCanvasStore,
} from "../../lib/node-canvas/store";
import type {
  SceneEdge,
  SceneElement,
  SceneFile,
  SceneNode,
} from "../../lib/node-canvas/types";
import {
  cancelJob,
  createImageBatch,
  fetchJob,
  saveCanvas,
  uploadFile,
  uploadThumbnail,
} from "../../lib/server-api";
import { ErrorBoundary } from "../error-boundary";
import { useIssues } from "../issues/issue-provider";
import { useToast } from "../toast";
import {
  FrameNode,
  LineNode,
  ShapeNode,
  TextNode,
  VideoNode,
  requestTextEdit,
} from "./basic-nodes";
import {
  type CanvasTool,
  type CreateKind,
  ToolRail,
  ZOOM_LIMITS,
  ZoomBar,
} from "./canvas-chrome";
import { type CanvasPanel, FilesPanel, LayersPanel } from "./canvas-panels";
import { type NodeCanvasActions, NodeCanvasProvider } from "./context";
import { FlowEdge } from "./flow-edge";
import { GeneratorNode } from "./generator-node";
import { ImageNode } from "./image-node";
import { PendingNode } from "./pending-node";
import { PROMPT_WIDTH, PromptNode } from "./prompt-node";

const SAVE_DEBOUNCE_MS = 1500;
/** A failed save is tried again after this, doubling up to the max. */
const SAVE_RETRY_MS = 5000;
const SAVE_RETRY_MAX_MS = 60_000;
/** Resends per file after the server reports it missing (see persist). */
const MAX_FILE_RESENDS = 2;
const THUMBNAIL_DEBOUNCE_MS = 10_000;
const THUMBNAIL_MAX_SIZE = 400;
const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const UPLOAD_TYPES = ["image/png", "image/jpeg", "image/webp"];
/** Room for the edge between nodes placed next to each other. */
const NODE_GAP = 96;

const NODE_TYPES = {
  image: ImageNode,
  prompt: PromptNode,
  generator: GeneratorNode,
  text: TextNode,
  shape: ShapeNode,
  line: LineNode,
  frame: FrameNode,
  video: VideoNode,
  pending: PendingNode,
} as NodeTypes;

const EDGE_TYPES = { flow: FlowEdge } as EdgeTypes;

/** What the chat attaches for a selected element. */
export type CanvasSelectedElement = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  fileId?: string;
  dataUrl?: string;
  /** Storage URL; preferred over dataUrl for message attachments. */
  storageUrl?: string;
};

export type NodeCanvasHandle = {
  store: NodeCanvasStore;
  fitView: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  getZoom: () => number;
  /** Selects an element and brings it into view (layers panel). */
  focusElement: (id: string) => void;
  /** Opens the file picker; pictures land in the middle of the view. */
  importImages: () => void;
  /** Places a picture the design assistant made (when the server did not). */
  insertImageArtifact: (artifact: ImageArtifact) => Promise<void>;
  undo: () => void;
  redo: () => void;
  duplicateSelection: () => void;
};

type NodeCanvasEditorProps = {
  canvasId: string;
  projectId: string;
  accessToken: string;
  initialContent: CanvasContent;
  ws?: WebSocketHandle;
  onReady?: (handle: NodeCanvasHandle) => void;
  onSelectionChange?: (elements: CanvasSelectedElement[]) => void;
  /** Fetch the server's copy and merge it (store.mergeRemote). */
  onSyncRequest?: () => void;
};

export function NodeCanvasEditor(props: NodeCanvasEditorProps) {
  return (
    <ErrorBoundary
      onError={(error) => console.error("[node-canvas] render crashed:", error)}
    >
      <ReactFlowProvider>
        <EditorInner {...props} />
      </ReactFlowProvider>
    </ErrorBoundary>
  );
}

function rectOfNode(node: SceneNode): Rect {
  return {
    x: node.position.x,
    y: node.position.y,
    width: node.width ?? node.measured?.width ?? node.data.el.width,
    height: node.height ?? node.measured?.height ?? node.data.el.height,
  };
}

/** The listed ratio closest to a picture's shape. */
function nearestRatio(width: number, height: number): string {
  const target = width / Math.max(1, height);
  let best: string = GENERATOR_DEFAULTS.aspectRatio;
  let distance = Number.POSITIVE_INFINITY;
  for (const ratio of IMAGE_ASPECT_RATIOS) {
    const value = aspectRatioValue(ratio);
    if (!value) continue;
    const d = Math.abs(Math.log(value / target));
    if (d < distance) {
      distance = d;
      best = ratio;
    }
  }
  return best;
}

function readAsDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function imageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () =>
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("image unreadable"));
    img.src = src;
  });
}

/**
 * Where Delete and Backspace mean something else: text fields, and pickers,
 * menus and dialogs (a focused picker inside a node must not delete it).
 */
function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    Boolean(
      target.closest(
        "input, textarea, select, [role=combobox], [role=listbox], [role=menu], [role=dialog]",
      ),
    )
  );
}

/** Keys typed into a field, a menu or a dialog are not canvas shortcuts. */
function isEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return Boolean(
    target.closest(
      "input, textarea, select, button, [role=listbox], [role=menu], [role=dialog], [role=combobox]",
    ),
  );
}

function EditorInner({
  canvasId,
  projectId,
  accessToken,
  initialContent,
  ws,
  onReady,
  onSelectionChange,
  onSyncRequest,
}: NodeCanvasEditorProps) {
  const theme = useCanvasTheme();
  const flow = useReactFlow<SceneNode, SceneEdge>();
  const { notifyGenerationSettled, refreshImageModels } = useAccount();
  const { report, reportCode } = useIssues();
  const { error: toastError } = useToast();

  // Callbacks used from outside React (runtime, timers) read the latest values.
  const tokenRef = useRef(accessToken);
  tokenRef.current = accessToken;
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const latest = useRef({
    notifyGenerationSettled,
    refreshImageModels,
    report,
    reportCode,
    onSyncRequest,
    onSelectionChange,
  });
  latest.current = {
    notifyGenerationSettled,
    refreshImageModels,
    report,
    reportCode,
    onSyncRequest,
    onSelectionChange,
  };

  const [store] = useState(() => new NodeCanvasStore(canvasId, initialContent));
  const [runtime] = useState(
    () =>
      new GeneratorRuntime(store, {
        getToken: () => tokenRef.current,
        projectId,
        api: { createImageBatch, fetchJob, cancelJob, uploadFile },
        onSettled: () => latest.current.notifyGenerationSettled(),
        report: (error) => latest.current.report(error),
        reportCode: (code, message) => latest.current.reportCode(code, message),
        requestSync: () => latest.current.onSyncRequest?.(),
        onModelsStale: () => void latest.current.refreshImageModels(),
      }),
  );
  useEffect(() => {
    runtime.start();
    return () => runtime.dispose();
  }, [runtime]);

  const state = useSyncExternalStore(
    store.subscribe,
    store.getState,
    store.getState,
  );
  const [tool, setTool] = useState<CanvasTool>("select");
  const [panel, setPanel] = useState<CanvasPanel | null>(null);
  const togglePanel = useCallback(
    (next: CanvasPanel) => setPanel((open) => (open === next ? null : next)),
    [],
  );
  const closePanel = useCallback(() => setPanel(null), []);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Every file the canvas opened with is on the server: saves send new ones only.
  useEffect(() => {
    resetStoredFiles(canvasId, Object.keys(initialContent.files ?? {}));
  }, [canvasId, initialContent.files]);

  // ── saving ──────────────────────────────────────────────────────────

  const savedRevision = useRef(0);
  const seenRevision = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thumbTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resendCounts = useRef(new Map<string, number>());
  const saveInFlight = useRef(false);
  const saveAgain = useRef(false);
  const saveFailures = useRef(0);
  // False once the editor is gone: a failed final flush is not retried.
  const mounted = useRef(true);

  const buildPayload = useCallback((): SavePayload | null => {
    const elements = store.elements();
    const payload = buildCanvasSavePayload(
      canvasId,
      elements,
      store.appState,
      store.files,
    );
    // Never replace a canvas that opened with content by an empty one unless
    // the user deleted it (deletions leave tombstones).
    if (
      payload.content.elements.length === 0 &&
      store.initialCount > 0 &&
      !elements.some((el) => el.isDeleted)
    ) {
      console.warn(
        "[node-canvas] not saving an empty canvas that opened with content",
      );
      return null;
    }
    return payload;
  }, [store, canvasId]);

  const persist = useCallback(
    async (payload: SavePayload): Promise<void> => {
      const { missingFileIds } = await saveCanvas(
        tokenRef.current,
        canvasId,
        payload.content,
        payload.deletedElementIds,
      );
      markFilesStored(canvasId, payload.sentWithData);
      if (missingFileIds.length === 0) return;
      // The server lacks data for files a picture still uses (another tab's
      // save dropped them): send them again, a bounded number of times.
      forgetStoredFiles(canvasId, missingFileIds);
      const files = store.files;
      const counts = resendCounts.current;
      const resend = missingFileIds.filter(
        (id) =>
          typeof files[id]?.dataURL === "string" &&
          (counts.get(id) ?? 0) < MAX_FILE_RESENDS,
      );
      console.warn(
        `[node-canvas] server lacks ${missingFileIds.length} file(s); resending ${resend.length}`,
      );
      if (resend.length === 0) return;
      for (const id of resend) counts.set(id, (counts.get(id) ?? 0) + 1);
      const next = buildPayload();
      if (next) await persist(next);
    },
    [canvasId, store, buildPayload],
  );

  const saveNow = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    // One save at a time; changes made meanwhile go in the next one.
    if (saveInFlight.current) {
      saveAgain.current = true;
      return;
    }
    const revision = store.revision;
    if (revision === savedRevision.current) return;
    const payload = buildPayload();
    if (!payload) return;
    saveInFlight.current = true;
    store.setSaveStatus("saving");
    try {
      await persist(payload);
      savedRevision.current = Math.max(savedRevision.current, revision);
      saveFailures.current = 0;
      store.markSaved(revision);
    } catch (error) {
      // Saving is free and idempotent (versions decide), so it is retried
      // with backoff until it lands; the header shows it is not saved yet.
      const delay = Math.min(
        SAVE_RETRY_MAX_MS,
        SAVE_RETRY_MS * 2 ** saveFailures.current,
      );
      saveFailures.current += 1;
      console.error(
        `[node-canvas] save failed (attempt ${saveFailures.current}), retrying in ${delay} ms:`,
        error,
      );
      store.setSaveStatus("error");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (mounted.current)
        saveTimer.current = setTimeout(() => void saveNow(), delay);
    } finally {
      saveInFlight.current = false;
    }
    if (saveAgain.current) {
      saveAgain.current = false;
      void saveNow();
    }
  }, [store, buildPayload, persist]);

  const uploadThumb = useCallback(async () => {
    try {
      const rendered = await renderSceneToBlob(
        {
          elements: store.liveElements(),
          files: store.files,
          theme: themeRef.current,
          maxDimension: THUMBNAIL_MAX_SIZE,
        },
        "image/webp",
        0.8,
      );
      if (!rendered) return;
      await uploadThumbnail(tokenRef.current, projectId, rendered.blob);
      console.log(
        `[node-canvas] thumbnail uploaded (${rendered.blob.size} bytes)`,
      );
    } catch (error) {
      console.warn("[node-canvas] thumbnail not made or uploaded:", error);
    }
  }, [store, projectId]);

  // A save that failed is retried early once the network is evidently back:
  // the browser reports it online, or a fetch of the server's copy merged in.
  const retryFailedSave = useCallback(
    (why: string) => {
      if (store.getState().saveStatus !== "error" || !mounted.current) return;
      console.info(`[node-canvas] retrying the failed save (${why})`);
      saveFailures.current = 0;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void saveNow(), SAVE_DEBOUNCE_MS);
    },
    [store, saveNow],
  );
  useEffect(() => {
    const onOnline = () => retryFailedSave("back online");
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [retryFailedSave]);

  const seenSyncs = useRef(0);
  useEffect(
    () =>
      store.subscribe(() => {
        const { revision, remoteSyncs } = store.getState();
        if (remoteSyncs !== seenSyncs.current) {
          seenSyncs.current = remoteSyncs;
          retryFailedSave("server copy fetched");
        }
        if (revision === seenRevision.current) return;
        seenRevision.current = revision;
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => void saveNow(), SAVE_DEBOUNCE_MS);
        if (thumbTimer.current) clearTimeout(thumbTimer.current);
        thumbTimer.current = setTimeout(
          () => void uploadThumb(),
          THUMBNAIL_DEBOUNCE_MS,
        );
      }),
    [store, saveNow, uploadThumb, retryFailedSave],
  );

  // Unsaved changes go out on tab close (keepalive) and on unmount.
  const flushRef = useRef(saveNow);
  flushRef.current = saveNow;
  useEffect(() => {
    const flushOnUnload = () => {
      if (store.revision === savedRevision.current) return;
      const payload = buildPayload();
      if (!payload) return;
      // keepalive bodies are capped at 64 KiB: stored files go without their
      // data, so this only fails with large new images that were never saved.
      try {
        void fetch(`${getServerBaseUrl()}/api/canvases/${canvasId}`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${tokenRef.current}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            content: payload.content,
            deletedElementIds: payload.deletedElementIds,
          }),
          keepalive: true,
        });
      } catch {
        // Best effort during teardown.
      }
    };
    mounted.current = true;
    window.addEventListener("beforeunload", flushOnUnload);
    return () => {
      mounted.current = false;
      window.removeEventListener("beforeunload", flushOnUnload);
      if (thumbTimer.current) clearTimeout(thumbTimer.current);
      if (store.revision !== savedRevision.current) void flushRef.current();
    };
  }, [store, canvasId, buildPayload]);

  // ── screenshots for the design assistant ────────────────────────────

  const viewportBounds = useCallback((): Rect | null => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const { x, y, zoom } = flow.getViewport();
    return {
      x: -x / zoom,
      y: -y / zoom,
      width: rect.width / zoom,
      height: rect.height / zoom,
    };
  }, [flow]);

  useEffect(() => {
    if (!ws) return;
    return ws.registerRPC("canvas.screenshot", async (params) => {
      const {
        mode,
        region,
        max_dimension = 1024,
      } = params as {
        mode?: string;
        region?: Rect;
        max_dimension?: number;
      };
      const bounds =
        mode === "region" && region
          ? region
          : mode === "viewport"
            ? viewportBounds()
            : null;
      const rendered = await renderSceneToBlob(
        {
          elements: store.liveElements(),
          files: store.files,
          theme: themeRef.current,
          maxDimension: max_dimension,
          ...(bounds ? { bounds } : {}),
        },
        "image/png",
      );
      if (!rendered) throw new Error("画布上没有可截图的内容");
      console.info(
        `[node-canvas] screenshot ${mode ?? "all"} ${rendered.width}x${rendered.height}`,
      );
      return {
        url: await readAsDataURL(rendered.blob),
        width: rendered.width,
        height: rendered.height,
      };
    });
  }, [ws, store, viewportBounds]);

  // ── selection → chat ────────────────────────────────────────────────

  const selectedKey = useRef("");
  const handleSelectionChange = useCallback(
    ({ nodes }: OnSelectionChangeParams<SceneNode, SceneEdge>) => {
      const ids = nodes
        .filter((n) => n.type !== "pending")
        .map((n) => n.id)
        .sort();
      const key = ids.join(",");
      if (key === selectedKey.current) return;
      selectedKey.current = key;
      const notify = latest.current.onSelectionChange;
      if (!notify) return;
      const live = new Map(store.liveElements().map((el) => [el.id, el]));
      const files = store.files;
      notify(
        ids.flatMap((id): CanvasSelectedElement[] => {
          const el = live.get(id);
          if (!el) return [];
          const item: CanvasSelectedElement = {
            id,
            type: el.type,
            x: el.x,
            y: el.y,
            width: el.width,
            height: el.height,
          };
          if (typeof el.text === "string" && el.text) item.text = el.text;
          if (el.type === "image" && typeof el.fileId === "string") {
            item.fileId = el.fileId;
            const file = files[el.fileId];
            const stored = file?.storageUrl ?? el.customData?.storageUrl;
            if (typeof stored === "string" && stored) item.storageUrl = stored;
            else if (file?.dataURL) item.dataUrl = file.dataURL;
          }
          return [item];
        }),
      );
    },
    [store],
  );

  // ── creating things ─────────────────────────────────────────────────

  const viewportCentre = useCallback(() => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return flow.screenToFlowPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
  }, [flow]);

  const obstacles = useCallback(
    () =>
      store.scene.nodes
        .filter((n) => n.type !== "frame" && n.type !== "line")
        .map(rectOfNode),
    [store],
  );

  const focusField = useCallback((id: string) => {
    requestAnimationFrame(() => document.getElementById(id)?.focus());
  }, []);

  const addImageFiles = useCallback(
    async (files: File[], at?: { x: number; y: number }) => {
      const elements: SceneElement[] = [];
      const sceneFiles: SceneFile[] = [];
      let spot = at ?? viewportCentre();
      for (const file of files) {
        if (!UPLOAD_TYPES.includes(file.type)) {
          toastError("只支持 PNG、JPEG、WebP 图片");
          continue;
        }
        if (file.size > UPLOAD_MAX_BYTES) {
          toastError("图片超过 10 MB，换一张小一点的");
          continue;
        }
        try {
          const dataURL = await readAsDataURL(file);
          const natural = await imageSize(dataURL);
          const size = scaleToFit(natural.width, natural.height, 480);
          const taken = [...obstacles(), ...elements];
          const position = at
            ? { x: spot.x - size.width / 2, y: spot.y - size.height / 2 }
            : freeSpotNear(spot, size, taken);
          const fileId = newElementId();
          sceneFiles.push({
            id: fileId,
            mimeType: file.type,
            created: Date.now(),
            dataURL,
          });
          elements.push(
            createElement(
              "image",
              { ...position, ...size },
              {
                fileId,
                status: "saved",
                scale: [1, 1],
                crop: null,
                strokeColor: "transparent",
                customData: {
                  title: file.name.slice(0, 60),
                  source: "uploaded",
                },
              },
            ),
          );
          spot = { x: spot.x + 24, y: spot.y + 24 };
        } catch (error) {
          console.warn("[node-canvas] picture not read:", error);
          toastError("这张图片读不出来，换一张试试");
        }
      }
      if (elements.length === 0) return;
      store.addElements(elements, { files: sceneFiles, select: true });
      console.info(`[node-canvas] added ${elements.length} picture(s)`);
    },
    [store, obstacles, viewportCentre, toastError],
  );

  const create = useCallback(
    (kind: CreateKind) => {
      if (kind === "image") {
        fileInputRef.current?.click();
        return;
      }
      const centre = viewportCentre();
      const selected = store.selectedNodes();
      if (kind === "prompt") {
        const size = { width: PROMPT_WIDTH, height: 140 };
        const generators = selected.filter((n) => n.type === "generator");
        const target = generators.length === 1 ? generators[0] : undefined;
        const position = target
          ? freeSpotNear(
              {
                x: target.position.x - NODE_GAP - size.width / 2,
                y: target.position.y + size.height / 2,
              },
              size,
              obstacles(),
            )
          : freeSpotNear(centre, size, obstacles());
        const el = createElement(
          "prompt",
          { ...position, ...size },
          { text: "", strokeColor: "transparent" },
        );
        store.addElements([el], { select: true });
        if (target) store.connect(el.id, target.id);
        focusField(`prompt-${el.id}`);
        return;
      }
      if (kind === "generator") {
        const size = { width: GENERATOR_WIDTH, height: 440 };
        const sources = selected.filter(
          (n) => n.type === "prompt" || n.type === "image" || n.type === "text",
        );
        const box = boundsOf(sources.map(rectOfNode));
        const position = box
          ? freeSpotNear(
              {
                x: box.x + box.width + NODE_GAP + size.width / 2,
                y: box.y + size.height / 2,
              },
              size,
              obstacles(),
            )
          : freeSpotNear(centre, size, obstacles());
        const el = createElement(
          "generator",
          { ...position, ...size },
          {
            strokeColor: "transparent",
            customData: { generator: { ...GENERATOR_DEFAULTS } },
          },
        );
        store.addElements([el], { select: true });
        for (const source of sources) store.connect(source.id, el.id);
        focusField(`generator-prompt-${el.id}`);
        return;
      }
      if (kind === "text") {
        const el = createElement(
          "text",
          { x: centre.x - 60, y: centre.y - 14, width: 120, height: 25 },
          {
            text: "",
            originalText: "",
            fontSize: 20,
            fontFamily: 2,
            textAlign: "left",
            verticalAlign: "top",
            containerId: null,
            lineHeight: 1.25,
            autoResize: true,
          },
        );
        requestTextEdit(el.id);
        store.addElements([el], { select: true });
        return;
      }
      const size = { width: 640, height: 400 };
      const el = createElement(
        "frame",
        { ...freeSpotNear(centre, size, obstacles()), ...size },
        { name: null },
      );
      store.addElements([el], { select: true });
    },
    [store, viewportCentre, obstacles, focusField],
  );

  const actions = useMemo<NodeCanvasActions>(
    () => ({
      generateFrom: (imageId) => {
        const image = store.liveElements().find((el) => el.id === imageId);
        if (!image) return;
        const size = { width: GENERATOR_WIDTH, height: 440 };
        const position = freeSpotNear(
          {
            x: image.x + image.width + NODE_GAP + size.width / 2,
            y: image.y + size.height / 2,
          },
          size,
          obstacles(),
        );
        const el = createElement(
          "generator",
          { ...position, ...size },
          {
            strokeColor: "transparent",
            customData: {
              generator: {
                ...GENERATOR_DEFAULTS,
                aspectRatio: nearestRatio(image.width, image.height),
              },
            },
          },
        );
        store.addElements([el], { select: true });
        store.connect(imageId, el.id);
        focusField(`generator-prompt-${el.id}`);
        console.info(`[node-canvas] generator from picture ${imageId}`);
      },
      download: (imageId) => {
        const image = store.liveElements().find((el) => el.id === imageId);
        const src = image ? imageSourceOf(image, store.files) : null;
        if (!image || !src) return;
        const title =
          typeof image.customData?.title === "string"
            ? image.customData.title
            : "";
        const name = (title || "gguu-image")
          .replace(/[\\/:*?"<>|]+/g, "_")
          .slice(0, 60);
        void downloadImage(src, `${name}.png`);
      },
    }),
    [store, obstacles, focusField],
  );

  // ── the handle for the page ─────────────────────────────────────────

  const insertImageArtifact = useCallback(
    async (artifact: ImageArtifact) => {
      // The worker may have placed it already (agent jobs carry their canvas).
      if (
        artifact.jobId &&
        store.scene.nodes.some(
          (node) => jobIdOf(node.data.el) === artifact.jobId,
        )
      )
        return;
      const dataURL = await fetchAsDataURL(artifact.url);
      const size = artifact.placement
        ? { width: artifact.placement.width, height: artifact.placement.height }
        : scaleToFit(artifact.width, artifact.height, 600);
      const position = artifact.placement
        ? { x: artifact.placement.x, y: artifact.placement.y }
        : rightOfEverything(obstacles(), size, viewportCentre());
      const fileId = newElementId();
      const el = createElement(
        "image",
        { ...position, ...size },
        {
          fileId,
          status: "saved",
          scale: [1, 1],
          crop: null,
          strokeColor: "transparent",
          customData: {
            ...(artifact.title ? { title: artifact.title.slice(0, 60) } : {}),
            source: "generated",
            storageUrl: artifact.url,
          },
        },
      );
      store.addElements([el], {
        files: [
          {
            id: fileId,
            mimeType: artifact.mimeType,
            created: Date.now(),
            dataURL,
          },
        ],
      });
      console.info("[node-canvas] placed a picture from the design assistant");
    },
    [store, obstacles, viewportCentre],
  );

  const handle = useMemo<NodeCanvasHandle>(
    () => ({
      store,
      fitView: () =>
        void flow.fitView({ padding: 0.2, maxZoom: 1, duration: 240 }),
      zoomIn: () => void flow.zoomIn({ duration: 180 }),
      zoomOut: () => void flow.zoomOut({ duration: 180 }),
      getZoom: () => flow.getZoom(),
      focusElement: (id) => {
        store.select([id]);
        const node = store.scene.nodes.find((n) => n.id === id);
        if (node)
          void flow.fitView({
            nodes: [{ id }],
            padding: 0.6,
            maxZoom: Math.max(1, flow.getZoom()),
            duration: 240,
          });
      },
      importImages: () => fileInputRef.current?.click(),
      insertImageArtifact,
      undo: () => store.undo(),
      redo: () => store.redo(),
      duplicateSelection: () => store.duplicateSelection(),
    }),
    [store, flow, insertImageArtifact],
  );

  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  const handleInit = useCallback(() => {
    readyRef.current?.(handle);
  }, [handle]);

  // ── keyboard, paste, drop ───────────────────────────────────────────

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const active = document.activeElement;
      // Only when the canvas (or nothing) has focus, not the chat or a menu.
      if (
        active &&
        active !== document.body &&
        !wrapperRef.current?.contains(active)
      )
        return;
      // Delete goes through the store's own selection (React Flow's delete
      // key is off): a selection made a moment ago (⌘A) may not have reached
      // React Flow's internal state yet. Buttons on the board don't use it.
      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !isTextTarget(event.target)
      ) {
        event.preventDefault();
        store.deleteSelection();
        return;
      }
      if (isEditingTarget(event.target)) return;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (mod && key === "z") {
        event.preventDefault();
        if (event.shiftKey) store.redo();
        else store.undo();
      } else if (mod && key === "y") {
        event.preventDefault();
        store.redo();
      } else if (mod && key === "d") {
        event.preventDefault();
        store.duplicateSelection();
      } else if (mod && key === "a") {
        event.preventDefault();
        store.select(
          store.scene.nodes
            .filter((n) => n.type !== "pending")
            .map((n) => n.id),
        );
      } else if (mod || event.altKey) {
        return;
      } else if (event.shiftKey && event.code === "Digit1") {
        event.preventDefault();
        void flow.fitView({ padding: 0.2, maxZoom: 1, duration: 240 });
      } else if (key === "escape") {
        store.select([]);
      } else if (key === "v") setTool("select");
      else if (key === "h") setTool("hand");
      else if (key === "p") create("prompt");
      else if (key === "g") create("generator");
      else if (key === "u") create("image");
      else if (key === "t") {
        event.preventDefault();
        create("text");
      } else if (key === "f") create("frame");
    };
    const onPaste = (event: ClipboardEvent) => {
      if (isEditingTarget(event.target)) return;
      const active = document.activeElement;
      if (
        active &&
        active !== document.body &&
        !wrapperRef.current?.contains(active)
      )
        return;
      const files = Array.from(event.clipboardData?.files ?? []).filter(
        (file) => file.type.startsWith("image/"),
      );
      if (files.length === 0) return;
      event.preventDefault();
      void addImageFiles(files);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("paste", onPaste);
    };
  }, [store, flow, create, addImageFiles]);

  const onDragOver = useCallback((event: React.DragEvent) => {
    if (event.dataTransfer.types.includes("Files")) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      const files = Array.from(event.dataTransfer.files).filter((file) =>
        file.type.startsWith("image/"),
      );
      if (files.length === 0) return;
      event.preventDefault();
      void addImageFiles(
        files,
        flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
      );
    },
    [flow, addImageFiles],
  );

  const contextValue = useMemo(
    () => ({ store, runtime, theme, actions }),
    [store, runtime, theme, actions],
  );

  // Dashed links from a generator to the slots of its pictures on the way.
  // View only: they are not elements and never saved.
  const edges = useMemo(() => {
    const links = state.scene.nodes.flatMap((node): SceneEdge[] => {
      const generatorId =
        node.type === "pending" ? node.data.pending?.generatorId : undefined;
      return generatorId
        ? [
            {
              id: `${node.id}-link`,
              type: "flow",
              source: generatorId,
              target: node.id,
              selectable: false,
              deletable: false,
              focusable: false,
              className: "pending-link",
            },
          ]
        : [];
    });
    return links.length ? [...state.scene.edges, ...links] : state.scene.edges;
  }, [state.scene.nodes, state.scene.edges]);

  // While a connection is dragged every handle shows (node-canvas.css).
  const [connecting, setConnecting] = useState(false);

  return (
    <NodeCanvasProvider value={contextValue}>
      <div
        ref={wrapperRef}
        className="node-canvas relative size-full bg-ground"
        data-tool={tool}
        data-connecting={connecting || undefined}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <ReactFlow<SceneNode, SceneEdge>
          nodes={state.scene.nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          onNodesChange={store.onNodesChange}
          onEdgesChange={store.onEdgesChange}
          onConnect={store.onConnect}
          onConnectStart={() => setConnecting(true)}
          onConnectEnd={() => setConnecting(false)}
          isValidConnection={store.isValidConnection}
          onSelectionChange={handleSelectionChange}
          onInit={handleInit}
          colorMode={theme}
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          minZoom={ZOOM_LIMITS.min}
          maxZoom={ZOOM_LIMITS.max}
          deleteKeyCode={null}
          selectionOnDrag={tool === "select"}
          panOnDrag={tool === "hand" ? true : [1, 2]}
          panOnScroll
          zoomOnScroll={false}
          zoomOnPinch
          selectionMode={SelectionMode.Partial}
          elevateNodesOnSelect={false}
          nodeDragThreshold={2}
          defaultEdgeOptions={{ type: "flow" }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} />
          <Panel position="top-left" style={{ marginTop: 64 }}>
            <ToolRail
              tool={tool}
              onTool={setTool}
              onCreate={create}
              onUndo={() => store.undo()}
              onRedo={() => store.redo()}
              layersOpen={panel === "layers"}
              filesOpen={panel === "files"}
              onToggleLayers={() => togglePanel("layers")}
              onToggleFiles={() => togglePanel("files")}
            />
          </Panel>
          <MiniMap
            position="bottom-left"
            pannable
            zoomable
            ariaLabel="画布缩略图"
            nodeBorderRadius={6}
            className="max-md:!hidden"
            style={{ width: 176, height: 112, marginLeft: 76 }}
          />
          <Panel position="bottom-left" className="md:!ml-[264px]">
            <ZoomBar />
          </Panel>
        </ReactFlow>
        {panel === "layers" ? (
          <LayersPanel onClose={closePanel} onPick={handle.focusElement} />
        ) : panel === "files" ? (
          <FilesPanel onClose={closePanel} onPick={handle.focusElement} />
        ) : null}
        <input
          ref={fileInputRef}
          type="file"
          accept={UPLOAD_TYPES.join(",")}
          multiple
          className="hidden"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (files.length) void addImageFiles(files);
          }}
        />
      </div>
    </NodeCanvasProvider>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState, memo } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUpRight,
  Circle,
  Hand,
  ImagePlus,
  Minus,
  MousePointer2,
  Pencil,
  Square,
  Type,
  WandSparkles,
} from "lucide-react";

import { findModelMeta } from "../lib/image-model-meta";
import {
  createImageGeneratorElement,
  isImageGeneratorElement,
  getImageGeneratorData,
  type ImageGeneratorData,
} from "../lib/canvas-image-generator";
import { cn } from "../lib/utils";
import { ImageGeneratorPanel, isGenerationInFlight } from "./canvas/image-generator-panel";
import { LiveDot } from "./ambient/live-dot";

type ToolType =
  | "hand"
  | "selection"
  | "rectangle"
  | "ellipse"
  | "arrow"
  | "line"
  | "freedraw"
  | "text"
  | "image";

const TOOL_GROUPS: (ToolType | null)[] = [
  "hand",
  "selection",
  null,
  "rectangle",
  "ellipse",
  "arrow",
  "line",
  "freedraw",
  null,
  "text",
  "image",
];

const TOOL_ICONS: Record<ToolType, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  hand: Hand,
  selection: MousePointer2,
  rectangle: Square,
  ellipse: Circle,
  arrow: ArrowUpRight,
  line: Minus,
  freedraw: Pencil,
  text: Type,
  image: ImagePlus,
};

const TOOL_LABELS: Record<ToolType, string> = {
  hand: "拖拽画布 (H)",
  selection: "选择 (V)",
  rectangle: "矩形 (R)",
  ellipse: "椭圆 (O)",
  arrow: "箭头 (A)",
  line: "直线 (L)",
  freedraw: "画笔 (P)",
  text: "文字 (T)",
  image: "插入本地图片 (9)",
};

type CanvasToolMenuProps = {
  accessToken: string;
  excalidrawApi: any;
  leftPanelOpen?: boolean | undefined;
};

type Bounds = { x: number; y: number; width: number; height: number };

type GeneratingFrame = {
  id: string;
  screenX: number;
  screenY: number;
  screenW: number;
  screenH: number;
  model?: string;
};

/** Developing overlay for one placeholder that is waiting on a result. */
const GeneratingOverlay = memo(function GeneratingOverlay({
  id,
  screenX,
  screenY,
  screenW,
  screenH,
  model,
}: GeneratingFrame) {
  const live = isGenerationInFlight(id);
  const name = model ? (findModelMeta(model)?.displayName ?? model) : null;
  const compact = screenW < 160 || screenH < 120;
  return (
    <div
      className={cn(
        "pointer-events-none fixed overflow-hidden rounded-frame",
        live ? "animate-breathe" : "border border-dashed border-alert/60 bg-white/[0.05]",
      )}
      style={{ left: screenX, top: screenY, width: screenW, height: screenH, zIndex: 99 }}
    >
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-3 text-center">
        <span className="flex items-center gap-2 text-[12.5px] font-medium text-fg">
          {live ? <LiveDot /> : null}
          {live ? "生成中" : "结果未知"}
        </span>
        {!compact ? (
          <span className="max-w-[18em] text-[11.5px] leading-snug text-fg-soft">
            {live
              ? name ?? "请求已发往主站"
              : "页面刷新前没有返回结果，可能已扣费。选中它查看说明。"}
          </span>
        ) : null}
      </div>
    </div>
  );
});

export function CanvasToolMenu({ accessToken, excalidrawApi, leftPanelOpen }: CanvasToolMenuProps) {
  const [activeTool, setActiveTool] = useState<string>("selection");

  const [activeGeneratorId, setActiveGeneratorId] = useState<string | null>(null);
  const [generatorData, setGeneratorData] = useState<ImageGeneratorData | null>(null);
  const [generatorBounds, setGeneratorBounds] = useState<Bounds | null>(null);

  const [canvasScrollZoom, setCanvasScrollZoom] = useState({
    scrollX: 0,
    scrollY: 0,
    zoom: 1,
  });

  const [generatingElements, setGeneratingElements] = useState<GeneratingFrame[]>([]);

  // Readable inside onChange without re-subscribing.
  const activeGeneratorIdRef = useRef(activeGeneratorId);
  activeGeneratorIdRef.current = activeGeneratorId;
  // Skip setState when the generating set did not change.
  const prevGeneratingKeyRef = useRef("");

  const closePanel = useCallback(() => {
    setActiveGeneratorId(null);
    setGeneratorData(null);
    setGeneratorBounds(null);
  }, []);

  // onChange fires on every frame while dragging or drawing: only set state
  // when something actually changed.
  useEffect(() => {
    if (!excalidrawApi) return;

    const unsubscribe = excalidrawApi.onChange(
      (elements: any[], appState: any) => {
        const tool = appState?.activeTool?.type;
        if (tool) setActiveTool((prev: string) => (prev === tool ? prev : tool));

        const scrollX = appState?.scrollX ?? 0;
        const scrollY = appState?.scrollY ?? 0;
        const zoom = appState?.zoom?.value ?? 1;
        setCanvasScrollZoom((prev) => {
          if (prev.scrollX === scrollX && prev.scrollY === scrollY && prev.zoom === zoom) return prev;
          return { scrollX, scrollY, zoom };
        });

        // The panel follows the single selected generator placeholder.
        const selectedIds = appState?.selectedElementIds ?? {};
        const selected = elements.filter((el: any) => selectedIds[el.id] && !el.isDeleted);
        const currentId = activeGeneratorIdRef.current;
        const sel = selected.length === 1 ? selected[0] : null;
        if (sel && isImageGeneratorElement(sel)) {
          if (currentId !== sel.id) {
            setActiveGeneratorId(sel.id as string);
            setGeneratorData(getImageGeneratorData(sel));
          }
          setGeneratorBounds((prev) =>
            prev &&
            prev.x === sel.x &&
            prev.y === sel.y &&
            prev.width === sel.width &&
            prev.height === sel.height
              ? prev
              : {
                  x: sel.x as number,
                  y: sel.y as number,
                  width: sel.width as number,
                  height: sel.height as number,
                },
          );
        } else if (currentId) {
          closePanel();
        }

        const generatingRaw = elements.filter(
          (el: any) =>
            !el.isDeleted &&
            isImageGeneratorElement(el) &&
            el.customData?.status === "generating",
        );
        const genKey = generatingRaw
          .map((el: any) => `${el.id}:${el.x}:${el.y}:${el.width}:${el.height}:${scrollX}:${scrollY}:${zoom}`)
          .join("|");
        if (genKey !== prevGeneratingKeyRef.current) {
          prevGeneratingKeyRef.current = genKey;
          setGeneratingElements(
            generatingRaw.map((el: any) => ({
              id: el.id as string,
              screenX: ((el.x as number) + scrollX) * zoom,
              screenY: ((el.y as number) + scrollY) * zoom,
              screenW: (el.width as number) * zoom,
              screenH: (el.height as number) * zoom,
              ...(el.customData?.model ? { model: el.customData.model as string } : {}),
            })),
          );
        }
      },
    );

    return unsubscribe;
  }, [excalidrawApi, closePanel]);

  const handleToolChange = useCallback(
    (tool: ToolType) => {
      excalidrawApi?.setActiveTool({ type: tool });
    },
    [excalidrawApi],
  );

  const handleCreateImageGenerator = useCallback(() => {
    if (!excalidrawApi) return;
    const elementId = createImageGeneratorElement(excalidrawApi);
    excalidrawApi.updateScene({
      appState: { selectedElementIds: { [elementId]: true } },
    });
    setActiveGeneratorId(elementId);
    const el = excalidrawApi.getSceneElements().find((e: any) => e.id === elementId);
    if (el) {
      setGeneratorData(getImageGeneratorData(el));
      setGeneratorBounds({ x: el.x, y: el.y, width: el.width, height: el.height });
    }
    console.info("[canvas] generator placeholder created", elementId);
  }, [excalidrawApi]);

  return (
    <>
      <div
        role="toolbar"
        aria-label="画布工具"
        className="scrollbar-hidden absolute bottom-5 z-30 flex w-max max-w-[calc(100vw-16px)] items-center gap-0.5 overflow-x-auto rounded-lg border border-line bg-panel/80 backdrop-blur-xl p-1 shadow-float transition-[left,transform] duration-200"
        style={{
          left: leftPanelOpen ? "calc(140px + 50%)" : "50%",
          transform: "translateX(-50%)",
        }}
      >
        {TOOL_GROUPS.map((tool, i) => {
          if (tool === null) {
            return <div key={`sep-${i}`} className="mx-1 h-5 w-px bg-line" aria-hidden />;
          }
          const Icon = TOOL_ICONS[tool];
          const isActive = activeTool === tool;
          return (
            <button
              key={tool}
              type="button"
              title={TOOL_LABELS[tool]}
              aria-label={TOOL_LABELS[tool]}
              aria-pressed={isActive}
              onMouseDown={(e) => {
                e.preventDefault();
                handleToolChange(tool);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleToolChange(tool);
                }
              }}
              className={cn(
                "flex size-8 items-center justify-center rounded-md transition-colors outline-none focus-visible:outline-2 focus-visible:outline-amb",
                isActive ? "bg-fg text-ground" : "text-fg-soft hover:bg-white/[0.06] hover:text-fg",
              )}
            >
              <Icon className="size-4" strokeWidth={1.75} />
            </button>
          );
        })}

        <div className="mx-1 h-5 w-px bg-line" aria-hidden />

        <button
          type="button"
          title="生成图片：放一个画框，写提示词出图"
          aria-label="生成图片"
          onClick={handleCreateImageGenerator}
          className={cn(
            "flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors outline-none focus-visible:outline-2 focus-visible:outline-alert",
            activeGeneratorId
              ? "bg-alert text-ground"
              : "text-alert hover:bg-alert-wash",
          )}
        >
          <WandSparkles className="size-4" strokeWidth={1.75} />
          <span className="hidden sm:inline">生成</span>
        </button>
      </div>

      {activeGeneratorId && generatorData && generatorBounds && (
        <ImageGeneratorPanel
          key={activeGeneratorId}
          elementId={activeGeneratorId}
          elementBounds={generatorBounds}
          data={generatorData}
          excalidrawApi={excalidrawApi}
          accessToken={accessToken}
          canvasScrollZoom={canvasScrollZoom}
          onClose={closePanel}
        />
      )}

      {generatingElements.length > 0 &&
        createPortal(
          <>
            {generatingElements.map((el) => (
              <GeneratingOverlay key={el.id} {...el} />
            ))}
          </>,
          document.body,
        )}
    </>
  );
}

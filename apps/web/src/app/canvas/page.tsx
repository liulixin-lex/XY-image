"use client";

import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, Suspense } from "react";

import type { ImageArtifact } from "@loomic/shared";
import { RotateCwIcon } from "lucide-react";

import { AccountChip } from "../../components/account/account-chip";
import { BrandLockup } from "../../components/brand/brand-mark";
import { Button, buttonVariants } from "../../components/ui/button";
import type { CanvasImageItem } from "../../components/canvas-image-picker";
import type { CanvasSelectedElement } from "../../components/canvas-editor";
import { LoadingScreen } from "../../components/loading-screen";
import { useAuth } from "../../lib/auth-context";
import { useWebSocket } from "../../hooks/use-websocket";
import { useJobFallbackPolling } from "../../hooks/use-job-fallback-polling";
import { CanvasEditor } from "../../components/canvas-editor";
import { ChatSidebar } from "../../components/chat-sidebar";
import { CanvasEmptyHint } from "../../components/canvas-empty-hint";
import { CanvasLogoMenu } from "../../components/canvas-logo-menu";
import { EditableProjectName } from "../../components/editable-project-name";
import { insertImageOnCanvas } from "../../lib/canvas-elements";
import { useAccount } from "../../lib/account-context";
import { BRAND } from "../../lib/brand";
import { cn } from "../../lib/utils";
import {
  ApiApplicationError,
  ApiAuthError,
  fetchCanvas,
  fetchProject,
} from "../../lib/server-api";
import {
  loadCanvasFiles,
  markFilesStored,
  type ServerCanvasFile,
} from "../../lib/canvas-files";
import { BrandKitSelector } from "../../components/brand-kit-selector";
import { CanvasBottomBar } from "../../components/canvas-bottom-bar";
import { CanvasFilesPanel } from "../../components/canvas-files-panel";
import { CanvasLayersPanel } from "../../components/canvas-layers-panel";

function CanvasPageContent() {
  const searchParams = useSearchParams();
  const canvasId = searchParams.get("id");
  const initialSessionId = searchParams.get("session") ?? undefined;
  // Capture prompt once — router.replace will strip it from URL, but the
  // value must survive for the auto-send effect in ChatSidebar.
  const [initialPrompt] = useState(() => searchParams.get("prompt") ?? undefined);
  const { user, session, loading: authLoading } = useAuth();
  const router = useRouter();

  const [canvasData, setCanvasData] = useState<{
    id: string;
    name: string;
    projectId: string;
    content: {
      elements: Record<string, unknown>[];
      appState: Record<string, unknown>;
      files: Record<string, Record<string, unknown>>;
    };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  // Default chat open on desktop, closed on mobile/tablet to avoid blocking canvas
  const [chatOpen, setChatOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.innerWidth >= 1024;
  });
  const [layersOpen, setLayersOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [brandKitId, setBrandKitId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("未命名项目");
  const [selectedCanvasElements, setSelectedCanvasElements] = useState<CanvasSelectedElement[]>([]);

  const excalidrawApiRef = useRef<any>(null);
  const [excalidrawApi, setExcalidrawApi] = useState<any>(null);

  const routerRef = useRef(router);
  routerRef.current = router;

  // Stable callbacks for panel toggles to prevent re-renders of child components
  const handleOpenChat = useCallback(() => setChatOpen(true), []);
  const handleToggleChat = useCallback(() => setChatOpen((v) => !v), []);
  const handleToggleLayers = useCallback(() => { setLayersOpen((v) => !v); setFilesOpen(false); }, []);
  const handleToggleFiles = useCallback(() => { setFilesOpen((v) => !v); setLayersOpen(false); }, []);
  const handleCloseLayers = useCallback(() => setLayersOpen(false), []);
  const handleCloseFiles = useCallback(() => setFilesOpen(false), []);

  const accessToken = session?.access_token;
  const accessTokenRef = useRef(accessToken);
  accessTokenRef.current = accessToken;

  const getToken = useCallback(() => accessTokenRef.current ?? null, []);
  const ws = useWebSocket(getToken);

  const handleApiReady = useCallback((api: any) => {
    excalidrawApiRef.current = api;
    setExcalidrawApi(api);
  }, []);

  const handleImageGenerated = useCallback((artifact: ImageArtifact) => {
    const api = excalidrawApiRef.current;
    if (!api) return;
    insertImageOnCanvas(api, artifact).catch((err) => {
      console.warn("Failed to insert image on canvas:", err);
    });
  }, []);

  // Must be defined BEFORE useJobFallbackPolling which references it
  const handleCanvasSync = useCallback(async () => {
    const api = excalidrawApiRef.current;
    const token = accessTokenRef.current;
    if (!api || !token || !canvasData) return;
    try {
      const { canvas } = await fetchCanvas(token, canvasData.id);
      const elements = canvas.content.elements ?? [];
      const files = (canvas.content as Record<string, unknown>).files as
        Record<string, ServerCanvasFile> | undefined;

      // Sync files into Excalidraw. Backend-inserted images arrive as storage
      // URLs (the agent writer stores a marker to the generated image); only
      // files the editor does not have yet are downloaded.
      if (files && Object.keys(files).length > 0) {
        markFilesStored(canvasData.id, Object.keys(files));
        const present = api.getFiles() as Record<string, unknown>;
        const absent = Object.fromEntries(
          Object.entries(files).filter(([fileId]) => !present[fileId]),
        );
        const loaded = await loadCanvasFiles(absent);
        if (loaded.length > 0) api.addFiles(loaded);
      }

      api.updateScene({ elements, captureUpdate: "IMMEDIATELY" });
    } catch (err) {
      console.warn("Failed to sync canvas:", err);
    }
  }, [canvasData]);

  // Fallback polling for timed-out generation jobs.
  // When the agent's tool times out but the worker eventually succeeds,
  // the backend will have already inserted the element into the canvas.
  // This hook detects completion and triggers a canvas re-fetch.
  const { checkForTimedOutJobs } = useJobFallbackPolling({
    accessTokenRef,
    onJobSucceeded: useCallback((_jobId: string, _jobType: string) => {
      // Element was inserted by backend — just refresh the canvas
      handleCanvasSync();
    }, [handleCanvasSync]),
  });

  const handleSessionChange = useCallback(
    (sessionId: string) => {
      if (!canvasId) return;
      // Update URL: set session param, remove prompt param to prevent re-send on refresh
      routerRef.current.replace(`/canvas?id=${canvasId}&session=${sessionId}`);
    },
    [canvasId],
  );

  const handleRequestCanvasImages = useCallback((): CanvasImageItem[] => {
    const api = excalidrawApiRef.current;
    if (!api) return [];
    const elements: any[] = api.getSceneElements() ?? [];
    const files: Record<string, any> = api.getFiles() ?? {};
    let idx = 0;
    return elements
      .filter((el: any) => el.type === "image" && !el.isDeleted && el.fileId)
      .map((el: any) => {
        idx++;
        const file = files[el.fileId];
        const dataURL = file?.dataURL ?? "";
        const title =
          el.customData?.title ||
          el.customData?.label ||
          `Image ${idx}`;
        return {
          kind: "canvas-image",
          id: el.id,
          name: title,
          thumbnailUrl: dataURL,
          assetId: el.id,
          url: dataURL,
          mimeType: file?.mimeType ?? "image/png",
        };
      });
  }, []);

  // Only re-fetch when canvasId changes or on initial auth resolution.
  // Token refreshes (e.g. tab switch back) should NOT trigger a reload —
  // we depend on user.id (stable string) instead of the user object ref.
  const userId = user?.id;

  useEffect(() => {
    if (authLoading) return;
    if (!userId) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      routerRef.current.replace(`/login?next=${next}`);
      return;
    }
    const token = accessTokenRef.current;
    if (!canvasId || !token) return;

    setPageLoading(true);
    fetchCanvas(token, canvasId)
      .then((data) => {
        const c = data.canvas;
        setCanvasData({
          id: c.id,
          name: c.name,
          projectId: c.projectId,
          content: {
            elements: c.content.elements ?? [],
            appState: c.content.appState ?? {},
            files: (c.content as any).files ?? {},
          },
        });
        setPageLoading(false);
        // Fetch project to get brand_kit_id and name
        fetchProject(token, c.projectId)
          .then((projectData) => {
            setBrandKitId(projectData.project.brand_kit_id);
            setProjectName(projectData.project.name ?? "未命名项目");
          })
          .catch((err) => console.warn("Failed to fetch project for brand kit:", err));
      })
      .catch((err) => {
        // 401 is handled by the auth-expiry listener (signs out, redirects).
        if (err instanceof ApiAuthError) return;
        console.warn("[canvas] load failed", err);
        setError(err instanceof ApiApplicationError && err.status === 404 ? "missing" : "failed");
        setPageLoading(false);
      });
    // Intentionally omitting accessTokenRef (stable ref) and routerRef
    // (ref wrappers) from deps — only re-run when auth resolves, user changes, or
    // canvasId changes. Token refresh (e.g. tab switch) must NOT trigger a reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, userId, canvasId]);

  if (!canvasId || error === "missing") {
    return (
      <CanvasNotice kind="missing" />
    );
  }

  if (authLoading || pageLoading) {
    return <LoadingScreen label="正在打开画布" />;
  }

  if (error) {
    return (
      <CanvasNotice kind="failed" />
    );
  }

  if (!canvasData || !accessToken) return null;

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* Top-left navigation bar */}
      <div className="absolute top-3 left-3 z-20 flex items-center gap-1.5">
        <CanvasLogoMenu
          accessToken={accessToken}
          projectId={canvasData.projectId}
          canvasId={canvasData.id}
          excalidrawApi={excalidrawApi}
        />
        <EditableProjectName
          accessToken={accessToken}
          projectId={canvasData.projectId}
          initialName={projectName}
        />
        <BrandKitSelector
          accessToken={accessToken}
          projectId={canvasData.projectId}
          currentBrandKitId={brandKitId}
          onBrandKitChange={(kitId) => setBrandKitId(kitId)}
        />
      </div>
      {/* Canvas always takes full width; on mobile/tablet, ChatSidebar overlays instead of side-by-side */}
      <div className="flex-1 relative min-w-0 overflow-hidden">
        {/* Balance + account, kept clear of the collapsed chat toggle
            (icon-only below sm, so the gap is smaller there). */}
        <div className={cn("absolute top-3 z-20", chatOpen ? "right-3" : "right-[58px] sm:right-[136px]")}>
          <AccountChip />
        </div>
        <KeyNotice />
        <CanvasEditor
          canvasId={canvasData.id}
          projectId={canvasData.projectId}
          accessToken={accessToken}
          initialContent={canvasData.content}
          onApiReady={handleApiReady}
          ws={ws}
          leftPanelOpen={layersOpen || filesOpen}
          onSelectionChange={setSelectedCanvasElements}
        />
        <CanvasEmptyHint
          excalidrawApi={excalidrawApi}
          onOpenChat={handleOpenChat}
        />
        <CanvasBottomBar
          excalidrawApi={excalidrawApi}
          layersOpen={layersOpen}
          onToggleLayers={handleToggleLayers}
          filesOpen={filesOpen}
          onToggleFiles={handleToggleFiles}
          leftPanelOpen={layersOpen || filesOpen}
        />
        <CanvasLayersPanel
          excalidrawApi={excalidrawApi}
          open={layersOpen}
          onClose={handleCloseLayers}
        />
        <CanvasFilesPanel
          excalidrawApi={excalidrawApi}
          open={filesOpen}
          onClose={handleCloseFiles}
        />
      </div>
      <ChatSidebar
        accessToken={accessToken}
        canvasId={canvasData.id}
        open={chatOpen}
        onToggle={handleToggleChat}
        onImageGenerated={handleImageGenerated}
        onCanvasSync={handleCanvasSync}
        onStreamEvent={checkForTimedOutJobs}
        initialPrompt={initialPrompt}
        initialSessionId={initialSessionId}
        onSessionChange={handleSessionChange}
        onRequestCanvasImages={handleRequestCanvasImages}
        currentBrandKitId={brandKitId}
        ws={ws}
        selectedCanvasElements={selectedCanvasElements}
      />
    </div>
  );
}

/** Missing keys block both the agent (chat key) and generation (image key). */
function KeyNotice() {
  const { account } = useAccount();
  const prefs = account.data?.preferences;
  if (!prefs) return null;
  const missing = [
    prefs.chat_key_id === null ? "对话" : null,
    prefs.image_key_id === null ? "生图" : null,
  ].filter(Boolean);
  if (missing.length === 0) return null;
  return (
    <div
      role="status"
      className="absolute top-3 left-1/2 z-20 hidden -translate-x-1/2 items-center gap-2 rounded-md border border-line bg-panel/80 backdrop-blur-xl px-3 py-2 text-[12.5px] text-fg-soft shadow-subtle md:flex"
    >
      <span className="size-1.5 shrink-0 rounded-full bg-alert" aria-hidden />
      还没选择{missing.join("和")} Key，设计助手{missing.includes("生图") ? "和生图" : ""}暂时用不了。
      <Link href="/settings?tab=keys" className="font-medium text-fg underline underline-offset-4">
        去选择
      </Link>
    </div>
  );
}

const NOTICE_COPY = {
  missing: {
    title: "找不到这张画布",
    body: "链接可能不完整，或者项目已经被删除。可以回到画布项目里重新打开。",
  },
  failed: {
    title: "画布没有加载出来",
    body: "可能是网络波动或服务暂时不可用，刷新页面再试一次。",
  },
} as const;

/**
 * Full-page notice when a canvas can't open. Same lit room as the 404 page,
 * plus the canvas dot grid fading in from the right, so it reads as "the
 * board that should be here" rather than a generic error card.
 */
function CanvasNotice({ kind }: { kind: keyof typeof NOTICE_COPY }) {
  const copy = NOTICE_COPY[kind];
  const canRetry = kind === "failed";
  return (
    <div className="relative isolate flex min-h-[100dvh] flex-col overflow-hidden bg-ground px-5 py-6 sm:px-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(50%_60%_at_75%_40%,rgb(var(--amb)/0.2),transparent_70%),radial-gradient(40%_50%_at_20%_80%,rgb(var(--amb-2)/0.14),transparent_70%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 -z-10 w-[min(100%,960px)] bg-[radial-gradient(rgb(255_255_255/0.1)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(60%_65%_at_65%_50%,black,transparent)] [-webkit-mask-image:radial-gradient(60%_65%_at_65%_50%,black,transparent)]"
      />
      <Link href="/home" aria-label={`${BRAND.name} 工作台`} className="self-start rounded-md">
        <BrandLockup />
      </Link>
      <main className="flex flex-1 flex-col items-start justify-center gap-5 py-12">
        <h1 className="font-display text-[clamp(40px,5.2vw,72px)] leading-[1.04] font-normal text-balance text-fg">
          {copy.title}
        </h1>
        <p className="max-w-[28em] text-[16px] leading-relaxed text-pretty text-fg-soft">{copy.body}</p>
        <div className="mt-3 flex flex-wrap gap-3">
          {canRetry ? (
            <Button
              variant="glow"
              size="lg"
              onClick={() => {
                console.info("[canvas] reloading after load failure");
                window.location.reload();
              }}
            >
              <RotateCwIcon data-icon="inline-start" strokeWidth={1.75} />
              刷新页面
            </Button>
          ) : null}
          <Link
            href="/projects"
            className={buttonVariants({ variant: canRetry ? "outline" : "glow", size: "lg" })}
          >
            回到画布项目
          </Link>
        </div>
      </main>
    </div>
  );
}

export default function CanvasPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <CanvasPageContent />
    </Suspense>
  );
}

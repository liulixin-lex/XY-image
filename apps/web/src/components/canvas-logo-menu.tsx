"use client";

import {
  Aperture,
  Copy,
  FolderOpen,
  Home,
  ImagePlus,
  Maximize2,
  Plus,
  Redo2,
  Trash2,
  Undo2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { BrandMark } from "@/components/brand/brand-mark";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deleteProject } from "@/lib/server-api";
import { useToast } from "@/components/toast";
import { useCreateProject } from "@/hooks/use-create-project";

interface CanvasLogoMenuProps {
  accessToken: string;
  projectId: string;
  canvasId: string;
  // biome-ignore lint/suspicious/noExplicitAny: Excalidraw API has no public type definition
  excalidrawApi: any | null;
}

/**
 * Excalidraw has no public undo/redo/duplicate API, so the menu replays the
 * keyboard shortcut on its container (verified against 0.18: the React
 * onKeyDown on `.excalidraw-container` handles synthetic events). Using the
 * native actions keeps history, groups and bindings correct.
 */
function dispatchKeyToExcalidraw(
  key: string,
  opts: { metaKey?: boolean; shiftKey?: boolean } = {},
) {
  const el = document.querySelector(".excalidraw-container");
  if (!el) {
    console.warn("[canvas] excalidraw container missing; shortcut not sent", key);
    return;
  }
  el.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      code: /^\d$/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`,
      metaKey: opts.metaKey ?? false,
      ctrlKey: opts.metaKey ?? false,
      shiftKey: opts.shiftKey ?? false,
      bubbles: true,
      cancelable: true,
    }),
  );
}

function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
}

export function CanvasLogoMenu({
  accessToken,
  projectId,
  excalidrawApi,
}: CanvasLogoMenuProps) {
  const router = useRouter();
  const { error: toastError } = useToast();
  const { create: createNewProject } = useCreateProject();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const [apple] = useState(isApplePlatform);

  const keys = apple
    ? { undo: "⌘Z", redo: "⇧⌘Z", duplicate: "⌘D", fit: "⇧1" }
    : { undo: "Ctrl+Z", redo: "Ctrl+Shift+Z", duplicate: "Ctrl+D", fit: "Shift+1" };

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        setConfirmingDelete(false);
        return;
      }
      const selected: Record<string, boolean> =
        excalidrawApi?.getAppState().selectedElementIds ?? {};
      setHasSelection(Object.values(selected).some(Boolean));
    },
    [excalidrawApi],
  );

  const handleDeleteProject = useCallback(async () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    try {
      await deleteProject(accessToken, projectId);
      console.info("[canvas] project deleted from logo menu");
      router.push("/projects");
    } catch (err) {
      console.warn("[canvas] delete project failed", err);
      toastError("项目删除失败，请稍后再试");
    } finally {
      setConfirmingDelete(false);
    }
  }, [accessToken, projectId, router, confirmingDelete, toastError]);

  return (
    <DropdownMenu onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger
        className="flex size-9 cursor-pointer items-center justify-center rounded-md border border-line bg-panel/80 backdrop-blur-xl shadow-subtle transition-colors outline-none hover:border-line-strong focus-visible:outline-2 focus-visible:outline-acc"
        aria-label="菜单"
      >
        <BrandMark className="size-6" aria-hidden title="" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" sideOffset={6} className="w-56">
        {/* Group 1 — Navigation */}
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => router.push("/home")}>
            <Home className="size-4" />
            首页
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push("/studio")}>
            <Aperture className="size-4" />
            生图
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push("/projects")}>
            <FolderOpen className="size-4" />
            画布项目
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        {/* Group 2 — Project actions */}
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => createNewProject()}>
            <Plus className="size-4" />
            新建画布
          </DropdownMenuItem>
          {/* Stays open on the first click so the confirm step is visible;
              closing the menu resets it. */}
          <DropdownMenuItem
            variant="destructive"
            closeOnClick={confirmingDelete}
            onClick={handleDeleteProject}
          >
            <Trash2 className="size-4" />
            {confirmingDelete ? "再点一次，确认删除" : "删除当前项目"}
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        {/* Group 3 — Canvas import: Excalidraw's own image flow (resizing,
            size limit and error messages), placed at the viewport centre. */}
        <DropdownMenuGroup>
          <DropdownMenuItem
            disabled={!excalidrawApi}
            onClick={() =>
              excalidrawApi?.setActiveTool({
                type: "image",
                insertOnCanvasDirectly: true,
              })
            }
          >
            <ImagePlus className="size-4" />
            导入图片
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        {/* Group 4 — Edit operations */}
        <DropdownMenuGroup>
          <DropdownMenuItem
            onClick={() => dispatchKeyToExcalidraw("z", { metaKey: true })}
          >
            <Undo2 className="size-4" />
            撤销
            <DropdownMenuShortcut>{keys.undo}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              dispatchKeyToExcalidraw("z", { metaKey: true, shiftKey: true })
            }
          >
            <Redo2 className="size-4" />
            重做
            <DropdownMenuShortcut>{keys.redo}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!hasSelection}
            onClick={() => dispatchKeyToExcalidraw("d", { metaKey: true })}
          >
            <Copy className="size-4" />
            复制选中内容
            <DropdownMenuShortcut>{keys.duplicate}</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        {/* Group 5 — View controls */}
        <DropdownMenuGroup>
          <DropdownMenuItem
            disabled={!excalidrawApi}
            onClick={() =>
              excalidrawApi?.scrollToContent(undefined, {
                fitToContent: true,
                animate: true,
              })
            }
          >
            <Maximize2 className="size-4" />
            显示全部内容
            <DropdownMenuShortcut>{keys.fit}</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

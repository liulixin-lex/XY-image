"use client";

import { useCallback, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Link2,
  Loader2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/toast";
import { ApiApplicationError, importSkillFromUrl } from "@/lib/server-api";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ImportPanelProps {
  accessToken: () => string | undefined;
  onImported: () => Promise<void>;
  /** Optional: switch to installed tab after successful import */
  onSwitchToInstalled?: () => void;
}

// ---------------------------------------------------------------------------
// Import states
// ---------------------------------------------------------------------------

type ImportState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; skillName: string }
  | { status: "error"; message: string };

// ---------------------------------------------------------------------------
// ImportPanel
// ---------------------------------------------------------------------------

export function ImportPanel({
  accessToken,
  onImported,
  onSwitchToInstalled,
}: ImportPanelProps) {
  const { success, error: showError } = useToast();

  const [url, setUrl] = useState("");
  const [importState, setImportState] = useState<ImportState>({
    status: "idle",
  });

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleImport = useCallback(async () => {
    const token = accessToken();
    if (!token) return;

    const trimmed = url.trim();
    if (!trimmed) return;

    // Basic URL validation
    try {
      new URL(trimmed);
    } catch {
      setImportState({ status: "error", message: "请输入有效的 URL" });
      return;
    }

    setImportState({ status: "loading" });

    try {
      const result = await importSkillFromUrl(token, trimmed);
      setImportState({ status: "success", skillName: result.skill.name });
      success(`技能 "${result.skill.name}" 导入成功`);
      await onImported();
    } catch (err) {
      const msg =
        err instanceof ApiApplicationError
          ? err.message
          : "导入失败，请检查 URL 后重试";
      setImportState({ status: "error", message: msg });
      showError(msg);
      console.error("[import] skill import failed:", err);
    }
  }, [accessToken, url, onImported, success, showError]);

  const handleReset = useCallback(() => {
    setUrl("");
    setImportState({ status: "idle" });
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && url.trim()) {
        handleImport();
      }
    },
    [handleImport, url],
  );

  const isLoading = importState.status === "loading";
  const isSuccess = importState.status === "success";
  const isError = importState.status === "error";

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="max-w-lg">
      {/* Import card */}
      <div className="animate-enter glass rounded-[18px] p-5 sm:p-6">
        {/* Header */}
        <div className="mb-5 flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-acc-soft text-acc-text">
            <Link2 aria-hidden className="size-[18px]" />
          </div>
          <div>
            <h3 className="font-display text-[19px] leading-tight text-fg">
              从网址导入技能
            </h3>
            <p className="mt-1 text-[13px] text-fg-soft">
              支持 GitHub 仓库 URL 和 npm tarball URL
            </p>
          </div>
        </div>

        {/* Input row */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <ExternalLink aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-fg-muted" />
            <input
              type="url"
              placeholder="https://github.com/user/repo/tree/main/skills/my-skill"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                // Clear error state when user starts typing
                if (isError) {
                  setImportState({ status: "idle" });
                }
              }}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
              aria-label="技能 URL"
              className={cn(
                "h-10 w-full rounded-[10px] bg-tint/[0.06] pr-3 pl-8.5 text-sm text-fg caret-acc outline-none transition-shadow placeholder:text-fg-muted disabled:opacity-50",
                isError
                  ? "shadow-[inset_0_0_0_1px_var(--alert)]"
                  : "focus:shadow-[inset_0_0_0_1px_var(--acc)]",
              )}
            />
          </div>
          <Button
            variant="accent"
            className="h-10"
            disabled={!url.trim() || isLoading}
            onClick={handleImport}
          >
            {isLoading ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                正在导入
              </>
            ) : (
              <>
                导入
                <ArrowRight className="size-3.5" />
              </>
            )}
          </Button>
        </div>

        {/* Error message */}
        {isError && (
          <p className="mt-2 text-xs text-alert animate-in fade-in-0 slide-in-from-top-1 duration-200 motion-reduce:animate-none">
            {importState.message}
          </p>
        )}

        {/* Success state */}
        {isSuccess && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-[12px] bg-ok-wash px-4 py-3 animate-in fade-in-0 slide-in-from-top-1 duration-200 motion-reduce:animate-none">
            <div className="flex items-center gap-2">
              <CheckCircle2 aria-hidden className="size-4 text-ok" />
              <span className="text-sm font-medium text-fg">
                {importState.skillName}
              </span>
              <span className="text-xs text-fg-soft">已导入</span>
            </div>
            <div className="flex items-center gap-2">
              {onSwitchToInstalled && (
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={onSwitchToInstalled}
                >
                  查看已安装
                </Button>
              )}
              <Button variant="ghost" size="xs" onClick={handleReset}>
                继续导入
              </Button>
            </div>
          </div>
        )}

        {/* Hint examples */}
        <div className="mt-4 space-y-1.5">
          <p className="text-[11px] font-medium text-fg-muted">
            支持的格式
          </p>
          <div className="space-y-1">
            <p className="font-mono text-[11px] text-fg-muted">
              https://github.com/user/repo/tree/main/skills/my-skill
            </p>
            <p className="font-mono text-[11px] text-fg-muted">
              https://registry.npmjs.org/package/-/package-1.0.0.tgz
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

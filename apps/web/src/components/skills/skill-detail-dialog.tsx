"use client";

import { useCallback, useState } from "react";
import {
  BadgeCheck,
  Calendar,
  ChevronRight,
  Pen,
  ShieldCheck,
  Trash2,
  UserPen,
} from "lucide-react";

import type { SkillDetail, SkillFileEntry, SkillSource } from "@loomic/shared";

import { findTemplate } from "@/lib/templates";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ---------------------------------------------------------------------------
// Source badge config (mirrors skill-card)
// ---------------------------------------------------------------------------

const SOURCE_CONFIG: Record<
  SkillSource,
  { label: string; icon: typeof ShieldCheck }
> = {
  system: { label: "官方", icon: ShieldCheck },
  // Only the curated 市场 skills are community rows; imports are "user".
  community: { label: "精选", icon: BadgeCheck },
  user: { label: "自定义", icon: UserPen },
};

// ---------------------------------------------------------------------------
// FileTreeItem — expandable file row within the detail dialog
// ---------------------------------------------------------------------------

function FileTreeItem({ file }: { file: SkillFileEntry }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-mono text-fg hover:bg-tint/[0.05] transition-colors"
      >
        <ChevronRight
          className={cn(
            "size-3 shrink-0 transition-transform duration-150",
            expanded && "rotate-90",
          )}
        />
        <span className="truncate">{file.filePath}</span>
      </button>
      {expanded && (
        <pre className="px-3 pb-2 font-mono text-[11px] leading-relaxed text-fg-muted whitespace-pre-wrap break-words max-h-48 overflow-auto border-t border-line bg-tint/[0.04]">
          {file.content}
        </pre>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SkillDetailDialog
// ---------------------------------------------------------------------------

interface SkillDetailDialogProps {
  skill: SkillDetail | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInstall: (skillId: string) => Promise<void>;
  onUninstall: (skillId: string) => Promise<void>;
  onDelete?: (skillId: string) => Promise<void>;
  /** 相关模板 (第 58 条): open a 生图模板 the skill lists in metadata.templates. */
  onOpenTemplate?: (templateId: string) => void;
}

/** metadata.examples / metadata.templates as strings, whatever the row holds. */
function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "") : [];
}

/** metadata.sources: {name, url} with an http(s) url only. */
function sourceList(value: unknown): Array<{ name: string; url: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const { name, url } = item as { name?: unknown; url?: unknown };
    return typeof name === "string" && typeof url === "string" && /^https?:\/\//.test(url) ? [{ name, url }] : [];
  });
}

export function SkillDetailDialog({
  skill,
  open,
  onOpenChange,
  onInstall,
  onUninstall,
  onDelete,
  onOpenTemplate,
}: SkillDetailDialogProps) {
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleAction = useCallback(
    async (action: () => Promise<void>, label: string) => {
      setActionLoading(label);
      try {
        await action();
      } finally {
        setActionLoading(null);
      }
    },
    [],
  );

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) setConfirmDelete(false);
      onOpenChange(next);
    },
    [onOpenChange],
  );

  if (!skill) return null;

  // SOURCE_CONFIG exhaustively covers all SkillSource values ("system" | "community" | "user")
  // Non-null assertion is safe: every possible SkillSource key is present in SOURCE_CONFIG.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const sourceEntry =
    (SOURCE_CONFIG[skill.source as keyof typeof SOURCE_CONFIG] ?? SOURCE_CONFIG.system)!;
  const { label: sourceLabel, icon: SourceIcon } = sourceEntry;
  const isUserSkill = skill.source === "user";
  const isInstalled = skill.installed ?? false;

  const createdDate = new Date(skill.createdAt).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const updatedDate = new Date(skill.updatedAt).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {skill.name}
            <span className="inline-flex items-center gap-1 rounded-full bg-tint/[0.06] px-2 py-0.5 text-[11px] font-medium text-fg-muted">
              <SourceIcon className="size-3" />
              {sourceLabel}
            </span>
          </DialogTitle>
          <DialogDescription>{skill.description}</DialogDescription>
        </DialogHeader>

        {/* Meta grid */}
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="space-y-0.5">
            <span className="text-fg-muted">作者</span>
            <p className="font-medium text-fg">{skill.author}</p>
          </div>
          <div className="space-y-0.5">
            <span className="text-fg-muted">版本</span>
            <p className="font-medium text-fg">v{skill.version}</p>
          </div>
          {skill.license && (
            <div className="space-y-0.5">
              <span className="text-fg-muted">许可证</span>
              <p className="font-medium text-fg">{skill.license}</p>
            </div>
          )}
          <div className="space-y-0.5">
            <span className="text-fg-muted flex items-center gap-1">
              <Calendar className="size-3" />
              更新日期
            </span>
            <p className="font-medium text-fg">{updatedDate}</p>
          </div>
        </div>

        {/* 第 58 条: what to say, and the 生图模板 that do the same job in the studio. */}
        {(() => {
          const examples = stringList(skill.metadata?.examples);
          const templates = stringList(skill.metadata?.templates)
            .map((id) => findTemplate(id))
            .filter((t): t is NonNullable<typeof t> => t !== null);
          const sources = sourceList(skill.metadata?.sources);
          if (!examples.length && !templates.length && !sources.length) return null;
          return (
            <div className="space-y-3 rounded-[12px] bg-tint/[0.04] p-3.5">
              {examples.length ? (
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-fg-muted">在画布里对设计助手这样说</span>
                  <ul className="space-y-1">
                    {examples.map((example) => (
                      <li key={example} className="text-[13px] leading-relaxed text-fg">
                        「{example}」
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {templates.length && onOpenTemplate ? (
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-fg-muted">在生图页直接用的模板</span>
                  <div className="flex flex-wrap gap-1.5">
                    {templates.map((template) => (
                      <button
                        key={template.id}
                        type="button"
                        onClick={() => onOpenTemplate(template.id)}
                        className="rounded-[8px] bg-panel px-2.5 py-1 text-[12.5px] font-semibold text-fg shadow-[inset_0_0_0_1px_var(--line)] transition-colors hover:text-acc-text focus-visible:outline-2 focus-visible:outline-acc"
                      >
                        {template.name}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {/* 第 64 条: where the advice in the skill comes from. */}
              {sources.length ? (
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-fg-muted">参考来源</span>
                  <ul className="space-y-1">
                    {sources.map((source) => (
                      <li key={source.url} className="text-[12.5px] leading-relaxed">
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-fg-soft underline decoration-line-strong underline-offset-4 transition-colors hover:text-fg hover:decoration-acc"
                        >
                          {source.name}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          );
        })()}

        {/* SKILL.md content */}
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-fg-muted">
            SKILL.md
          </span>
          <pre className="max-h-64 overflow-auto rounded-[12px] bg-tint/[0.05] p-3 font-mono text-xs leading-relaxed text-fg whitespace-pre-wrap break-words">
            {skill.skillContent}
          </pre>
        </div>

        {/* Attached files tree */}
        {skill.files && skill.files.length > 0 && (
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-fg-muted">
              附属文件 ({skill.files.length})
            </span>
            <div className="rounded-[12px] border border-line divide-y divide-line overflow-hidden">
              {skill.files.map((file: SkillFileEntry) => (
                <FileTreeItem key={file.id} file={file} />
              ))}
            </div>
          </div>
        )}

        {/* Footer actions */}
        <DialogFooter>
          {/* Delete (user skills only) */}
          {isUserSkill && onDelete && (
            <>
              {confirmDelete ? (
                <div className="mr-auto flex items-center gap-2 animate-in fade-in-0 zoom-in-95 duration-200 motion-reduce:animate-none">
                  <span className="text-xs text-destructive">确认删除?</span>
                  <Button
                    variant="destructive"
                    size="xs"
                    disabled={actionLoading === "delete"}
                    onClick={() =>
                      handleAction(
                        () => onDelete(skill.id),
                        "delete",
                      )
                    }
                  >
                    {actionLoading === "delete" ? "删除中..." : "确认"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => setConfirmDelete(false)}
                  >
                    取消
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mr-auto text-destructive hover:text-destructive"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 className="size-3.5" />
                  删除
                </Button>
              )}
            </>
          )}

          {/* Edit (user skills only — placeholder) */}
          {isUserSkill && (
            <Button variant="outline" size="sm" disabled>
              <Pen className="size-3.5" />
              编辑
            </Button>
          )}

          {/* Install / Uninstall */}
          {isInstalled ? (
            <Button
              variant="outline"
              size="sm"
              disabled={actionLoading === "uninstall"}
              onClick={() =>
                handleAction(
                  () => onUninstall(skill.id),
                  "uninstall",
                )
              }
            >
              {actionLoading === "uninstall" ? "卸载中..." : "卸载"}
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={actionLoading === "install"}
              onClick={() =>
                handleAction(
                  () => onInstall(skill.id),
                  "install",
                )
              }
            >
              {actionLoading === "install" ? "安装中..." : "安装"}
            </Button>
          )}
        </DialogFooter>

        {/* Created date small note */}
        <p className="text-center text-[11px] text-fg-muted">
          创建于 {createdDate}
        </p>
      </DialogContent>
    </Dialog>
  );
}

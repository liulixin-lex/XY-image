"use client";

import type { ProjectSummary } from "@loomic/shared";
import { PlusIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { cn, formatDate } from "@/lib/utils";

/**
 * One canvas project: its latest render in a soft frame that lifts off the
 * wall on hover. Projects without a render show an empty dotted board.
 */
export function ProjectCard({
  project,
  highlighted = false,
  onDelete,
}: {
  project: ProjectSummary;
  highlighted?: boolean;
  onDelete: (projectId: string) => void;
}) {
  const [broken, setBroken] = useState(false);
  const thumb = project.thumbnailUrl && !broken ? project.thumbnailUrl : null;

  return (
    <div className="group relative">
      <Link
        href={`/canvas?id=${project.primaryCanvas.id}`}
        className={cn(
          "block rounded-[14px] outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-acc",
          highlighted && "outline-2 outline-offset-4 outline-alert",
        )}
      >
        <div className="relative aspect-[16/10] overflow-hidden rounded-[16px] bg-panel shadow-[0_14px_30px_-20px_var(--shadow-2)] transition-[box-shadow,translate] duration-300 group-hover:-translate-y-1 group-hover:shadow-[0_26px_44px_-22px_var(--shadow-2)]">
          {thumb ? (
            <img
              src={thumb}
              alt=""
              loading="lazy"
              onError={() => setBroken(true)}
              className="size-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.02]"
            />
          ) : (
            <span className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(rgb(var(--tint)/0.12)_1px,transparent_1px)] text-[12.5px] text-fg-muted [background-size:18px_18px]">
              空白画布
            </span>
          )}
        </div>
        <p className="mt-3 truncate text-[14px] font-medium text-fg">{project.name}</p>
        <p className="mt-0.5 text-[12px] text-fg-muted tabular">更新于 {formatDate(project.updatedAt)}</p>
      </Link>
      <button
        type="button"
        onClick={() => onDelete(project.id)}
        aria-label={`删除项目 ${project.name}`}
        className="glass-float absolute top-2.5 right-2.5 flex size-8 items-center justify-center rounded-[10px] text-fg-soft opacity-0 transition-[opacity,color] group-hover:opacity-100 hover:text-alert focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
      >
        <Trash2Icon className="size-4" strokeWidth={1.75} />
      </button>
    </div>
  );
}

export function NewProjectCard({
  onClick,
  disabled,
  label = "新建画布",
}: {
  onClick: () => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group block w-full text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-acc disabled:cursor-wait"
    >
      <span className="flex aspect-[16/10] items-center justify-center rounded-[16px] border border-dashed border-line-strong bg-tint/[0.02] transition-colors group-hover:border-acc/50 group-hover:bg-acc-soft">
        <span className="sk flex h-11 w-12 items-center justify-center rounded-[12px] bg-acc text-acc-ink shadow-acc transition-[scale] group-hover:scale-105">
          <PlusIcon className="sk-in size-5" strokeWidth={2.2} />
        </span>
      </span>
      <span className="mt-3 block text-[14px] font-medium text-fg">{label}</span>
      <span className="mt-0.5 block text-[12px] text-fg-muted">空白开始，随时叫助手</span>
    </button>
  );
}

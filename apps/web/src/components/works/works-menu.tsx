"use client";

/**
 * 作品 ▾ in the top bar (第 56 条): a two-level menu. Hover or click opens a
 * panel with the two places made things live — 最近生成 (the latest
 * pictures) and 画布项目 (the latest canvases) — each a way in to its full
 * page. The previews load the first time the panel opens, once.
 */
import { NavigationMenu } from "@base-ui/react/navigation-menu";
import type { ProjectSummary } from "@loomic/shared";
import { ArrowRightIcon, ChevronDownIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useRef, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { type ImageJobView, jobLabel, listImage, toImageJobView } from "@/lib/image-jobs";
import { fetchJobs, fetchProjects } from "@/lib/server-api";
import { cn } from "@/lib/utils";

import { WORKS_SECTIONS } from "./works-nav";

type Previews = { prints: ImageJobView[]; projects: ProjectSummary[] } | null;

export function useWorksPreviews() {
  const { session } = useAuth();
  const token = session?.access_token ?? null;
  const [previews, setPreviews] = useState<Previews>(null);
  const requested = useRef<string | null>(null);
  const load = useCallback(() => {
    if (!token || requested.current === session?.user.id) return;
    requested.current = session?.user.id ?? null;
    Promise.all([
      fetchJobs(token, { jobType: "image_generation", status: "succeeded", limit: 8 })
        .then(({ jobs }) => jobs.map(toImageJobView).filter((job) => job.url).slice(0, 4))
        .catch(() => []),
      fetchProjects(token)
        .then(({ projects }) => projects.slice(0, 3))
        .catch(() => []),
    ]).then(([prints, projects]) => setPreviews({ prints, projects }));
  }, [token, session?.user.id]);
  return { previews, load };
}

/** The 作品 trigger and its panel, as one item of the top bar's menu. */
export function WorksMenuItem({ active }: { active: boolean }) {
  const { previews, load } = useWorksPreviews();
  const [history, projects] = WORKS_SECTIONS as [
    (typeof WORKS_SECTIONS)[number],
    (typeof WORKS_SECTIONS)[number],
  ];
  return (
    <NavigationMenu.Item value="works">
      <NavigationMenu.Trigger
        onPointerEnter={load}
        onFocus={load}
        onClick={load}
        className={cn(
          "sk inline-flex h-[34px] items-center rounded-[10px] px-3 text-[13.5px] font-semibold whitespace-nowrap transition-[background-color,color,translate] outline-none active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc lg:px-3.5",
          active
            ? "bg-fg text-ground"
            : "text-fg-soft hover:bg-tint/[0.06] hover:text-fg data-popup-open:bg-tint/[0.08] data-popup-open:text-fg",
        )}
      >
        <span className="sk-in gap-1">
          作品
          <NavigationMenu.Icon className="transition-transform duration-200 data-popup-open:rotate-180">
            <ChevronDownIcon className="size-3.5" strokeWidth={2.2} />
          </NavigationMenu.Icon>
        </span>
      </NavigationMenu.Trigger>
      <NavigationMenu.Content className="grid w-[min(620px,calc(100vw-32px))] grid-cols-2 gap-2 p-2 transition-[opacity,translate] duration-200 data-[ending-style]:opacity-0 data-[starting-style]:-translate-y-1 data-[starting-style]:opacity-0">
        <SectionCard section={history} sub="生图、画布、设计助手出的图">
          {previews === null ? (
            <PreviewSkeleton count={4} />
          ) : previews.prints.length ? (
            <div className="grid grid-cols-4 gap-1.5">
              {previews.prints.map((job) => (
                // biome-ignore lint/performance/noImgElement: public storage URL
                <img
                  key={job.id}
                  src={listImage(job) ?? ""}
                  alt={jobLabel(job)}
                  loading="lazy"
                  className="aspect-square w-full rounded-[8px] object-cover"
                />
              ))}
            </div>
          ) : (
            <p className="text-[12.5px] text-fg-muted">还没有出过图。</p>
          )}
        </SectionCard>
        <SectionCard section={projects} sub="每张画布，最近打开的在前">
          {previews === null ? (
            <PreviewSkeleton count={3} rows />
          ) : previews.projects.length ? (
            <ul className="flex flex-col gap-1">
              {previews.projects.map((project) => (
                <li key={project.id} className="truncate text-[12.5px] text-fg-soft">
                  {project.name || "未命名项目"}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-fg-muted">还没有画布。</p>
          )}
        </SectionCard>
      </NavigationMenu.Content>
    </NavigationMenu.Item>
  );
}

function SectionCard({
  section,
  sub,
  children,
}: {
  section: (typeof WORKS_SECTIONS)[number];
  sub: string;
  children: React.ReactNode;
}) {
  const Icon = section.icon;
  return (
    <NavigationMenu.Link
      render={<Link href={section.href} />}
      closeOnClick
      className="group/card flex flex-col gap-3 rounded-[14px] p-3.5 outline-none transition-colors hover:bg-tint/[0.055] focus-visible:bg-tint/[0.055] focus-visible:outline-2 focus-visible:outline-acc"
    >
      <span className="flex items-start gap-2.5">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-acc-soft text-acc-text">
          <Icon className="size-4" strokeWidth={1.9} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1 text-[14px] font-semibold text-fg">
            {section.label}
            <ArrowRightIcon className="size-3.5 -translate-x-1 opacity-0 transition-[opacity,translate] duration-200 group-hover/card:translate-x-0 group-hover/card:opacity-100" strokeWidth={2.2} />
          </span>
          <span className="mt-0.5 block text-[12px] text-fg-muted">{sub}</span>
        </span>
      </span>
      {children}
    </NavigationMenu.Link>
  );
}

function PreviewSkeleton({ count, rows = false }: { count: number; rows?: boolean }) {
  return rows ? (
    <div className="flex flex-col gap-1.5" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="h-3 rounded-full bg-tint/[0.06]" style={{ width: `${80 - i * 15}%` }} />
      ))}
    </div>
  ) : (
    <div className="grid grid-cols-4 gap-1.5" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="aspect-square animate-breathe rounded-[8px]" />
      ))}
    </div>
  );
}

/** The panel's floating parts; rendered once, after the menu's list. */
export function WorksMenuPortal() {
  return (
    <NavigationMenu.Portal>
      <NavigationMenu.Positioner
        sideOffset={10}
        collisionPadding={16}
        className="z-[60] h-(--positioner-height) w-(--positioner-width) max-w-(--available-width) transition-[top,left,right,bottom] duration-200"
      >
        <NavigationMenu.Popup className="glass-float relative h-(--popup-height) w-(--popup-width) origin-(--transform-origin) overflow-hidden rounded-[20px] transition-[opacity,scale,width,height] duration-200 data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0">
          <NavigationMenu.Viewport className="relative size-full overflow-hidden" />
        </NavigationMenu.Popup>
      </NavigationMenu.Positioner>
    </NavigationMenu.Portal>
  );
}

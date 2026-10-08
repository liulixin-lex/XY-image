"use client";

/**
 * Workspace home: hand a brief to the design agent (creates a canvas
 * project), check what generation bills against, and pick up recent work.
 */
import type { ImageGenerationPreference, ProjectSummary } from "@loomic/shared";
import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { DeleteProjectDialog } from "@/components/delete-project-dialog";
import { ReadinessPanel } from "@/components/home/readiness-panel";
import { RecentPrints } from "@/components/home/recent-prints";
import { HomePrompt, type HomePromptHandle } from "@/components/home-prompt";
import { LoadingScreen } from "@/components/loading-screen";
import { NewProjectCard, ProjectCard } from "@/components/projects/project-card";
import { useToast } from "@/components/toast";
import { useCreateProject } from "@/hooks/use-create-project";
import { useDeleteProject } from "@/hooks/use-delete-project";
import { type ReadyAttachment, useImageAttachments } from "@/hooks/use-image-attachments";
import { useAuth } from "@/lib/auth-context";
import { ApiAuthError, fetchProjects } from "@/lib/server-api";
import { STARTER_PROMPTS } from "@/lib/starter-prompts";

const RECENT_PROJECTS_LIMIT = 7;

export default function HomePage() {
  const { session } = useAuth();
  const token = session?.access_token ?? "";
  const { error: toastError } = useToast();
  const { create: createNewProject, creating } = useCreateProject();
  const promptRef = useRef<HomePromptHandle>(null);

  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [projectsFailed, setProjectsFailed] = useState(false);

  const handleDeleted = useCallback((id: string) => {
    setProjects((prev) => prev?.filter((p) => p.id !== id) ?? prev);
  }, []);
  const { pendingId, deleting, requestDelete, confirmDelete, cancelDelete } =
    useDeleteProject({ onDeleted: handleDeleted });

  const {
    attachments,
    addFiles,
    removeAttachment,
    retryUpload,
    clearAll: clearAttachments,
    isUploading,
    readyAttachments,
  } = useImageAttachments(token, undefined, { onReject: toastError });

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetchProjects(token)
      .then((data) => {
        if (!cancelled) setProjects(data.projects.slice(0, RECENT_PROJECTS_LIMIT));
      })
      .catch((error) => {
        // 401 is handled by the auth-expiry listener.
        if (error instanceof ApiAuthError) return;
        console.warn("[home] recent projects unavailable", error);
        if (!cancelled) {
          setProjectsFailed(true);
          setProjects([]);
        }
      });
    return () => {
      cancelled = true;
    };
    // Load once per sign-in; token refreshes must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id]);

  const handleSubmit = useCallback(
    (
      prompt: string,
      submitted?: ReadyAttachment[],
      imageGenerationPreference?: ImageGenerationPreference,
      model?: string,
    ) => {
      clearAttachments();
      void createNewProject({
        prompt,
        ...(submitted?.length ? { attachments: submitted } : {}),
        ...(imageGenerationPreference ? { imageGenerationPreference } : {}),
        ...(model ? { model } : {}),
      });
    },
    [clearAttachments, createNewProject],
  );

  if (creating) return <LoadingScreen label="正在准备画布" />;

  return (
    <div className="mx-auto max-w-[1600px] px-4 pt-4 pb-20 sm:px-8 md:pt-8 lg:px-12">
      <section className="grid gap-x-[clamp(40px,5vw,88px)] gap-y-8 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,860px)_340px] xl:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-[clamp(40px,4.5vw,66px)] leading-[1.05] font-normal text-fg">
            想做什么，交给
            <span className="text-[color-mix(in_oklab,rgb(var(--amb))_42%,white)] transition-colors duration-700">
              设计助手
            </span>
          </h1>
          <p className="mt-4 max-w-[56ch] text-[16px] leading-relaxed text-fg-soft">
            它会新开一张画布，拆解需求、生成图片、排好版。只要一张图？
            <Link href="/studio" className="text-fg underline decoration-line-strong underline-offset-4 hover:decoration-fg">
              去生图
            </Link>
            更快。
          </p>

          <div className="mt-7">
            <HomePrompt
              ref={promptRef}
              onSubmit={handleSubmit}
              disabled={creating}
              attachments={attachments}
              onAddFiles={addFiles}
              onRemoveAttachment={removeAttachment}
              onRetryAttachment={retryUpload}
              isUploading={isUploading}
              readyAttachments={readyAttachments}
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="mr-1 text-[13px] text-fg-muted">试试</span>
            {STARTER_PROMPTS.map((starter) => (
              <button
                key={starter.label}
                type="button"
                onClick={() => promptRef.current?.fill(starter.prompt)}
                className="h-8 rounded-full border border-line bg-white/[0.05] px-3.5 text-[13px] text-fg-soft transition-colors hover:border-line-strong hover:bg-white/[0.09] hover:text-fg"
              >
                {starter.label}
              </button>
            ))}
          </div>
        </div>

        <ReadinessPanel className="self-start lg:mt-[92px]" />
      </section>

      <div className="mt-16">
        <RecentPrints />
      </div>

      <section aria-labelledby="recent-projects" className="mt-16">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 id="recent-projects" className="text-[18px] font-semibold text-fg">
            最近的画布
          </h2>
          <Link
            href="/projects"
            className="inline-flex items-center gap-1 text-[13px] text-fg-soft hover:text-fg"
          >
            全部项目
            <ArrowRightIcon className="size-3.5" strokeWidth={1.75} />
          </Link>
        </div>
        {projectsFailed ? (
          <p className="mb-5 text-[13px] text-fg-soft">项目列表暂时读不到，刷新页面重试。</p>
        ) : null}
        <div className="grid grid-cols-2 gap-x-5 gap-y-7 sm:grid-cols-3 lg:grid-cols-4">
          <NewProjectCard onClick={() => void createNewProject()} disabled={creating} />
          {projects === null
            ? Array.from({ length: 3 }, (_, i) => (
                <div key={i} aria-hidden>
                  <div className="aspect-[16/10] animate-breathe rounded-frame" />
                  <div className="mt-2.5 h-3.5 w-2/3 rounded-full bg-white/[0.05]" />
                  <div className="mt-1.5 h-3 w-1/3 rounded-full bg-white/[0.05]" />
                </div>
              ))
            : projects.map((project) => (
                <ProjectCard key={project.id} project={project} onDelete={requestDelete} />
              ))}
        </div>
      </section>

      <DeleteProjectDialog
        open={pendingId !== null}
        deleting={deleting}
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
      />
    </div>
  );
}

"use client";

/**
 * All canvas projects. Each project is one infinite canvas the design agent
 * works on; single images live in the studio instead.
 */
import type { ProjectSummary } from "@loomic/shared";
import { SearchIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DeleteProjectDialog } from "@/components/delete-project-dialog";
import { LoadingScreen } from "@/components/loading-screen";
import { PageHeader } from "@/components/page-header";
import { NewProjectCard, ProjectCard } from "@/components/projects/project-card";
import { Button } from "@/components/ui/button";
import { useCreateProject } from "@/hooks/use-create-project";
import { useDeleteProject } from "@/hooks/use-delete-project";
import { useAuth } from "@/lib/auth-context";
import { ApiAuthError, fetchProjects } from "@/lib/server-api";

/** Show the filter only when there is something to filter. */
const SEARCH_THRESHOLD = 8;

export default function ProjectsPage() {
  const { session } = useAuth();
  const { create: createNewProject, creating } = useCreateProject();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [query, setQuery] = useState("");

  const tokenRef = useRef(session?.access_token);
  tokenRef.current = session?.access_token;

  const load = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) return;
    setLoadFailed(false);
    try {
      const data = await fetchProjects(token);
      setProjects(data.projects);
    } catch (error) {
      // 401 is handled by the auth-expiry listener (signs out, redirects).
      if (error instanceof ApiAuthError) return;
      console.warn("[projects] load failed", error);
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
    // Load once per sign-in; token refreshes must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id]);

  const handleDeleted = useCallback((projectId: string) => {
    setProjects((prev) => prev?.filter((p) => p.id !== projectId) ?? prev);
  }, []);
  const { pendingId, deleting, requestDelete, confirmDelete, cancelDelete } =
    useDeleteProject({ onDeleted: handleDeleted });

  const visible = useMemo(() => {
    if (!projects) return null;
    const q = query.trim().toLowerCase();
    return q ? projects.filter((p) => p.name.toLowerCase().includes(q)) : projects;
  }, [projects, query]);

  if (creating) return <LoadingScreen label="正在准备画布" />;

  return (
    <div className="pb-20">
      <PageHeader
        title="画布项目"
        description="每个项目是一张无限画布，设计助手在上面出图、排版、改稿。"
        aside={
          projects && projects.length > 0 ? (
            <span className="data-label text-fg-muted tabular">{projects.length} 个</span>
          ) : null
        }
      />
      <div className="mx-auto max-w-[1600px] px-4 sm:px-8 lg:px-12">
        {projects && projects.length > SEARCH_THRESHOLD ? (
          <label className="mb-7 flex h-10 max-w-sm items-center gap-2 rounded-md glass px-3 focus-within:border-tint/25">
            <SearchIcon className="size-4 shrink-0 text-fg-muted" strokeWidth={1.75} />
            <span className="sr-only">按名称筛选</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="按名称筛选"
              className="h-full min-w-0 flex-1 bg-transparent text-[13.5px] text-fg outline-none placeholder:text-fg-muted"
            />
          </label>
        ) : null}

        {loadFailed ? (
          <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-line-strong px-6 py-8">
            <p className="text-[14px] text-fg">项目列表没有加载出来。</p>
            <p className="text-[13px] text-fg-soft">可能是网络波动或服务暂时不可用。</p>
            <Button variant="outline" onClick={() => void load()}>
              重试
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            <NewProjectCard onClick={() => void createNewProject()} disabled={creating} />
            {visible === null
              ? Array.from({ length: 4 }, (_, i) => (
                  <div key={i} aria-hidden>
                    <div className="aspect-[16/10] animate-breathe rounded-frame" />
                    <div className="mt-2.5 h-3.5 w-2/3 rounded-sm bg-tint/[0.05]" />
                    <div className="mt-1.5 h-3 w-1/3 rounded-sm bg-tint/[0.05]" />
                  </div>
                ))
              : visible.map((project) => (
                  <ProjectCard key={project.id} project={project} onDelete={requestDelete} />
                ))}
          </div>
        )}

        {visible && projects && projects.length > 0 && visible.length === 0 ? (
          <p className="mt-6 text-[13px] text-fg-soft">没有名称包含「{query.trim()}」的项目。</p>
        ) : null}
        {projects && projects.length === 0 && !loadFailed ? (
          <p className="mt-8 max-w-[52ch] text-[13.5px] leading-relaxed text-fg-soft">
            还没有项目。新建一张空白画布，或回到首页把需求直接交给设计助手，它会自动建好画布。
          </p>
        ) : null}
      </div>

      <DeleteProjectDialog
        open={pendingId !== null}
        deleting={deleting}
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
      />
    </div>
  );
}

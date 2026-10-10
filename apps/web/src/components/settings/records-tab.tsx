"use client";

/**
 * Generation records as a ledger: one row per request with its billing
 * state and the request ID to look up on the main-site usage page. The
 * main site's usage page stays the source of truth for amounts.
 */
import { ArrowUpRightIcon, CopyIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAccount, useImageModels } from "@/lib/account-context";
import { useAuth } from "@/lib/auth-context";
import { describeIssue } from "@/lib/generation-errors";
import { type ImageJobView, isActiveJob, isFailedJob, isSavingJob, toImageJobView } from "@/lib/image-jobs";
import { describeImageParams, findModelMeta } from "@/lib/image-model-meta";
import { fetchJobs } from "@/lib/server-api";
import { cn } from "@/lib/utils";

import { BillingBadge, needsReconcile } from "../billing/billing-badge";
import { useToast } from "../toast";
import { Button, buttonVariants } from "../ui/button";
import { Segmented } from "../ui/select";

type Filter = "all" | "reconcile" | "failed";

const STATUS: Record<ImageJobView["status"], string> = {
  queued: "排队中",
  running: "生成中",
  succeeded: "成功",
  failed: "失败",
  dead_letter: "失败",
  canceled: "已取消",
};

export function RecordsTab() {
  const { session } = useAuth();
  const { account } = useAccount();
  const models = useImageModels();
  const { success } = useToast();
  const [jobs, setJobs] = useState<ImageJobView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const tokenRef = useRef(session?.access_token);
  tokenRef.current = session?.access_token;
  const usageUrl = account.data?.links.usage;

  const load = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) return;
    setLoading(true);
    try {
      const { jobs: rows } = await fetchJobs(token, { jobType: "image_generation" });
      setJobs(rows.map(toImageJobView));
      setFailed(false);
    } catch (error) {
      console.warn("[settings] records unavailable", error);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const list = jobs ?? [];
    return {
      reconcile: list.filter((j) => needsReconcile(j.billing, isActiveJob(j))).length,
      failed: list.filter(isFailedJob).length,
    };
  }, [jobs]);

  const visible = useMemo(() => {
    const list = jobs ?? [];
    if (filter === "reconcile") return list.filter((j) => needsReconcile(j.billing, isActiveJob(j)));
    if (filter === "failed") return list.filter(isFailedJob);
    return list;
  }, [jobs, filter]);

  const modelName = (id: string | null) =>
    !id
      ? "默认模型"
      : (models.data?.find((m) => m.id === id)?.displayName ?? findModelMeta(id)?.displayName ?? id);

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => success("已复制请求 ID"));
  };

  return (
    <div className="pt-2">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          value={filter}
          onValueChange={(v) => setFilter(v as Filter)}
          ariaLabel="筛选记录"
          options={[
            { value: "all", label: "全部" },
            { value: "reconcile", label: `待核对 ${counts.reconcile || ""}`.trim() },
            { value: "failed", label: `失败 ${counts.failed || ""}`.trim() },
          ]}
        />
        <Button variant="ghost" onClick={() => void load()} disabled={loading}>
          <RefreshCwIcon className={cn(loading && "animate-spin")} strokeWidth={1.75} />
          刷新
        </Button>
        {usageUrl ? (
          <a
            href={usageUrl}
            target="_blank"
            rel="noreferrer"
            className={cn(buttonVariants({ variant: "outline" }), "ml-auto")}
          >
            主站用量明细
            <ArrowUpRightIcon strokeWidth={1.75} />
          </a>
        ) : null}
      </div>
      <p className="mt-3 max-w-[70ch] text-[12.5px] leading-relaxed text-fg-muted">
        显示最近 50 条生图请求。「待核对」表示请求可能已到达主站但结果未知，用请求 ID 在主站用量页查找；金额以主站为准。
      </p>

      <div className="mt-6">
        {failed && !jobs ? (
          <p className="rounded-md bg-tint/[0.05] px-4 py-3 text-[13px] text-fg-soft">
            生成记录暂时读不到，点「刷新」再试一次。
          </p>
        ) : jobs === null ? (
          <div className="space-y-2" aria-label="读取中">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-12 animate-breathe rounded-md" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line-strong px-5 py-6 text-[13.5px] text-fg-soft">
            {filter === "all" ? "还没有生图记录。" : "没有符合条件的记录。"}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg glass">
            <table className="w-full min-w-[760px] text-left text-[13px]">
              <thead className="border-b border-line text-[12px] text-fg-muted">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-normal">时间</th>
                  <th scope="col" className="px-4 py-2.5 font-normal">提示词</th>
                  <th scope="col" className="px-4 py-2.5 font-normal">模型 · 规格</th>
                  <th scope="col" className="px-4 py-2.5 font-normal">状态</th>
                  <th scope="col" className="px-4 py-2.5 font-normal">请求 ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visible.map((job) => {
                  const issue = isFailedJob(job)
                    ? describeIssue(job.errorCode ?? "upstream_unknown", job.errorMessage)
                    : null;
                  return (
                    <tr key={job.id} className="align-top">
                      <td className="px-4 py-3 whitespace-nowrap text-fg-soft tabular">
                        {new Date(job.createdAt).toLocaleString("zh-CN", {
                          hour12: false,
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="max-w-[320px] px-4 py-3">
                        <p className="line-clamp-2 text-fg" title={job.prompt}>
                          {job.prompt || "（无提示词）"}
                        </p>
                        {issue ? (
                          <p className="mt-1 text-[12px] text-alert">{issue.title}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-fg-soft">
                        {modelName(job.model)}
                        <span className="text-fg-muted"> · {describeImageParams(job)}</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-fg">
                        <span className="inline-flex items-center gap-2">
                          {isSavingJob(job) ? "保存中" : STATUS[job.status]}
                          <BillingBadge status={job.billing} active={isActiveJob(job)} />
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {job.requestId ? (
                          <button
                            type="button"
                            onClick={() => copy(job.requestId!)}
                            className="inline-flex max-w-[180px] items-center gap-1.5 font-mono text-[11.5px] text-fg-soft hover:text-fg"
                            title="复制请求 ID"
                          >
                            <span className="truncate">{job.requestId}</span>
                            <CopyIcon className="size-3 shrink-0" />
                          </button>
                        ) : (
                          <span className="text-fg-muted">未产生</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

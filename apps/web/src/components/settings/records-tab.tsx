"use client";

/**
 * Generation records as a ledger: one row per request with its billing
 * state and the request ID to look up on the main-site usage page. The
 * main site's usage page stays the source of truth for amounts.
 *
 * 第 58 条: numbered pages with a choice of rows per page (20 / 50 / 100,
 * remembered), filters and totals from the server (so 待核对 and 失败 count
 * every record, not just the newest 50), a thumbnail per finished picture,
 * and multi-select on the page to delete or download. Deleting only hides a
 * record; its billing row stays on the server, so 待核对 is still settled.
 * Records still queued or running cannot be selected.
 */
import type { JobListCounts, JobListView } from "@loomic/shared";
import {
  ArrowUpRightIcon,
  CopyIcon,
  DownloadIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAccount, useImageModels } from "@/lib/account-context";
import { useAuth } from "@/lib/auth-context";
import { describeIssue } from "@/lib/generation-errors";
import {
  type ImageJobView,
  isActiveJob,
  isFailedJob,
  isSavingJob,
  jobLabel,
  listImage,
  toImageJobView,
} from "@/lib/image-jobs";
import { describeImageParams, findModelMeta } from "@/lib/image-model-meta";
import { fetchJobs } from "@/lib/server-api";
import { cn } from "@/lib/utils";
import { downloadJobs, useDeleteWorks } from "@/lib/works-actions";

import { useSelection } from "@/hooks/use-selection";

import { BillingBadge, needsReconcile } from "../billing/billing-badge";
import { useToast } from "../toast";
import { Button, buttonVariants } from "../ui/button";
import { Pager } from "../ui/pager";
import { Segmented } from "../ui/select";
import { DeleteWorksDialog } from "../works/delete-works-dialog";

type Filter = "all" | JobListView;

const STATUS: Record<ImageJobView["status"], string> = {
  queued: "排队中",
  running: "生成中",
  succeeded: "成功",
  failed: "失败",
  dead_letter: "失败",
  canceled: "已取消",
};

/** Rows per page; the server's page limit is 100 (JOB_PAGE_MAX). */
export const RECORD_PAGE_SIZES = [20, 50, 100] as const;
type PageSize = (typeof RECORD_PAGE_SIZES)[number];
const PAGE_SIZE_KEY = "xy:records-page-size";

function readPageSize(): PageSize {
  try {
    const stored = Number(localStorage.getItem(PAGE_SIZE_KEY));
    return (RECORD_PAGE_SIZES as readonly number[]).includes(stored) ? (stored as PageSize) : 20;
  } catch {
    return 20;
  }
}

export function RecordsTab() {
  const { session } = useAuth();
  const { account } = useAccount();
  const models = useImageModels();
  const { success, error: toastError } = useToast();
  const [jobs, setJobs] = useState<ImageJobView[] | null>(null);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<JobListCounts | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [zipping, setZipping] = useState<string | null>(null);
  const tokenRef = useRef(session?.access_token);
  tokenRef.current = session?.access_token;
  const usageUrl = account.data?.links.usage;
  // A response for an older page or filter is dropped.
  const requestRef = useRef(0);
  const topRef = useRef<HTMLDivElement>(null);

  // The remembered size is read after mount (static export, no storage on
  // the server); nothing loads before it, so the first page is read once.
  const [sizeReady, setSizeReady] = useState(false);
  useEffect(() => {
    setPageSize(readPageSize());
    setSizeReady(true);
  }, []);

  const load = useCallback(async () => {
    const token = tokenRef.current;
    if (!token || !sizeReady) return;
    const request = ++requestRef.current;
    setLoading(true);
    try {
      const result = await fetchJobs(token, {
        jobType: "image_generation",
        limit: pageSize,
        offset: (page - 1) * pageSize,
        withTotal: true,
        ...(filter === "all" ? {} : { view: filter }),
      });
      if (request !== requestRef.current) return;
      setJobs(result.jobs.map(toImageJobView));
      setTotal(result.total ?? result.jobs.length);
      setCounts(result.counts ?? null);
      setFailed(false);
      console.info("[settings] records page", { filter, page, pageSize, total: result.total ?? null });
    } catch (error) {
      if (request !== requestRef.current) return;
      console.warn("[settings] records unavailable", error);
      setFailed(true);
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [filter, page, pageSize, sizeReady]);

  useEffect(() => {
    void load();
  }, [load]);

  const pages = Math.max(1, Math.ceil(total / pageSize));
  // A delete can empty the last page: step back to the new last one.
  useEffect(() => {
    if (jobs && page > pages) setPage(pages);
  }, [jobs, page, pages]);

  const rows = jobs ?? [];
  const selectable = useMemo(() => rows.filter((job) => !isActiveJob(job)).map((job) => job.id), [rows]);
  const selection = useSelection(selectable);
  const { clear, retain } = selection;
  // Selection is per page: a new page, filter or size starts empty.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on navigation only
  useEffect(() => clear(), [filter, page, pageSize]);
  useEffect(() => retain(selectable), [selectable, retain]);
  const selectedJobs = rows.filter((job) => selection.has(job.id));
  const allOnPage = selectable.length > 0 && selectable.every((id) => selection.has(id));
  const someOnPage = selectable.some((id) => selection.has(id));

  const deleteWorks = useDeleteWorks({
    // The page is re-read so totals, counts and the next rows are right.
    onRemoved: () => void load(),
    onRestored: () => void load(),
  });

  const changeFilter = (next: Filter) => {
    setFilter(next);
    setPage(1);
  };
  const changePageSize = (next: PageSize) => {
    // Keep the first row in view: the page that contains it at the new size.
    const firstRow = (page - 1) * pageSize;
    setPageSize(next);
    setPage(Math.floor(firstRow / next) + 1);
    try {
      localStorage.setItem(PAGE_SIZE_KEY, String(next));
    } catch {
      // ignore: the choice just isn't remembered
    }
  };
  const goTo = (next: number) => {
    setPage(Math.min(Math.max(next, 1), pages));
    topRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  };

  const reconcileSelected = selectedJobs.filter((job) => needsReconcile(job.billing, isActiveJob(job))).length;
  const downloadable = selectedJobs.filter((job) => job.status === "succeeded" && job.url);

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      const done = await deleteWorks(selectedJobs.map((job) => job.id));
      if (done.length) clear();
    } finally {
      setDeleting(false);
      setConfirming(false);
    }
  };
  const downloadSelected = async () => {
    setZipping(downloadable.length > 1 ? `打包中 0/${downloadable.length}` : "下载中");
    try {
      const { saved, failed: missing } = await downloadJobs(downloadable, (done, all) =>
        setZipping(`打包中 ${done}/${all}`),
      );
      if (missing) toastError(`${missing} 张没有下载下来${saved ? `，其余 ${saved} 张已打包` : ""}。`);
    } finally {
      setZipping(null);
    }
  };

  const modelName = (id: string | null) =>
    !id
      ? "默认模型"
      : (models.data?.find((m) => m.id === id)?.displayName ?? findModelMeta(id)?.displayName ?? id);

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => success("已复制请求 ID"));
  };

  const firstShown = total ? (page - 1) * pageSize + 1 : 0;
  const lastShown = Math.min(page * pageSize, total);

  return (
    <div className="pt-2" ref={topRef}>
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          value={filter}
          onValueChange={(v) => changeFilter(v as Filter)}
          ariaLabel="筛选记录"
          options={[
            { value: "all", label: `全部 ${counts?.all ?? ""}`.trim() },
            { value: "reconcile", label: `待核对 ${counts?.reconcile || ""}`.trim() },
            { value: "failed", label: `失败 ${counts?.failed || ""}`.trim() },
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
        每次生图请求一行。「待核对」表示请求可能已到达主站但结果未知，用请求 ID 在主站用量页查找。
      </p>

      {/* Selection actions, in the place of the summary line while rows are selected. */}
      <div className="mt-5 flex min-h-10 flex-wrap items-center gap-2">
        {selection.size ? (
          <>
            <span className="mr-1 text-[13.5px] font-semibold text-fg tabular" aria-live="polite">
              {zipping ?? `已选 ${selection.size} 条`}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void downloadSelected()}
              disabled={!downloadable.length || Boolean(zipping)}
              title={downloadable.length ? undefined : "选中的记录里没有成功的图"}
            >
              <DownloadIcon strokeWidth={1.75} />
              下载 {downloadable.length ? `${downloadable.length} 张` : ""}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-alert hover:text-alert"
              onClick={() => {
                if (selection.size === 1) void deleteWorks([...selection.ids]).then((done) => done.length && clear());
                else setConfirming(true);
              }}
            >
              <Trash2Icon strokeWidth={1.75} />
              删除
            </Button>
            <Button variant="ghost" size="sm" onClick={clear}>
              取消选择
            </Button>
          </>
        ) : (
          <span className="text-[12.5px] text-fg-muted tabular">
            {total ? `第 ${firstShown}–${lastShown} 条，共 ${total} 条` : null}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2 text-[12.5px] text-fg-muted">
          每页
          <Segmented
            value={String(pageSize)}
            onValueChange={(v) => changePageSize(Number(v) as PageSize)}
            ariaLabel="每页条数"
            options={RECORD_PAGE_SIZES.map((size) => ({ value: String(size), label: String(size) }))}
          />
          条
        </div>
      </div>

      <div className="mt-3">
        {failed && !jobs ? (
          <p className="rounded-md bg-tint/[0.05] px-4 py-3 text-[13px] text-fg-soft">
            生成记录暂时读不到，点「刷新」再试一次。
          </p>
        ) : jobs === null ? (
          <div className="space-y-2" aria-label="读取中">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-14 animate-breathe rounded-md" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line-strong px-5 py-6 text-[13.5px] text-fg-soft">
            {filter === "all" ? "还没有生图记录。" : "没有符合条件的记录。"}
          </p>
        ) : (
          <div className={cn("overflow-x-auto rounded-lg glass transition-opacity", loading && "opacity-60")}>
            <table className="w-full min-w-[860px] text-left text-[13px]">
              <thead className="border-b border-line text-[12px] text-fg-muted">
                <tr>
                  <th scope="col" className="w-11 py-2.5 pr-1 pl-4">
                    <Check
                      checked={allOnPage}
                      mixed={!allOnPage && someOnPage}
                      disabled={!selectable.length}
                      label={allOnPage ? "取消选择本页" : "选择本页"}
                      onChange={() => selection.toggleGroup(selectable)}
                    />
                  </th>
                  <th scope="col" className="w-14 px-2 py-2.5 font-normal">
                    <span className="sr-only">图</span>
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-normal">时间</th>
                  <th scope="col" className="px-3 py-2.5 font-normal">提示词</th>
                  <th scope="col" className="px-3 py-2.5 font-normal">模型 · 规格</th>
                  <th scope="col" className="px-3 py-2.5 font-normal">状态</th>
                  <th scope="col" className="px-3 py-2.5 font-normal">请求 ID</th>
                  <th scope="col" className="w-12 px-2 py-2.5">
                    <span className="sr-only">操作</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((job) => {
                  const issue = isFailedJob(job)
                    ? describeIssue(job.errorCode ?? "upstream_unknown", job.errorMessage)
                    : null;
                  const active = isActiveJob(job);
                  const selected = selection.has(job.id);
                  const thumb = job.status === "succeeded" ? listImage(job) : null;
                  return (
                    <tr
                      key={job.id}
                      className={cn(
                        "group/row align-middle transition-colors",
                        selected ? "bg-acc/[0.07]" : "hover:bg-tint/[0.035]",
                      )}
                    >
                      <td className="py-2.5 pr-1 pl-4">
                        <Check
                          checked={selected}
                          disabled={active}
                          label={active ? "生成中，完成后才能选择" : `选择：${jobLabel(job) || "这条记录"}`}
                          onChange={(range) => selection.toggle(job.id, { range })}
                        />
                      </td>
                      <td className="px-2 py-2">
                        {thumb ? (
                          // biome-ignore lint/performance/noImgElement: public storage URL
                          <img
                            src={thumb}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            className="size-10 rounded-[7px] object-cover shadow-[0_1px_2px_var(--shadow)]"
                          />
                        ) : (
                          <span aria-hidden className="block size-10 rounded-[7px] bg-tint/[0.05]" />
                        )}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-fg-soft tabular">
                        {new Date(job.createdAt).toLocaleString("zh-CN", {
                          hour12: false,
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="max-w-[300px] px-3 py-2.5">
                        <p className="line-clamp-2 text-fg" title={job.prompt}>
                          {jobLabel(job) || "（无提示词）"}
                        </p>
                        {issue ? (
                          <p className="mt-1 text-[12px] text-alert">{issue.title}</p>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-fg-soft">
                        {modelName(job.model)}
                        <span className="text-fg-muted"> · {describeImageParams(job)}</span>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-fg">
                        <span className="inline-flex items-center gap-2">
                          {isSavingJob(job) ? "保存中" : STATUS[job.status]}
                          <BillingBadge status={job.billing} active={active} />
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        {job.requestId ? (
                          <button
                            type="button"
                            onClick={() => copy(job.requestId!)}
                            className="inline-flex max-w-[170px] items-center gap-1.5 font-mono text-[11.5px] text-fg-soft hover:text-fg"
                            title="复制请求 ID"
                          >
                            <span className="truncate">{job.requestId}</span>
                            <CopyIcon className="size-3 shrink-0" />
                          </button>
                        ) : (
                          <span className="text-fg-muted">未产生</span>
                        )}
                      </td>
                      <td className="px-2 py-2.5 text-right">
                        {active ? null : (
                          <button
                            type="button"
                            onClick={() => void deleteWorks([job.id])}
                            aria-label="删除这条记录"
                            title="删除（可以撤销）"
                            className="flex size-8 items-center justify-center rounded-[9px] text-fg-muted opacity-60 transition-[opacity,background-color,color] group-hover/row:opacity-100 hover:bg-alert/10 hover:text-alert focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-acc pointer-coarse:opacity-100 [&_svg]:size-4"
                          >
                            <Trash2Icon strokeWidth={1.75} />
                          </button>
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

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <span className="text-[12.5px] text-fg-muted tabular">
          {total > pageSize ? `第 ${page} / ${pages} 页` : null}
        </span>
        <Pager page={page} pages={pages} onPage={goTo} disabled={loading} />
      </div>

      <DeleteWorksDialog
        count={selection.size}
        unit="条记录"
        open={confirming}
        deleting={deleting}
        note={
          reconcileSelected
            ? `其中 ${reconcileSelected} 条结果待核对，删除后这里不再显示它们的请求 ID，后台仍会继续核对。`
            : null
        }
        onConfirm={() => void confirmDelete()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}

/** A row checkbox; shift-click selects the span from the last one clicked. */
function Check({
  checked,
  mixed = false,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  mixed?: boolean;
  disabled?: boolean;
  label: string;
  onChange: (range: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed;
  }, [mixed]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      aria-label={label}
      title={disabled ? label : undefined}
      onChange={() => {}}
      onClick={(event) => onChange(event.shiftKey)}
      className="size-4 cursor-pointer rounded-[4px] accent-(--acc) disabled:cursor-not-allowed disabled:opacity-35"
    />
  );
}

"use client";

import {
  ArrowUpRightIcon,
  CopyIcon,
  DownloadIcon,
  ImagePlusIcon,
  RotateCcwIcon,
} from "lucide-react";

import { useAccount } from "@/lib/account-context";
import { describeIssue } from "@/lib/generation-errors";
import { type ImageJobView, isActiveJob, isFailedJob, jobStatusLabel } from "@/lib/image-jobs";
import { QUALITY_LABEL, describeImageParams } from "@/lib/image-model-meta";

import { BillingBadge, needsReconcile } from "../billing/billing-badge";
import { useToast } from "../toast";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";

/**
 * One result at full size, with everything needed to reconcile it against
 * the main-site usage page.
 */
export function LoupeDialog({
  job,
  modelName,
  onClose,
  onReuse,
  onUseAsReference,
  onDownload,
}: {
  job: ImageJobView | null;
  modelName: string;
  onClose: () => void;
  onReuse: (job: ImageJobView) => void;
  onUseAsReference: (job: ImageJobView) => void;
  onDownload: (job: ImageJobView) => void;
}) {
  const { account } = useAccount();
  const { success } = useToast();
  const usageUrl = account.data?.links.usage;
  const issue = job && isFailedJob(job)
    ? describeIssue(job.errorCode ?? "upstream_unknown", job.errorMessage)
    : null;

  const copy = (text: string, label: string) => {
    void navigator.clipboard?.writeText(text).then(() => success(`已复制${label}`));
  };

  return (
    <Dialog open={job !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92dvh] gap-0 overflow-hidden p-0 sm:max-w-[min(1100px,94vw)]">
        {job ? (
          <div className="grid max-h-[92dvh] grid-cols-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_360px] md:overflow-hidden">
            <div className="flex min-h-[280px] items-center justify-center bg-ground-deep/60 p-4 md:p-8">
              {job.url ? (
                <img
                  src={job.url}
                  alt={job.prompt || "生成结果"}
                  className="max-h-[78dvh] w-auto max-w-full rounded-[12px] object-contain shadow-lit"
                />
              ) : (
                <p className="text-sm text-fg-muted">
                  {issue ? issue.title : jobStatusLabel(job)}
                </p>
              )}
            </div>

            <div className="flex min-h-0 flex-col border-t border-line md:border-t-0 md:border-l">
              <div className="flex shrink-0 items-center gap-2 border-b border-line px-5 py-3.5 pr-14 text-[12.5px] text-fg-soft">
                <span className="rounded-full bg-tint/[0.08] px-2.5 py-0.5 font-medium text-fg">
                  {jobStatusLabel(job)}
                </span>
                <span className="truncate">{modelName}</span>
                <span className="shrink-0 font-mono text-[12px] text-fg-muted">
                  {describeImageParams({ ...job, aspectRatio: job.aspectRatio ?? "默认" })}
                </span>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-5">
                <div>
                  <DialogTitle className="sr-only">作品详情</DialogTitle>
                  <DialogDescription className="sr-only">描述、参数与状态</DialogDescription>
                  <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-fg">
                    {job.prompt || "（无描述）"}
                  </p>
                  {job.prompt ? (
                    <button
                      type="button"
                      onClick={() => copy(job.prompt, "描述")}
                      className="mt-2 inline-flex items-center gap-1 text-[12px] text-fg-soft hover:text-fg"
                    >
                      <CopyIcon className="size-3.5" />
                      复制描述
                    </button>
                  ) : null}
                </div>

                {issue ? (
                  <div className="rounded-[10px] border border-alert/30 bg-alert-wash px-3.5 py-3 text-[13px] leading-relaxed text-alert">
                    <p className="font-semibold">{issue.title}</p>
                    <p className="mt-1">{issue.message}</p>
                  </div>
                ) : null}

                <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2.5 text-[13px]">
                  <dt className="text-fg-muted">状态</dt>
                  <dd className="flex items-center gap-2 text-fg">
                    {jobStatusLabel(job)}
                    <BillingBadge status={job.billing} active={isActiveJob(job)} />
                  </dd>
                  <dt className="text-fg-muted">模型</dt>
                  <dd className="text-fg">{modelName}</dd>
                  <dt className="text-fg-muted">规格</dt>
                  <dd className="text-fg tabular">
                    {job.resolution} · {job.aspectRatio ?? "默认比例"}
                    {job.width && job.height ? ` · ${job.width}×${job.height}` : ""}
                  </dd>
                  {job.quality ? (
                    <>
                      <dt className="text-fg-muted">质量</dt>
                      <dd className="text-fg">{QUALITY_LABEL[job.quality]}</dd>
                    </>
                  ) : null}
                  {job.inputImages.length ? (
                    <>
                      <dt className="text-fg-muted">参考图</dt>
                      <dd className="text-fg">{job.inputImages.length} 张</dd>
                    </>
                  ) : null}
                  <dt className="text-fg-muted">提交时间</dt>
                  <dd className="text-fg tabular">
                    {new Date(job.createdAt).toLocaleString("zh-CN", { hour12: false })}
                  </dd>
                  <dt className="text-fg-muted">请求 ID</dt>
                  <dd className="min-w-0">
                    {job.requestId ? (
                      <button
                        type="button"
                        onClick={() => copy(job.requestId!, "请求 ID")}
                        className="inline-flex max-w-full items-center gap-1.5 font-mono text-[11.5px] text-fg hover:text-amb"
                      >
                        <span className="truncate">{job.requestId}</span>
                        <CopyIcon className="size-3 shrink-0" />
                      </button>
                    ) : (
                      <span className="text-fg-muted">未产生</span>
                    )}
                  </dd>
                </dl>

                {usageUrl && (needsReconcile(job.billing, isActiveJob(job)) || job.billing === "charged") ? (
                  <a
                    href={usageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 self-start text-[13px] text-fg-soft underline decoration-line-strong underline-offset-4 hover:text-fg"
                  >
                    {needsReconcile(job.billing, isActiveJob(job)) ? "去主站核对" : "在主站用量页查看"}
                    <ArrowUpRightIcon className="size-3.5" />
                  </a>
                ) : null}
              </div>

              <div className="flex shrink-0 flex-wrap gap-2 border-t border-line p-4">
                <Button variant="outline" onClick={() => onReuse(job)}>
                  <RotateCcwIcon strokeWidth={1.75} />
                  做同款
                </Button>
                {job.url && job.assetId ? (
                  <Button variant="outline" onClick={() => onUseAsReference(job)}>
                    <ImagePlusIcon strokeWidth={1.75} />
                    用作参考图
                  </Button>
                ) : null}
                {job.url ? (
                  <Button variant="accent" className="ml-auto" onClick={() => onDownload(job)}>
                    <DownloadIcon strokeWidth={1.75} />
                    下载
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

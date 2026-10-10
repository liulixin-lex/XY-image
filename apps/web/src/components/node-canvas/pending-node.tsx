"use client";

/**
 * A picture on its way: the slot a generator run reserved. It goes away when
 * the worker's picture arrives (merge.ts). A picture that will not arrive
 * says why, in the billing wording the studio uses (image-jobs.ts), and can
 * be removed; one still waiting at the dispatch gate can be canceled free.
 */
import { Handle, type NodeProps, Position } from "@xyflow/react";
import Link from "next/link";
import { memo } from "react";

import {
  describeOutcome,
  isActiveJob,
  isUnsentJob,
} from "../../lib/image-jobs";
import type { SceneNode } from "../../lib/node-canvas/types";
import { cn } from "../../lib/utils";
import { LiveDot } from "../ambient/live-dot";
import { useNodeCanvas, useRuntimeState } from "./context";

export const PendingNode = memo(function PendingNode({
  data,
  width,
  height,
}: NodeProps<SceneNode>) {
  const { runtime } = useNodeCanvas();
  const pending = data.pending;
  const job = useRuntimeState((state) =>
    pending ? state.jobs.get(pending.jobId) : undefined,
  );
  const missing = useRuntimeState((state) =>
    pending ? state.missing.has(pending.jobId) : false,
  );
  if (!pending) return null;

  const compact = (width ?? 0) < 150 || (height ?? 0) < 110;
  const outcome = job ? describeOutcome(job) : null;
  const live =
    !job || isActiveJob(job) || (job.status === "succeeded" && !missing);
  const title = !job
    ? "读取中"
    : job.status === "succeeded"
      ? missing
        ? "已生成，没放到画布上"
        : "已生成，正在放到画布上"
      : (outcome?.title ?? "");

  return (
    <div
      className={cn(
        "relative flex size-full flex-col items-center justify-center gap-2 overflow-hidden rounded-frame p-3 text-center",
        live
          ? "animate-breathe"
          : "border border-dashed border-line-strong bg-tint/[0.03]",
      )}
      aria-live="polite"
    >
      {/* End point of the dashed link from its generator; not connectable. */}
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="!invisible"
      />
      {live ? (
        <span
          aria-hidden
          className="animate-sweep pointer-events-none absolute inset-y-0 left-0 w-1/2 bg-linear-to-r from-transparent via-tint/[0.06] to-transparent"
        />
      ) : null}
      <span className="relative flex items-center gap-2 text-[12.5px] font-medium text-fg">
        {live ? <LiveDot /> : null}
        {title}
      </span>
      {!compact && job && missing ? (
        <Link
          href="/studio"
          className="nodrag relative text-[12px] text-fg-soft underline underline-offset-2"
        >
          到生图记录里查看
        </Link>
      ) : null}
      {!compact && job && !live ? (
        <div className="relative flex items-center gap-1.5">
          {outcome?.tone === "unknown" ? (
            <Link
              href="/studio"
              className="nodrag text-[12px] text-fg-soft underline underline-offset-2"
            >
              去核对
            </Link>
          ) : null}
          <button
            type="button"
            onClick={() =>
              runtime.dismiss(pending.generatorId, [pending.jobId])
            }
            className="nodrag rounded-md px-2 py-1 text-[12px] text-fg-soft transition-colors hover:bg-tint/[0.06] hover:text-fg focus-visible:outline-2 focus-visible:outline-acc"
          >
            移除
          </button>
        </div>
      ) : null}
      {!compact && job && isUnsentJob(job) ? (
        <button
          type="button"
          onClick={() => void runtime.cancel(pending.jobId)}
          className="nodrag relative rounded-md px-2 py-1 text-[12px] text-fg-soft transition-colors hover:bg-tint/[0.06] hover:text-fg focus-visible:outline-2 focus-visible:outline-acc"
        >
          取消（还没发出）
        </button>
      ) : null}
    </div>
  );
});

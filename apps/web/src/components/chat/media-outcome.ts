import {
  type BillingStatus,
  isBillingSettled,
  needsReconcile,
} from "@/components/billing/billing-badge";
import { describeIssue, isKnownIssueCode } from "@/lib/generation-errors";

/**
 * What a finished generate_image / generate_video call that brought back no
 * picture means for the user. Same rule as the studio's describeOutcome:
 * 「没生成出来」 only when the job says nothing was charged; anything the
 * server could not settle is 待核对 and never resent automatically.
 *
 * Inputs (server `agent/tools/image-generate.ts`, `agent/runtime.ts`):
 * - `pending: "storage"`: generated, still being saved.
 * - `error` "…timed out…": the agent stopped waiting; the worker goes on.
 * - `billingStatus` / `errorCode`: how the job settled. Missing (older
 *   messages, a tool that threw, `stream-adapter` on_tool_error) means the
 *   request may have gone out, so it reads as 待核对.
 * - `stopped`: closed by a stopped run (use-chat-stream).
 */
export type MediaOutcome = {
  tone:
    | "saving"
    | "waiting"
    | "stopped"
    | "unknown"
    | "charged_failed"
    | "failed"
    | "canceled";
  title: string;
  message?: string;
};

export function describeMediaOutcome(
  output: Record<string, unknown> | undefined,
  kind: "image" | "video",
): MediaOutcome | null {
  if (!output) return null;
  const noun = kind === "video" ? "视频" : "图片";

  if (output.stopped === true) {
    return {
      tone: "stopped",
      title: "已停止",
      ...(kind === "image"
        ? { message: "已经开始生成的图片仍会放到画布上。" }
        : {}),
    };
  }
  const error = typeof output.error === "string" ? output.error : null;
  if (!error) return null;

  if (kind === "image" && output.pending === "storage") {
    return {
      tone: "saving",
      title: "图片已生成，正在保存",
      message: "这张已经生成，正在保存，好了会自动放到画布上，不用重新生成。",
    };
  }
  if (kind === "image" && /timed out/i.test(error)) {
    return {
      tone: "waiting",
      title: "图片还在生成",
      message: "这次等得比较久。生成好后会自动放到画布上。",
    };
  }

  const billing = readBilling(output.billingStatus);
  const code = typeof output.errorCode === "string" ? output.errorCode : null;
  if (code === "canceled" && billing === "none") {
    return { tone: "canceled", title: "已取消，没有发出" };
  }
  const issue = code ? describeIssue(code, error) : null;
  if (
    billing === null ||
    needsReconcile(billing) ||
    (issue?.maybeCharged && !isBillingSettled(billing))
  ) {
    return {
      tone: "unknown",
      title: "结果待核对",
      message: `${noun}可能已经生成。可以在「生成记录」里看一下，不会自动重发。`,
    };
  }
  if (billing === "charged") {
    return {
      tone: "charged_failed",
      title: `已生成，但没拿到${noun}`,
      message: "可以在「生成记录」里看一下这次请求。",
    };
  }
  // Catalog copy for codes it knows; otherwise the server's own message
  // (sanitized, already user-facing) rather than a vague fallback.
  return {
    tone: "failed",
    title: "没生成出来",
    message:
      issue && isKnownIssueCode(code)
        ? joinSentences(issue.title, issue.message)
        : error,
  };
}

function readBilling(value: unknown): BillingStatus | null {
  return value === "none" ||
    value === "pending" ||
    value === "charged" ||
    value === "not_charged" ||
    value === "unknown"
    ? value
    : null;
}

/** 「内容未通过审核」+「修改提示词…」 → 「内容未通过审核。修改提示词…」 */
function joinSentences(title: string, message: string): string {
  return /[。！？.!?]$/.test(title)
    ? `${title}${message}`
    : `${title}。${message}`;
}

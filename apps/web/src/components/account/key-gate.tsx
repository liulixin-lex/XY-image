"use client";

import { ArrowUpRightIcon, KeyRoundIcon, RefreshCwIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useAccount } from "@/lib/account-context";
import { cn } from "@/lib/utils";

import { useIssues } from "../issues/issue-provider";
import { Button } from "../ui/button";

/**
 * Shown where generation needs an image key and none is usable. Explains
 * the one thing to do and offers a sync (the user may have just created a
 * key on the main site in another tab).
 */
export function KeyGate({
  reason,
  className,
  compact = false,
}: {
  reason: string | null;
  className?: string;
  compact?: boolean;
}) {
  const { account, syncKeys } = useAccount();
  const { report } = useIssues();
  const [syncing, setSyncing] = useState(false);
  const keysUrl = account.data?.links.keys;

  const copy =
    reason === "key_quota_exhausted"
      ? { title: "所选 Key 额度已用完", body: "换一个 Key，或到主站调高这个 Key 的额度。" }
      : reason === "key_ip_restricted"
        ? { title: "所选 Key 限制了 IP", body: "在主站为这个 Key 放行生图站出口 IP，或换一个 Key。" }
        : { title: "先选一个能生图的 Key", body: "生图会用你在主站的 Key 并从主站余额扣费。选择一个所在分组开放了生图的 Key 即可开始。" };

  const sync = async () => {
    setSyncing(true);
    try {
      await syncKeys();
    } catch (error) {
      report(error);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div
      className={cn(
        "rounded-lg border border-dashed border-line-strong bg-panel",
        compact ? "p-4" : "p-6 sm:p-8",
        className,
      )}
    >
      <KeyRoundIcon className="size-5 text-fg" strokeWidth={1.75} />
      <h2 className={cn("mt-3 font-semibold text-fg", compact ? "text-[15px]" : "text-lg")}>
        {copy.title}
      </h2>
      <p className="mt-1.5 max-w-[34em] text-sm leading-relaxed text-fg-soft">{copy.body}</p>
      <div className="mt-5 flex flex-wrap items-center gap-2.5">
        <Link
          href="/settings?tab=keys"
          className="inline-flex h-9 items-center rounded-md bg-fg px-3.5 text-sm font-medium text-ground hover:bg-white"
        >
          选择 Key
        </Link>
        <Button variant="outline" onClick={sync} disabled={syncing}>
          <RefreshCwIcon className={cn(syncing && "animate-spin")} strokeWidth={1.75} />
          {syncing ? "正在同步" : "同步 Key"}
        </Button>
        {keysUrl ? (
          <a
            href={keysUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center gap-1 px-1 text-sm text-fg-soft underline decoration-line-strong underline-offset-4 hover:text-fg"
          >
            去主站创建 Key
            <ArrowUpRightIcon className="size-3.5" />
          </a>
        ) : null}
      </div>
    </div>
  );
}

/** True when a model list error means "fix your key", not "try later". */
export function isKeyProblem(code: string | null) {
  return (
    code === "key_unavailable" ||
    code === "key_quota_exhausted" ||
    code === "key_ip_restricted"
  );
}

"use client";

import { useAccount } from "@/lib/account-context";
import { cn } from "@/lib/utils";
import { formatUsd } from "@/lib/xy2api-api";

/**
 * Main-site balance figure. `null` balance means "no usable image key or
 * balance unavailable" and is shown as a dash, never as $0.
 */
export function BalanceFigure({
  className,
  emptyLabel = "未读取",
}: {
  className?: string;
  emptyLabel?: string;
}) {
  const { account } = useAccount();
  if (!account.data && account.loading) {
    return (
      <span
        aria-label="正在读取余额"
        className={cn("inline-block h-[1em] w-14 animate-breathe rounded-sm", className)}
      />
    );
  }
  const balance = account.data?.balance ?? null;
  if (!balance) {
    return <span className={cn("text-fg-muted", className)}>{emptyLabel}</span>;
  }
  return (
    <span
      className={cn(
        "font-sans font-semibold tabular tracking-[-0.01em]",
        balance.amount <= 0 && "text-alert",
        className,
      )}
    >
      {formatUsd(balance.amount)}
    </span>
  );
}

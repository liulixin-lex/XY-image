import { cn } from "@/lib/utils";

export type BillingStatus =
  | "none"
  | "pending"
  | "charged"
  | "not_charged"
  | "unknown";

/**
 * The billing flag a record shows, in words (never colour alone, PRODUCT.md
 * principle 1), or null when there is nothing for the user to do.
 *
 * Only two states are flagged: 待核对 (`pending` after the job ended, or
 * `unknown`: check the main-site usage page before resubmitting) and 未发出
 * (nothing reached the main site). Charged and not-charged outcomes are not
 * labelled: the user asked (2026-10-10) for no 「已扣费」-style copy; the
 * picture, or the failure line, already says what happened.
 */
export function billingFlag(
  status: BillingStatus | null | undefined,
  active = false,
): "待核对" | "未发出" | null {
  const value = status ?? "none";
  if (needsReconcile(value, active)) return "待核对";
  if (value === "none" && !active) return "未发出";
  return null;
}

/**
 * True when the user should check the main-site usage page. Pass `active`
 * for queued/running jobs: `pending` is then just "not settled yet" and must
 * not be flagged as a problem.
 */
export function needsReconcile(status: BillingStatus | null | undefined, active = false) {
  if (active) return status === "unknown";
  return status === "pending" || status === "unknown";
}

/**
 * True when billing is known for sure: xy2api answered, or the server matched
 * a 待核对 job against the main-site usage list. Error codes that only guess
 * "maybe charged" must then give way to the real outcome.
 */
export function isBillingSettled(status: BillingStatus | null | undefined) {
  return status === "charged" || status === "not_charged";
}

/** The flag from billingFlag as a chip; renders nothing when there is none. */
export function BillingBadge({
  status,
  active = false,
  className,
}: {
  status: BillingStatus | null | undefined;
  /** Job is still queued/running. */
  active?: boolean;
  className?: string;
}) {
  const flag = billingFlag(status, active);
  if (!flag) return null;
  return (
    <span
      className={cn(
        "inline-flex h-[22px] shrink-0 items-center rounded-[7px] px-2 text-[11.5px] font-semibold leading-none whitespace-nowrap",
        flag === "待核对"
          ? "bg-warn-wash text-warn"
          : "border border-dashed border-line-strong text-fg-muted",
        className,
      )}
    >
      {flag}
    </span>
  );
}

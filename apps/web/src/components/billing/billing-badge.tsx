import { cn } from "@/lib/utils";

export type BillingStatus =
  | "none"
  | "pending"
  | "charged"
  | "not_charged"
  | "unknown";

/**
 * Billing state as words, never colour alone (PRODUCT.md principle 1).
 * `pending` and `unknown` both mean "check the main-site usage page".
 */
const LABEL: Record<BillingStatus, string> = {
  none: "未发出",
  pending: "待核对",
  charged: "已扣费",
  not_charged: "未扣费",
  unknown: "待核对",
};

export function billingLabel(status: BillingStatus | null | undefined) {
  return LABEL[status ?? "none"];
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
  const value = status ?? "none";
  if (active && value === "pending") {
    return (
      <span
        className={cn(
          "inline-flex h-[22px] shrink-0 items-center rounded-[7px] bg-tint/[0.07] px-2 text-[11.5px] font-semibold leading-none whitespace-nowrap text-fg-soft",
          className,
        )}
      >
        结算中
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex h-[22px] shrink-0 items-center rounded-[7px] px-2 text-[11.5px] font-semibold leading-none whitespace-nowrap",
        value === "charged" && "bg-ok-wash text-ok",
        value === "not_charged" && "bg-tint/[0.07] text-fg-muted",
        value === "none" && "border border-dashed border-line-strong text-fg-muted",
        needsReconcile(value) && "bg-warn-wash text-warn",
        className,
      )}
    >
      {LABEL[value]}
    </span>
  );
}

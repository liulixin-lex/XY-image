import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Settings block: a title column and a content column on wide screens,
 * stacked on narrow ones. Groups are separated by a hairline, not cards.
 */
export function SettingsSection({
  id,
  title,
  description,
  children,
  className,
}: {
  /** Anchor for deep links such as `/settings?tab=models#chat-providers`. */
  id?: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        "scroll-mt-24",
        "grid gap-x-12 gap-y-4 border-t border-line py-8 first:border-t-0 first:pt-2 lg:grid-cols-[240px_minmax(0,1fr)]",
        className,
      )}
    >
      <div>
        {/* Same voice as the studio's field labels: display face, coral slash. */}
        <h2 className="poster-label text-[18px] leading-tight text-fg">{title}</h2>
        {description ? (
          <p className="mt-2 text-[13px] leading-relaxed text-fg-soft">{description}</p>
        ) : null}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/** Label / value pairs inside a section. */
export function Facts({ children }: { children: ReactNode }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-8 gap-y-3 text-[13.5px]">{children}</dl>
  );
}

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-fg-muted">{label}</dt>
      <dd className="min-w-0 text-fg">{children}</dd>
    </>
  );
}

/** Small status tag in settings lists. ink = in use; marker = a problem; quiet = off. */
export function Tag({
  tone,
  children,
}: {
  tone: "ink" | "marker" | "quiet";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-sm px-1.5 text-[11px] font-medium leading-none",
        tone === "ink" && "bg-fg text-ground",
        tone === "marker" && "border border-alert text-alert",
        tone === "quiet" && "border border-line-strong text-fg-soft",
      )}
    >
      {children}
    </span>
  );
}

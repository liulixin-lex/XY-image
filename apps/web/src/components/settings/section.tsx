import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Settings block: a title column and a content column on wide screens,
 * stacked on narrow ones. Groups are separated by a hairline, not cards.
 */
export function SettingsSection({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "grid gap-x-12 gap-y-4 border-t border-line py-8 first:border-t-0 first:pt-2 lg:grid-cols-[240px_minmax(0,1fr)]",
        className,
      )}
    >
      <div>
        <h2 className="text-[15px] font-semibold text-fg">{title}</h2>
        {description ? (
          <p className="mt-1.5 text-[13px] leading-relaxed text-fg-soft">{description}</p>
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

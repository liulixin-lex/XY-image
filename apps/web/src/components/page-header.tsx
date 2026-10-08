import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Page title row under the workspace nav. */
export function PageHeader({
  title,
  description,
  aside,
  className,
}: {
  title: string;
  description?: ReactNode;
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "mx-auto flex max-w-[1600px] flex-wrap items-end gap-x-6 gap-y-2 px-4 pt-4 pb-8 sm:px-8 md:pt-8 lg:px-12",
        className,
      )}
    >
      <h1 className="font-display text-[clamp(36px,4.2vw,56px)] leading-[1.02] font-normal text-fg">
        {title}
      </h1>
      {aside ? <div className="pb-1.5">{aside}</div> : null}
      {description ? (
        <p className="basis-full max-w-[44em] text-[15px] leading-relaxed text-fg-soft">{description}</p>
      ) : null}
    </header>
  );
}

import { Skeleton } from "@/components/ui/skeleton";

/**
 * Placeholder for the 已安装 tab (filter bar, banner, card grid). Rendered
 * inside the tab panel, so the page header and tabs are already in place.
 */
export function SkillsSkeleton() {
  return (
    <div>
      {/* Search + filter bar */}
      <div className="mb-5 flex flex-wrap items-center gap-2 sm:mb-6 sm:gap-2.5">
        <Skeleton className="h-11 w-20 rounded-[10px] sm:h-9" />
        <Skeleton className="order-last h-11 w-full rounded-[10px] sm:order-none sm:h-9 sm:max-w-sm sm:flex-1" />
        <Skeleton className="h-11 w-16 rounded-[10px] sm:h-9" />
      </div>

      {/* Banner */}
      <Skeleton className="mb-5 h-[76px] w-full rounded-[18px] sm:mb-6 sm:h-[90px]" />

      {/* Card grid */}
      <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="space-y-3 rounded-[16px] bg-panel p-4 shadow-card"
          >
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-5 w-10 rounded-full" />
            </div>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <div className="flex items-center justify-between border-t border-line pt-3">
              <Skeleton className="h-5 w-14 rounded-full" />
              <Skeleton className="h-4 w-20" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

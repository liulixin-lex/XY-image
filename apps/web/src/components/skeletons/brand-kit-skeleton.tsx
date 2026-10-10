import { Skeleton } from "@/components/ui/skeleton";

/**
 * Placeholder for the brand-kit panels (kit list + editor). Rendered inside
 * BrandKitFrame, so the page header is already in place.
 */
export function BrandKitSkeleton() {
  return (
    <>
      {/* Kit list -- horizontal on mobile, vertical panel on md+ */}
      <aside className="glass flex w-full shrink-0 flex-col overflow-hidden rounded-[20px] md:w-[260px]">
        <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-3">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-8 w-[88px] rounded-[10px]" />
        </div>
        <div className="flex gap-1 overflow-hidden px-2 pb-3 md:flex-col md:pb-4">
          {Array.from({ length: 3 }, (_, i) => (
            <div
              key={i}
              className="flex w-auto shrink-0 items-center gap-2.5 rounded-[12px] px-2.5 py-2 md:w-full"
            >
              <Skeleton className="size-8 shrink-0 rounded-[9px]" />
              <Skeleton className="hidden h-4 flex-1 md:block" />
            </div>
          ))}
        </div>
      </aside>

      {/* Editor */}
      <div className="glass flex min-h-[60dvh] min-w-0 flex-1 flex-col overflow-hidden rounded-[20px]">
        <div className="flex min-h-[64px] shrink-0 items-center justify-between gap-3 border-b border-line px-4 sm:px-6 md:h-[88px]">
          <Skeleton className="h-8 w-48" />
          <div className="flex items-center gap-3">
            <Skeleton className="hidden h-4 w-20 sm:block" />
            <Skeleton className="h-6 w-11 rounded-full" />
            <Skeleton className="size-8 rounded-[10px]" />
          </div>
        </div>
        <div className="flex-1 overflow-hidden px-4 py-6 sm:px-6 md:px-[80px] xl:px-[160px]">
          <div className="mx-auto flex max-w-[960px] flex-col gap-9">
            <div className="space-y-3">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-[72px] w-full rounded-[14px]" />
            </div>
            {[3, 4, 3].map((count, row) => (
              <div key={row} className="space-y-3">
                <Skeleton className="h-5 w-14" />
                <div className="flex flex-wrap gap-4">
                  {Array.from({ length: count }, (_, i) => (
                    <Skeleton
                      key={i}
                      className="h-20 w-24 rounded-[14px] sm:h-24 sm:w-32"
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

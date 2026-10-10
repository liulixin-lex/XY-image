import { Palette, Plus } from "lucide-react";

interface EmptyStateProps {
  onCreateKit: () => void;
}

export function EmptyState({ onCreateKit }: EmptyStateProps) {
  return (
    <div className="glass flex min-h-[60dvh] flex-1 flex-col items-center justify-center gap-4 rounded-[20px] px-4 text-center">
      <div className="rounded-lg glass p-4">
        <Palette className="h-7 w-7 text-fg-muted" strokeWidth={1.5} />
      </div>
      <div>
        <h2 className="text-base font-semibold text-fg sm:text-lg">还没有品牌套件</h2>
        <p className="mt-1 max-w-[300px] text-sm leading-relaxed text-fg-soft">
          把标志、颜色和字体放进一个套件，在画布里选中它，助手出图时就会照着用。
        </p>
      </div>
      <button
        type="button"
        onClick={onCreateKit}
        className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-md bg-fg px-4 py-2 text-sm font-medium text-ground transition-colors hover:bg-fg/88 active:translate-y-px sm:min-h-0"
      >
        <Plus className="h-4 w-4" />
        新建品牌套件
      </button>
    </div>
  );
}

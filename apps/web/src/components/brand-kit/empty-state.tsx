import { Palette, Plus } from "lucide-react";

import { buttonVariants } from "../ui/button";

interface EmptyStateProps {
  onCreateKit: () => void;
}

export function EmptyState({ onCreateKit }: EmptyStateProps) {
  return (
    <div className="glass flex min-h-[60dvh] flex-1 flex-col items-center justify-center gap-4 rounded-[20px] px-4 text-center">
      <div className="flex size-16 -rotate-6 items-center justify-center rounded-[16px] bg-acc text-acc-ink shadow-acc">
        <Palette aria-hidden className="size-7" strokeWidth={1.75} />
      </div>
      <div>
        <h2 className="font-display text-[28px] leading-tight text-fg">还没有品牌套件</h2>
        <p className="mt-2 max-w-[320px] text-[14px] leading-relaxed text-fg-soft">
          把标志、颜色和字体放进一个套件，在画布里选中它，助手出图时就会照着用。
        </p>
      </div>
      <button
        type="button"
        onClick={onCreateKit}
        className={buttonVariants({ variant: "accent", size: "lg", slant: true })}
      >
        <span className="sk-in gap-1.5">
          <Plus aria-hidden className="size-4" strokeWidth={2.2} />
          新建品牌套件
        </span>
      </button>
    </div>
  );
}

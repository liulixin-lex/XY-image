"use client";

import { MonitorIcon, MoonIcon, SunMediumIcon } from "lucide-react";
import { useTheme } from "next-themes";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "system", label: "跟随系统", Icon: MonitorIcon },
  { value: "light", label: "浅色", Icon: SunMediumIcon },
  { value: "dark", label: "深色", Icon: MoonIcon },
] as const;

/**
 * Light / dark / follow the system. The trigger icon is switched with the
 * `dark:` variant rather than from `resolvedTheme`, so the static HTML and
 * the first client render agree (no hydration mismatch, no icon flash).
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="切换浅色或深色外观"
        className={cn(
          "glass flex size-9 shrink-0 items-center justify-center rounded-[11px] text-fg transition-[background-color,scale] hover:bg-tint/[0.06] active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc",
          className,
        )}
      >
        <SunMediumIcon className="size-[17px] dark:hidden" strokeWidth={1.8} aria-hidden />
        <MoonIcon className="hidden size-[17px] dark:block" strokeWidth={1.8} aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-36">
        <DropdownMenuRadioGroup
          value={theme ?? "system"}
          onValueChange={(value) => {
            console.info("[theme] switched", { to: value });
            setTheme(String(value));
          }}
        >
          {OPTIONS.map(({ value, label, Icon }) => (
            <DropdownMenuRadioItem key={value} value={value} className="gap-2">
              <Icon className="size-4 text-fg-soft" strokeWidth={1.8} aria-hidden />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

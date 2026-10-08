import { cn } from "@/lib/utils";

/**
 * The only looping light: a small dot in the room's colour, shown only
 * while something is running (generation, upload, the agent working).
 */
export function LiveDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2 shrink-0 rounded-full bg-live animate-live", className)}
    />
  );
}

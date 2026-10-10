"use client";

import { CheckIcon, CircleAlertIcon, InfoIcon } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ToastVariant = "success" | "error" | "info";

interface Toast {
  id: string;
  title?: string | undefined;
  message: string;
  variant: ToastVariant;
  /** Playing its exit; removed when that ends. */
  leaving?: boolean;
}

export interface ToastOptions {
  title?: string | undefined;
  message: string;
  variant?: ToastVariant;
  /** Milliseconds. Errors default to 6 s so the text can be read. */
  duration?: number;
}

interface ToastContextValue {
  toast: (message: string, variant?: ToastVariant) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  show: (options: ToastOptions) => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ToastContext = createContext<ToastContextValue | null>(null);

const DURATION: Record<ToastVariant, number> = {
  success: 3000,
  info: 3600,
  error: 6000,
};
const MAX_VISIBLE = 3;
/** Exit length; matches `duration-200` on the leaving slip. */
const EXIT_MS = 200;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  // Leaving is two steps: play the exit (CSS), then drop the slip. The
  // second step is a timer, not animationend, so a hidden tab still clears.
  const remove = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    timers.current.set(
      id,
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
        timers.current.delete(id);
      }, EXIT_MS),
    );
  }, []);

  const show = useCallback(
    ({ title, message, variant = "info", duration }: ToastOptions) => {
      const id = crypto.randomUUID();
      setToasts((prev) => {
        // Collapse exact duplicates (e.g. the same error from two listeners).
        if (prev.some((t) => !t.leaving && t.message === message && t.title === title))
          return prev;
        return [...prev, { id, title, message, variant }].slice(-MAX_VISIBLE);
      });
      timers.current.set(
        id,
        setTimeout(() => remove(id), duration ?? DURATION[variant]),
      );
    },
    [remove],
  );

  const ctx = useMemo<ToastContextValue>(
    () => ({
      toast: (message, variant = "info") => show({ message, variant }),
      success: (message) => show({ message, variant: "success" }),
      error: (message) => show({ message, variant: "error" }),
      show,
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-5 z-[9999] flex flex-col items-center gap-2 px-4"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => remove(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Toast item: a glass slip with a status glyph. Click to dismiss.
// ---------------------------------------------------------------------------

const ICONS: Record<ToastVariant, ReactNode> = {
  success: <CheckIcon className="size-4 text-ok" strokeWidth={2} />,
  error: <CircleAlertIcon className="size-4 text-alert" strokeWidth={2} />,
  info: <InfoIcon className="size-4 text-amb" strokeWidth={2} />,
};

// Enter and exit are CSS keyframes (tw-animate-css): transform and opacity
// only, on the compositor.
function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  return (
    <button
      type="button"
      role={toast.variant === "error" ? "alert" : "status"}
      onClick={onDismiss}
      disabled={toast.leaving}
      className={cn(
        "glass-strong pointer-events-auto flex max-w-md items-start gap-2.5 rounded-xl px-4 py-3 text-left text-sm text-fg ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:animate-none",
        toast.leaving
          ? "animate-out fade-out-0 slide-out-to-top-1.5 fill-mode-forwards duration-200"
          : "animate-in fade-in-0 slide-in-from-bottom-3 duration-200",
      )}
    >
      <span className="mt-0.5">{ICONS[toast.variant]}</span>
      <span className="min-w-0">
        {toast.title ? (
          <span className="block font-semibold">{toast.title}</span>
        ) : null}
        <span className={cn("block", toast.title && "mt-0.5 text-fg-soft")}>
          {toast.message}
        </span>
      </span>
    </button>
  );
}

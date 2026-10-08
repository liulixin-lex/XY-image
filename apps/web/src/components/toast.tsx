"use client";

import { AnimatePresence, motion } from "framer-motion";
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

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const show = useCallback(
    ({ title, message, variant = "info", duration }: ToastOptions) => {
      const id = crypto.randomUUID();
      setToasts((prev) => {
        // Collapse exact duplicates (e.g. the same error from two listeners).
        if (prev.some((t) => t.message === message && t.title === title))
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
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <ToastItem key={t.id} toast={t} onDismiss={() => remove(t.id)} />
          ))}
        </AnimatePresence>
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

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  return (
    <motion.button
      type="button"
      layout
      role={toast.variant === "error" ? "alert" : "status"}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      onClick={onDismiss}
      className={cn(
        "glass-strong pointer-events-auto flex max-w-md items-start gap-2.5 rounded-xl px-4 py-3 text-left text-sm text-fg",
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
    </motion.button>
  );
}

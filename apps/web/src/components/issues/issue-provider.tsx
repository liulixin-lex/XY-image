"use client";

/**
 * Routes every generation/billing failure to the right UI by error code:
 * blocking issues (balance, key, possibly-charged) open a dialog with the
 * one action that resolves them; transient ones become a toast. Callers do
 * not render their own copy for known codes.
 */
import { ArrowUpRightIcon, CopyIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { useAccount } from "@/lib/account-context";
import { useAuth } from "@/lib/auth-context";
import {
  type IssueSpec,
  describeIssue,
  issueCodeOf,
} from "@/lib/generation-errors";
import { ApiApplicationError, ApiAuthError } from "@/lib/server-api";
import { formatUsd } from "@/lib/xy2api-api";

import { useToast } from "../toast";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

type OpenIssue = { code: string; spec: IssueSpec };

interface IssueContextValue {
  /** Report a thrown error. Returns the resolved spec (for inline copy). */
  report: (error: unknown) => IssueSpec | null;
  /** Report a code from a WebSocket event or a job row. */
  reportCode: (code: string, serverMessage?: string | null) => IssueSpec;
}

const IssueContext = createContext<IssueContextValue | null>(null);

export function IssueProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<OpenIssue | null>(null);
  const { show } = useToast();

  const present = useCallback(
    (code: string, spec: IssueSpec, retryAfter?: number | null) => {
      if (spec.weight === "dialog") {
        setOpen({ code, spec });
        return;
      }
      const wait =
        code === "rate_limited" && retryAfter ? `约 ${retryAfter} 秒后再试。` : "";
      show({
        variant: "error",
        title: spec.title,
        message: wait || spec.message,
      });
    },
    [show],
  );

  const report = useCallback(
    (error: unknown) => {
      // The auth layer already redirects on 401; nothing to show here.
      if (error instanceof ApiAuthError) return null;
      const code = issueCodeOf(error);
      const spec = describeIssue(
        code,
        error instanceof ApiApplicationError ? error.message : null,
      );
      if (!(error instanceof ApiApplicationError)) {
        console.error("[issue] unexpected error", error);
      } else {
        console.warn(`[issue] ${code}`, error.message);
      }
      present(
        code,
        spec,
        error instanceof ApiApplicationError ? error.retryAfter : null,
      );
      return spec;
    },
    [present],
  );

  const reportCode = useCallback(
    (code: string, serverMessage?: string | null) => {
      const spec = describeIssue(code, serverMessage);
      console.warn(`[issue] ${code}`, serverMessage ?? "");
      present(code, spec);
      return spec;
    },
    [present],
  );

  const value = useMemo(() => ({ report, reportCode }), [report, reportCode]);

  return (
    <IssueContext.Provider value={value}>
      {children}
      <IssueDialog issue={open} onClose={() => setOpen(null)} />
    </IssueContext.Provider>
  );
}

export function useIssues(): IssueContextValue {
  const ctx = useContext(IssueContext);
  if (!ctx) throw new Error("useIssues must be used within IssueProvider");
  return ctx;
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

function IssueDialog({
  issue,
  onClose,
}: {
  issue: OpenIssue | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const { signOut } = useAuth();
  const { account, config, refreshImageModels, refreshChatModels } =
    useAccount();
  const { success } = useToast();
  const links = account.data?.links;
  const balance = account.data?.balance ?? null;

  const primary = useMemo(() => {
    if (!issue) return null;
    switch (issue.spec.action) {
      case "recharge":
        return links
          ? { label: "去主站充值", href: links.recharge }
          : null;
      case "main_keys":
        return links ? { label: "去主站管理 Key", href: links.keys } : null;
      case "usage":
        return links ? { label: "去主站核对用量", href: links.usage } : null;
      case "keys":
        return {
          label: "检查 Key 设置",
          run: () => router.push("/settings?tab=keys"),
        };
      case "relogin":
        return {
          label: "重新登录",
          run: async () => {
            await signOut();
            router.replace("/login");
          },
        };
      case "providers":
        return {
          label: "检查服务商设置",
          run: () => router.push("/settings?tab=models#chat-providers"),
        };
      case "reload_models":
        return {
          label: "刷新模型列表",
          run: () => {
            void refreshImageModels();
            void refreshChatModels();
          },
        };
      default:
        return null;
    }
  }, [issue, links, router, signOut, refreshImageModels, refreshChatModels]);

  const egressIp = config?.egressIp ?? "";

  return (
    <Dialog open={issue !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        {issue ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {issue.spec.maybeCharged ? (
                  <span className="rounded-sm border border-alert px-1.5 py-0.5 text-[11px] font-semibold leading-none text-alert">
                    待核对
                  </span>
                ) : null}
                {issue.spec.title}
              </DialogTitle>
              <DialogDescription className="text-[13.5px] leading-relaxed text-fg-soft">
                {issue.spec.message}
              </DialogDescription>
            </DialogHeader>

            {issue.code === "insufficient_balance" && balance ? (
              <div className="flex items-baseline justify-between rounded-md bg-white/[0.05] px-3.5 py-3">
                <span className="text-xs text-fg-muted">当前余额</span>
                <span className="text-lg font-semibold tabular">
                  {formatUsd(balance.amount)}
                </span>
              </div>
            ) : null}

            {issue.code === "key_ip_restricted" ? (
              <div className="rounded-md bg-white/[0.05] px-3.5 py-3 text-[13px]">
                {egressIp ? (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-fg-muted">生图站出口 IP</span>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 font-mono text-[12px] text-fg hover:text-alert"
                      onClick={() => {
                        void navigator.clipboard
                          ?.writeText(egressIp)
                          .then(() => success("已复制出口 IP"));
                      }}
                    >
                      {egressIp}
                      <CopyIcon className="size-3.5" />
                    </button>
                  </div>
                ) : (
                  <span className="text-fg-soft">
                    出口 IP 未配置，请联系管理员确认后再到主站放行。
                  </span>
                )}
              </div>
            ) : null}

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                知道了
              </Button>
              {primary ? (
                "href" in primary ? (
                  <a
                    href={primary.href}
                    target="_blank"
                    rel="noreferrer"
                    onClick={onClose}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-fg px-3.5 text-sm font-medium text-ground transition-colors hover:bg-white"
                  >
                    {primary.label}
                    <ArrowUpRightIcon className="size-4" />
                  </a>
                ) : (
                  <Button
                    onClick={() => {
                      onClose();
                      void primary.run();
                    }}
                  >
                    {primary.label}
                  </Button>
                )
              ) : null}
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

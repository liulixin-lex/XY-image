"use client";

/**
 * 磁盘告警 for admins (第 59 条): a slim strip under the top bar while a disk
 * alert is open, linking to 管理. Checked on load and every five minutes,
 * only for main-site admins. Dismissing hides that alert until its level
 * changes (critical shows again even after a warning was dismissed).
 */
import type { OpsAlert } from "@loomic/shared";
import { HardDriveIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { useAccount } from "@/lib/account-context";
import { fetchAdminAlerts } from "@/lib/admin-api";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

const POLL_MS = 5 * 60 * 1000;
const DISMISS_KEY = "xy:admin-alert-dismissed";

export function AdminAlertBanner() {
  const { session } = useAuth();
  const { account } = useAccount();
  const pathname = usePathname();
  const isAdmin = account.data?.user.isAdmin === true;
  const token = session?.access_token ?? null;
  const [alert, setAlert] = useState<OpsAlert | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem(DISMISS_KEY));
    } catch {}
  }, []);

  useEffect(() => {
    if (!isAdmin || !token) return;
    let stopped = false;
    const check = () =>
      fetchAdminAlerts(token)
        .then(({ open }) => {
          if (stopped) return;
          // The worst first: critical before warning.
          const worst = [...open].sort((a, b) =>
            a.level === b.level ? 0 : a.level === "critical" ? -1 : 1,
          )[0];
          setAlert(worst ?? null);
        })
        .catch((error) => console.warn("[admin] alerts unavailable", error));
    void check();
    const timer = setInterval(check, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [isAdmin, token]);

  if (!alert || pathname === "/admin") return null;
  const key = `${alert.id}:${alert.level}`;
  if (dismissed === key) return null;
  const critical = alert.level === "critical";
  return (
    <div
      role="alert"
      className={cn(
        "relative z-20 mx-auto mt-2 flex max-w-[1600px] items-center gap-3 rounded-[14px] px-4 py-2.5 text-[13px] gutter-x",
        critical ? "bg-alert-wash text-alert" : "bg-warn-wash text-warn",
      )}
    >
      <HardDriveIcon className="size-4 shrink-0" strokeWidth={2} />
      <p className="min-w-0 flex-1 truncate font-medium">{alert.message}</p>
      <Link
        href="/admin"
        className="shrink-0 font-semibold underline-offset-4 hover:underline"
      >
        查看存储
      </Link>
      <button
        type="button"
        aria-label="先不提示"
        onClick={() => {
          setDismissed(key);
          try {
            sessionStorage.setItem(DISMISS_KEY, key);
          } catch {}
        }}
        className="shrink-0 rounded-[8px] p-1 opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-2 focus-visible:outline-acc"
      >
        <XIcon className="size-4" strokeWidth={2} />
      </button>
    </div>
  );
}

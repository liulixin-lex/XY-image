"use client";

/**
 * Settings: account and balance, keys, default models, generation records.
 * Deep links use `?tab=` (keys is linked from the issue center, account
 * chip and key gate).
 */
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useRef } from "react";

import { PageHeader } from "@/components/page-header";
import { AccountTab } from "@/components/settings/account-tab";
import { KeysTab } from "@/components/settings/keys-tab";
import { ModelsTab } from "@/components/settings/models-tab";
import { RecordsTab } from "@/components/settings/records-tab";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "account", label: "账户" },
  { id: "keys", label: "Key" },
  { id: "models", label: "模型" },
  { id: "records", label: "生成记录" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function isTab(value: string | null): value is TabId {
  return TABS.some((t) => t.id === value);
}

function SettingsView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = params.get("tab");
  const active: TabId = isTab(raw) ? raw : "account";
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const select = useCallback(
    (id: TabId) => {
      router.replace(`${pathname}?tab=${id}`, { scroll: false });
    },
    [router, pathname],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    const index = TABS.findIndex((t) => t.id === active);
    const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = TABS[(index + delta + TABS.length) % TABS.length]!;
    select(next.id);
    tabRefs.current[next.id]?.focus();
  };

  return (
    <div className="pb-20">
      <PageHeader title="设置" className="pb-5" />
      <div className="mx-auto max-w-[1600px] px-4 sm:px-8 lg:px-12">
        <div
          role="tablist"
          aria-label="设置分类"
          onKeyDown={onKeyDown}
          className="glass inline-flex max-w-full gap-1 overflow-x-auto rounded-[14px] p-[5px] scrollbar-hidden"
        >
          {TABS.map((tab) => {
            const selected = tab.id === active;
            return (
              <button
                key={tab.id}
                ref={(el) => {
                  tabRefs.current[tab.id] = el;
                }}
                type="button"
                role="tab"
                id={`tab-${tab.id}`}
                aria-selected={selected}
                aria-controls={`panel-${tab.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => select(tab.id)}
                className={cn(
                  "relative h-9 shrink-0 rounded-[10px] px-4 text-[14px] font-medium whitespace-nowrap transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amb",
                  selected
                    ? "bg-white/[0.1] text-fg"
                    : "text-fg-soft hover:bg-white/[0.06] hover:text-fg",
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div
          role="tabpanel"
          id={`panel-${active}`}
          aria-labelledby={`tab-${active}`}
          className="pt-8"
        >
          {active === "account" ? (
            <AccountTab />
          ) : active === "keys" ? (
            <KeysTab />
          ) : active === "models" ? (
            <ModelsTab />
          ) : (
            <RecordsTab />
          )}
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsView />
    </Suspense>
  );
}

"use client";

/**
 * Settings: account and balance, keys, default models, generation records.
 * Deep links use `?tab=` (keys is linked from the issue center, account
 * chip and key gate).
 */
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback } from "react";

import { PageHeader } from "@/components/page-header";
import { AccountTab } from "@/components/settings/account-tab";
import { KeysTab } from "@/components/settings/keys-tab";
import { ModelsTab } from "@/components/settings/models-tab";
import { RecordsTab } from "@/components/settings/records-tab";
import { PosterTabs, posterPanelProps } from "@/components/ui/poster-tabs";

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

  const select = useCallback(
    (id: TabId) => {
      router.replace(`${pathname}?tab=${id}`, { scroll: false });
    },
    [router, pathname],
  );

  return (
    <div className="pb-20">
      <PageHeader title="设置" className="pb-5" />
      <div className="mx-auto max-w-[1600px] px-4 sm:px-8 lg:px-12">
        <PosterTabs
          value={active}
          onValueChange={select}
          tabs={TABS.map((t) => ({ value: t.id, label: t.label }))}
          ariaLabel="设置分类"
          idPrefix="settings"
        />

        <div {...posterPanelProps("settings", active)} className="pt-8">
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

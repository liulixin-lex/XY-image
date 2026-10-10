"use client";

/**
 * Pre-flight check on the home page: what generation will bill against.
 * Balance and keys come from the main site; this panel only reads them and
 * points to where they are changed.
 */
import { ArrowUpRightIcon, CheckIcon, MinusIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";

import { useAccount } from "@/lib/account-context";
import type { KeyMetadata } from "@/lib/xy2api-api";
import { cn } from "@/lib/utils";

import { BalanceFigure } from "../account/balance";

type RowState = "ok" | "missing" | "problem";

function keyState(key: KeyMetadata | undefined, selectedId: number | null): RowState {
  if (selectedId === null) return "missing";
  if (!key) return "problem";
  if (key.invalidReason || key.status !== "active") return "problem";
  return "ok";
}

function keyNote(key: KeyMetadata | undefined, selectedId: number | null): string {
  if (selectedId === null) return "未选择";
  if (!key) return "已不在主站列表";
  if (key.invalidReason) return "不可用";
  if (key.status !== "active") return "已停用";
  return key.name || key.maskedKey;
}

export function ReadinessPanel({ className }: { className?: string }) {
  const { account, keys, refreshKeys } = useAccount();
  const requested = useRef(false);

  useEffect(() => {
    if (requested.current || keys.data || keys.loading) return;
    requested.current = true;
    void refreshKeys();
  }, [keys.data, keys.loading, refreshKeys]);

  const prefs = account.data?.preferences;
  const list = keys.data ?? [];
  const imageId = prefs?.image_key_id ?? null;
  const chatId = prefs?.chat_key_id ?? null;
  const imageKey = list.find((k) => k.keyId === imageId);
  const chatKey = list.find((k) => k.keyId === chatId);
  const loadingKeys = !keys.data && !keys.error;
  const imageState = keyState(imageKey, imageId);
  const chatState = keyState(chatKey, chatId);
  // At $0 the main site refuses model discovery, so no chat Key can be picked
  // yet; the server picks one after a recharge. Not a Key problem to fix here.
  const balance = account.data?.balance ?? null;
  const chatWaitsForRecharge = chatId === null && balance !== null && balance.amount <= 0;
  const needsAttention =
    !loadingKeys && (imageState !== "ok" || (chatState !== "ok" && !chatWaitsForRecharge));
  const links = account.data?.links;

  return (
    <section
      aria-label="账户状态"
      className={cn("glass overflow-hidden rounded-[20px]", className)}
      data-slot="readiness"
    >
      <div className="px-5 pt-4 pb-4">
        <p className="poster-label text-[17px] leading-none text-fg">主站余额</p>
        <BalanceFigure
          numeral
          className="mt-3 block text-[56px]"
          emptyLabel={imageId === null ? "未选择 Key" : "暂不可读"}
        />
        <div className="mt-3 flex gap-4 text-[12.5px]">
          {links?.recharge ? (
            <ExternalLink href={links.recharge}>充值</ExternalLink>
          ) : null}
          {links?.usage ? <ExternalLink href={links.usage}>用量明细</ExternalLink> : null}
        </div>
      </div>
      <dl className="divide-y divide-line border-t border-line text-[13px]">
        <Row label="生图 Key" state={loadingKeys ? null : imageState} value={loadingKeys ? null : keyNote(imageKey, imageId)} />
        <Row
          label="对话 Key"
          state={loadingKeys ? null : chatState}
          value={loadingKeys ? null : chatWaitsForRecharge ? "充值后可用" : keyNote(chatKey, chatId)}
        />
      </dl>
      <div className="border-t border-line px-5 py-3">
        <Link
          href="/settings?tab=keys"
          className={cn(
            "text-[13px] font-medium underline-offset-4 hover:underline",
            needsAttention ? "text-alert" : "text-fg",
          )}
        >
          {needsAttention ? "去选择可用的 Key" : "Key 与默认模型"}
        </Link>
      </div>
    </section>
  );
}

function Row({
  label,
  state,
  value,
}: {
  label: string;
  state: RowState | null;
  value: string | null;
}) {
  return (
    <div className="flex items-center gap-3 px-5 py-2.5">
      <dt className="w-[4.5em] shrink-0 text-fg-muted">{label}</dt>
      <dd className="flex min-w-0 flex-1 items-center gap-2">
        {state === null ? (
          <span className="h-3.5 w-24 animate-breathe rounded-full" aria-label="读取中" />
        ) : (
          <>
            <StateGlyph state={state} />
            <span
              className={cn(
                "min-w-0 truncate",
                state === "ok" ? "text-fg" : state === "problem" ? "text-alert" : "text-fg-soft",
              )}
            >
              {value}
            </span>
          </>
        )}
      </dd>
    </div>
  );
}

function StateGlyph({ state }: { state: RowState }) {
  const cls = "size-3.5 shrink-0";
  if (state === "ok") return <CheckIcon className={cn(cls, "text-ok")} strokeWidth={2.25} aria-hidden />;
  if (state === "problem")
    return <TriangleAlertIcon className={cn(cls, "text-alert")} strokeWidth={2} aria-hidden />;
  return <MinusIcon className={cn(cls, "text-fg-muted")} strokeWidth={2} aria-hidden />;
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-0.5 text-fg-soft underline decoration-line-strong underline-offset-4 hover:text-fg"
    >
      {children}
      <ArrowUpRightIcon className="size-3.5" strokeWidth={1.75} />
    </a>
  );
}

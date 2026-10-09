"use client";

/**
 * Which main-site API key pays for what. The list is a synced copy of the
 * user's keys on the main site; secrets never reach the browser. Choosing
 * a key only stores its id in this site's preferences.
 */
import { ArrowUpRightIcon, CopyIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useAccount } from "@/lib/account-context";
import { cn } from "@/lib/utils";
import { type KeyMetadata, formatUsd } from "@/lib/xy2api-api";

import { useIssues } from "../issues/issue-provider";
import { useToast } from "../toast";
import { Button, buttonVariants } from "../ui/button";
import { Picker } from "../ui/select";
import { SettingsSection, Tag } from "./section";

/** Mirrors the server's isKeyUsable(); the server stays the authority. */
export function keyProblem(key: KeyMetadata): string | null {
  if (key.invalidReason === "key_ip_restricted") return "IP 受限";
  if (key.invalidReason) return "不可用";
  if (key.status !== "active") return "已停用";
  if (key.expiresAt && Date.parse(key.expiresAt) <= Date.now()) return "已过期";
  if (key.quota > 0 && key.quotaUsed >= key.quota) return "额度用完";
  return null;
}

export function KeysTab() {
  const { account, keys, config, refreshKeys, syncKeys, updatePreferences } = useAccount();
  const { report } = useIssues();
  const { success } = useToast();
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState<"image" | "chat" | null>(null);
  const requested = useRef(false);

  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    void refreshKeys();
  }, [refreshKeys]);

  const prefs = account.data?.preferences;
  const list = useMemo(() => keys.data ?? [], [keys.data]);
  const links = account.data?.links;
  const egressIp = config?.egressIp ?? "";

  const imageOptions = useMemo(
    () =>
      list
        .filter((k) => k.imageCapable)
        .map((k) => {
          const problem = keyProblem(k);
          return {
            value: String(k.keyId),
            text: k.name || k.maskedKey,
            label: k.name || k.maskedKey,
            description: [k.groupName, problem].filter(Boolean).join(" · ") || k.maskedKey,
            disabled: Boolean(problem),
          };
        }),
    [list],
  );
  const chatOptions = useMemo(
    () =>
      list
        .filter((k) => k.chatModels.length > 0)
        .map((k) => {
          const problem = keyProblem(k);
          return {
            value: String(k.keyId),
            text: k.name || k.maskedKey,
            label: k.name || k.maskedKey,
            description:
              [k.groupName, `${k.chatModels.length} 个对话模型`, problem].filter(Boolean).join(" · "),
            disabled: Boolean(problem),
          };
        }),
    [list],
  );

  const sync = async () => {
    setSyncing(true);
    try {
      await syncKeys();
      success("已从主站同步 Key 列表");
    } catch (error) {
      report(error);
    } finally {
      setSyncing(false);
    }
  };

  const choose = async (kind: "image" | "chat", value: string) => {
    const keyId = Number(value);
    if (!Number.isFinite(keyId)) return;
    setSaving(kind);
    try {
      await updatePreferences(kind === "image" ? { imageKeyId: keyId } : { chatKeyId: keyId });
      success(kind === "image" ? "生图 Key 已切换" : "对话 Key 已切换");
    } catch (error) {
      report(error);
    } finally {
      setSaving(null);
    }
  };

  const copyIp = () => {
    void navigator.clipboard?.writeText(egressIp).then(() => success("已复制出口 IP"));
  };

  const loading = !keys.data && !keys.error;
  const hasIpRestricted = list.some((k) => k.hasIpRestriction);

  return (
    <div>
      <SettingsSection
        title="使用哪个 Key"
        description="生图和对话分别从所选 Key 扣费。可选模型由 Key 所在分组决定，换 Key 后模型列表会跟着变。"
      >
        <div className="grid max-w-xl gap-5 sm:grid-cols-2">
          <KeyPicker
            label="生图 Key"
            hint="只列出所在分组开放了生图的 Key"
            value={prefs?.image_key_id ?? null}
            options={imageOptions}
            loading={loading}
            saving={saving === "image"}
            onChange={(v) => void choose("image", v)}
          />
          <KeyPicker
            label="对话 Key"
            hint="设计助手的对话用这个 Key"
            value={prefs?.chat_key_id ?? null}
            options={chatOptions}
            loading={loading}
            saving={saving === "chat"}
            onChange={(v) => void choose("chat", v)}
          />
        </div>
      </SettingsSection>

      <SettingsSection
        title="主站上的 Key"
        description="这里是主站 Key 的只读副本。新建、停用、改额度或 IP 限制都在主站操作，回来点同步。"
      >
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={sync} disabled={syncing}>
            <RefreshCwIcon className={cn(syncing && "animate-spin")} strokeWidth={1.75} />
            {syncing ? "正在同步" : "从主站同步"}
          </Button>
          {links?.keys ? (
            <a
              href={links.keys}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: "ghost" })}
            >
              去主站管理 Key
              <ArrowUpRightIcon strokeWidth={1.75} />
            </a>
          ) : null}
          {list[0]?.syncedAt ? (
            <span className="ml-auto text-[12px] text-fg-muted tabular">
              上次同步 {new Date(list[0].syncedAt).toLocaleString("zh-CN", { hour12: false })}
            </span>
          ) : null}
        </div>

        {keys.error && !keys.data ? (
          <p className="rounded-md bg-white/[0.05] px-4 py-3 text-[13px] text-fg-soft">
            Key 列表暂时读不到。点「从主站同步」再试一次。
          </p>
        ) : loading ? (
          <div className="space-y-2" aria-label="读取中">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[68px] animate-breathe rounded-md" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line-strong px-5 py-6">
            <p className="text-[14px] text-fg">主站上还没有 Key。</p>
            <p className="mt-1 text-[13px] text-fg-soft">
              在主站创建一个 Key（选择开放生图的分组），回到这里点「从主站同步」。
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line rounded-lg glass">
            {list.map((key) => (
              <KeyRow
                key={key.keyId}
                item={key}
                forImage={prefs?.image_key_id === key.keyId}
                forChat={prefs?.chat_key_id === key.keyId}
              />
            ))}
          </ul>
        )}

        {hasIpRestricted ? (
          <div className="mt-4 rounded-md bg-white/[0.05] px-4 py-3 text-[13px] leading-relaxed text-fg-soft">
            有 Key 设置了 IP 限制。生图请求从本站服务器发出，需要在主站为该 Key 放行
            {egressIp ? (
              <button
                type="button"
                onClick={copyIp}
                className="mx-1 inline-flex items-center gap-1 rounded-sm bg-panel px-1.5 py-0.5 font-mono text-[12px] text-fg hover:text-alert"
              >
                {egressIp}
                <CopyIcon className="size-3" />
              </button>
            ) : (
              "本站出口 IP（请联系管理员获取）"
            )}
            。
          </div>
        ) : null}
      </SettingsSection>
    </div>
  );
}

function KeyPicker({
  label,
  hint,
  value,
  options,
  loading,
  saving,
  onChange,
}: {
  label: string;
  hint: string;
  value: number | null;
  options: Array<{ value: string; text: string; label: string; description: string; disabled: boolean }>;
  loading: boolean;
  saving: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[13px] font-medium text-fg">{label}</p>
      <Picker
        value={value === null ? null : String(value)}
        onValueChange={onChange}
        options={options}
        ariaLabel={label}
        placeholder={loading ? "读取中…" : options.length ? "未选择" : "没有可选的 Key"}
        disabled={loading || saving || options.length === 0}
        className="h-10 w-full"
        popupClassName="w-[var(--anchor-width)] min-w-[260px]"
      />
      <p className="mt-1.5 text-[12px] text-fg-muted">{saving ? "正在保存…" : hint}</p>
    </div>
  );
}

function KeyRow({
  item,
  forImage,
  forChat,
}: {
  item: KeyMetadata;
  forImage: boolean;
  forChat: boolean;
}) {
  const problem = keyProblem(item);
  const capabilities = [
    item.imageCapable ? "生图" : null,
    item.chatModels.length ? `对话 ${item.chatModels.length} 个模型` : null,
  ].filter(Boolean);

  return (
    <li className="grid gap-x-6 gap-y-1.5 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[14px] font-medium text-fg">{item.name || "未命名 Key"}</span>
          <span className="font-mono text-[12px] text-fg-muted">{item.maskedKey}</span>
          {forImage ? <Tag tone="ink">生图在用</Tag> : null}
          {forChat ? <Tag tone="ink">对话在用</Tag> : null}
          {problem ? <Tag tone="marker">{problem}</Tag> : null}
        </div>
        <p className="mt-1 truncate text-[12.5px] text-fg-soft">
          {[item.groupName ?? "未分组", item.platform, capabilities.join("、") || "无可用能力"]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-fg-muted sm:justify-end sm:text-right">
        {/* quota/quotaUsed are USD like the balance and quota <= 0 means no
            limit (xy2api source 9717116f1); the deployed main site's version
            is still to be checked when it is connected. */}
        <span className="tabular">
          {item.quota > 0
            ? `额度 ${formatUsd(item.quotaUsed)} / ${formatUsd(item.quota)}`
            : "额度不限"}
        </span>
        <span className="tabular">
          {item.expiresAt
            ? `到期 ${new Date(item.expiresAt).toLocaleDateString("zh-CN")}`
            : "长期有效"}
        </span>
        {item.hasIpRestriction ? <span>有 IP 限制</span> : null}
      </div>
    </li>
  );
}

"use client";

/**
 * Which main-site API keys pay for what. The list is a synced copy of the
 * user's keys on the main site; secrets never reach the browser. Choosing
 * only stores ids in this site's preferences.
 *
 * 生图 (第 56 条): every key that can make images is used at once, all on by
 * default; the studio and canvas list the models of all of them, grouped by
 * key. A switch takes a key out (`disabledImageKeyIds`); one stays on. The
 * 默认 key is the one the header balance reads and whose models come first.
 * 对话 still uses one key.
 */
import { ArrowUpRightIcon, CopyIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAccount } from "@/lib/account-context";
import { cn } from "@/lib/utils";
import { type KeyMetadata, formatUsd } from "@/lib/xy2api-api";

import { useIssues } from "../issues/issue-provider";
import { useToast } from "../toast";
import { Button, buttonVariants } from "../ui/button";
import { Picker } from "../ui/select";
import { Switch } from "../ui/switch";
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

/** Why a key offers neither images nor chat, in words the user can act on. */
function unavailableReason(key: KeyMetadata): string {
  if (key.groupRemoved) return "到主站给这个 Key 换个分组后可用";
  // Main-site Claude groups serve /v1/messages for Claude Code only (403) or
  // do not answer OpenAI-style chat; the assistant speaks OpenAI chat.
  // TODO: offer them to the assistant if the main site opens chat on them.
  if (key.platform === "anthropic") return "Claude 分组暂不支持";
  return "无可用能力";
}

export function KeysTab() {
  const { account, keys, config, refreshKeys, syncKeys, updatePreferences } = useAccount();
  const { report } = useIssues();
  const { success } = useToast();
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState<"image" | "chat" | null>(null);
  const requested = useRef(false);
  // Sent to the main site to add a key: sync once when the tab comes back.
  const awaitingReturn = useRef(false);

  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    void refreshKeys();
  }, [refreshKeys]);

  const prefs = account.data?.preferences;
  const list = useMemo(() => keys.data ?? [], [keys.data]);
  const links = account.data?.links;
  const egressIp = config?.egressIp ?? "";

  const imageKeys = useMemo(() => list.filter((k) => k.imageCapable), [list]);
  const disabledIds = useMemo(
    () => new Set(prefs?.disabled_image_key_ids ?? []),
    [prefs?.disabled_image_key_ids],
  );
  const enabledUsable = imageKeys.filter((k) => !keyProblem(k) && !disabledIds.has(k.keyId));
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

  const sync = useCallback(
    async (quiet = false) => {
      setSyncing(true);
      try {
        await syncKeys();
        if (!quiet) success("已从主站同步 Key 列表");
      } catch (error) {
        report(error);
      } finally {
        setSyncing(false);
      }
    },
    [report, success, syncKeys],
  );

  // Back from adding a key on the main site: pick it up without a click.
  useEffect(() => {
    const back = () => {
      if (!awaitingReturn.current || document.visibilityState !== "visible") return;
      awaitingReturn.current = false;
      console.info("[settings] back from the main site: syncing keys");
      void sync(true);
    };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    return () => {
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("focus", back);
    };
  }, [sync]);

  const toggleImageKey = async (keyId: number, on: boolean) => {
    const next = new Set(disabledIds);
    if (on) next.delete(keyId);
    else next.add(keyId);
    setSaving("image");
    try {
      await updatePreferences({ disabledImageKeyIds: [...next].sort((a, b) => a - b) });
      success(on ? "已用这个 Key 生图" : "这个 Key 不再用于生图");
      console.info("[settings] image key", { keyId, on });
    } catch (error) {
      report(error);
    } finally {
      setSaving(null);
    }
  };

  const choose = async (kind: "image" | "chat", value: string) => {
    const keyId = Number(value);
    if (!Number.isFinite(keyId)) return;
    setSaving(kind);
    try {
      await updatePreferences(kind === "image" ? { imageKeyId: keyId } : { chatKeyId: keyId });
      success(kind === "image" ? "默认生图 Key 已切换" : "对话 Key 已切换");
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
        title="生图用哪些 Key"
        description="打开的 Key 里的生图模型，都能在生图页和画布里选用。"
      >
        <ImageKeyList
          keys={imageKeys}
          disabledIds={disabledIds}
          defaultId={prefs?.image_key_id ?? null}
          loading={loading}
          saving={saving === "image"}
          lastOn={enabledUsable.length <= 1}
          onToggle={(keyId, on) => void toggleImageKey(keyId, on)}
          onMakeDefault={(keyId) => void choose("image", String(keyId))}
        />
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          {links?.keys ? (
            <a
              href={links.keys}
              target="_blank"
              rel="noreferrer"
              onClick={() => {
                awaitingReturn.current = true;
              }}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <PlusIcon strokeWidth={2} />
              添加 Key
            </a>
          ) : null}
          <span className="text-[12.5px] text-fg-muted">
            在主站新建（选开放生图的分组），回到这页会自动同步。
          </span>
        </div>
      </SettingsSection>

      <SettingsSection
        title="对话用哪个 Key"
        description="设计助手对话用的 Key，能选哪些对话模型由它决定。"
      >
        <div className="grid max-w-xl gap-5 sm:grid-cols-2">
          <KeyPicker
            label="对话 Key"
            hint=""
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
        description="新建、停用或改额度都在主站操作，回来点同步。"
      >
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => void sync()} disabled={syncing}>
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
          <p className="rounded-md bg-tint/[0.05] px-4 py-3 text-[13px] text-fg-soft">
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
                forImage={key.imageCapable && !keyProblem(key) && !disabledIds.has(key.keyId)}
                forChat={prefs?.chat_key_id === key.keyId}
              />
            ))}
          </ul>
        )}

        {hasIpRestricted ? (
          <div className="mt-4 rounded-md bg-tint/[0.05] px-4 py-3 text-[13px] leading-relaxed text-fg-soft">
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

/**
 * Image keys as switches. A key with a problem can't be switched on; the
 * last key on can't be switched off (the server refuses it too).
 */
function ImageKeyList({
  keys,
  disabledIds,
  defaultId,
  loading,
  saving,
  lastOn,
  onToggle,
  onMakeDefault,
}: {
  keys: KeyMetadata[];
  disabledIds: ReadonlySet<number>;
  defaultId: number | null;
  loading: boolean;
  saving: boolean;
  lastOn: boolean;
  onToggle: (keyId: number, on: boolean) => void;
  onMakeDefault: (keyId: number) => void;
}) {
  if (loading)
    return (
      <div className="max-w-2xl space-y-2" aria-label="读取中">
        {[0, 1].map((i) => (
          <div key={i} className="h-[60px] animate-breathe rounded-lg" />
        ))}
      </div>
    );
  if (keys.length === 0)
    return (
      <p className="max-w-2xl rounded-lg border border-dashed border-line-strong px-4 py-3.5 text-[13px] text-fg-soft">
        还没有能生图的 Key。到主站新建一个（选开放生图的分组），再回来。
      </p>
    );
  return (
    <ul aria-label="生图 Key" className="max-w-2xl divide-y divide-line overflow-hidden rounded-lg glass">
      {keys.map((key) => {
        const problem = keyProblem(key);
        const on = !problem && !disabledIds.has(key.keyId);
        const isDefault = on && key.keyId === defaultId;
        const label = key.name || key.maskedKey;
        return (
          <li
            key={key.keyId}
            className={cn(
              "flex items-center gap-3.5 px-4 py-3 transition-colors",
              !on && "bg-tint/[0.025]",
            )}
          >
            <Switch
              checked={on}
              disabled={saving || Boolean(problem) || (on && lastOn)}
              onCheckedChange={(checked) => onToggle(key.keyId, checked)}
              aria-label={`用 ${label} 生图`}
            />
            <div className={cn("min-w-0 flex-1", !on && "opacity-60")}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-[14px] font-medium text-fg">{label}</span>
                {isDefault ? <Tag tone="ink">默认</Tag> : null}
                {problem ? <Tag tone="marker">{problem}</Tag> : null}
              </div>
              <p className="mt-0.5 truncate text-[12.5px] text-fg-soft">
                {[
                  // The group name is left out (第 62 条): next to the key's own name it repeats it.
                  key.imageModels.length ? `${key.imageModels.length} 个生图模型` : "没有生图模型",
                  on && lastOn ? "至少留一个开着" : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            {on && !isDefault ? (
              <button
                type="button"
                onClick={() => onMakeDefault(key.keyId)}
                disabled={saving}
                title="顶栏余额读这个 Key，它的模型排在最前"
                className="shrink-0 rounded-md px-2 py-1 text-[12.5px] font-semibold text-fg-soft transition-colors hover:bg-tint/[0.07] hover:text-fg disabled:opacity-50"
              >
                设为默认
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
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
      {saving || hint ? <p className="mt-1.5 text-[12px] text-fg-muted">{saving ? "正在保存…" : hint}</p> : null}
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
          {forImage ? <Tag tone="ink">生图</Tag> : null}
          {forChat ? <Tag tone="ink">对话</Tag> : null}
          {problem ? <Tag tone="marker">{problem}</Tag> : null}
        </div>
        <p className="mt-1 truncate text-[12.5px] text-fg-soft">
          {[
            item.groupName ?? (item.groupRemoved ? "分组已停用" : "未分组"),
            item.platform,
            capabilities.join("、") || unavailableReason(item),
          ]
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

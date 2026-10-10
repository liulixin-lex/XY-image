"use client";

/**
 * Settings › 模型 › 对话模型服务商: the user's own OpenAI-compatible
 * providers for the design agent's chat (plan §6, D1–D5). Images stay on
 * the main site; chats on these providers are billed by the provider.
 *
 * Every change re-reads the chat model list so the default-model picker
 * and the canvas selector see it at once. Keys are write-only: rows show
 * only `keyHint`.
 */
import { PencilIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAccount } from "@/lib/account-context";
import { useAuth } from "@/lib/auth-context";
import { formErrorFor, providerStatusLabel } from "@/lib/chat-provider-form";
import {
  CHAT_PROVIDER_LIMITS,
  type ChatProvider,
  deleteChatProvider,
  fetchChatProviders,
  isEndpointMissing,
  refreshChatProviderModels,
  updateChatProvider,
} from "@/lib/chat-providers-api";
import { ApiApplicationError, ApiAuthError } from "@/lib/server-api";
import { cn } from "@/lib/utils";

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
import { Switch } from "../ui/switch";
import { ChatProviderDialog, type ProviderDialogTarget } from "./chat-provider-dialog";
import { SettingsSection, Tag } from "./section";

type ListState =
  | { status: "loading" }
  | { status: "ready"; providers: ChatProvider[] }
  /** The server has no provider endpoints yet. */
  | { status: "missing" }
  | { status: "error" };

type Busy = { id: string; action: "refresh" | "toggle" | "delete" } | null;

/** Section anchor; the issue center links to `/settings?tab=models#chat-providers`. */
const ANCHOR = "chat-providers";

export function ChatProvidersSection({ defaultProviderId }: { defaultProviderId: string | null }) {
  const { session } = useAuth();
  const { refreshChatModels, refreshAccount } = useAccount();
  const { success, show } = useToast();
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [busy, setBusy] = useState<Busy>(null);
  const [dialog, setDialog] = useState<ProviderDialogTarget | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ChatProvider | null>(null);
  const tokenRef = useRef(session?.access_token);
  tokenRef.current = session?.access_token;

  const load = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) return;
    setList({ status: "loading" });
    try {
      setList({ status: "ready", providers: await fetchChatProviders(token) });
    } catch (error) {
      if (error instanceof ApiAuthError) return;
      if (isEndpointMissing(error)) {
        console.info("[chat-provider] server has no /api/chat-providers yet");
        setList({ status: "missing" });
        return;
      }
      console.warn("[chat-provider] list failed", error);
      setList({ status: "error" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The settings page renders after hydration, so the browser's own jump to
  // `#chat-providers` finds nothing. Jump once the list has settled and the
  // section has its final height.
  const jumped = useRef(false);
  useEffect(() => {
    if (jumped.current || list.status === "loading") return;
    jumped.current = true;
    if (window.location.hash !== `#${ANCHOR}`) return;
    requestAnimationFrame(() =>
      document.getElementById(ANCHOR)?.scrollIntoView({ block: "start" }),
    );
  }, [list.status]);

  const replace = (provider: ChatProvider) =>
    setList((prev) =>
      prev.status !== "ready"
        ? prev
        : {
            status: "ready",
            providers: prev.providers.some((p) => p.id === provider.id)
              ? prev.providers.map((p) => (p.id === provider.id ? provider : p))
              : [...prev.providers, provider],
          },
    );

  const toastError = (error: unknown, title: string) => {
    if (error instanceof ApiAuthError) return;
    const code = error instanceof ApiApplicationError ? error.code : "application_error";
    const message = error instanceof ApiApplicationError ? error.message : null;
    if (code === "provider_not_found") void load();
    show({
      variant: "error",
      title,
      message: formErrorFor(code, message, { editingWithoutNewKey: true }).message,
    });
  };

  const refreshModels = async (provider: ChatProvider) => {
    const token = tokenRef.current;
    if (!token || busy) return;
    setBusy({ id: provider.id, action: "refresh" });
    try {
      const next = await refreshChatProviderModels(token, provider.id);
      replace(next);
      void refreshChatModels();
      success(`「${next.name}」的模型列表已更新：${next.models.length} 个`);
    } catch (error) {
      // The server records lastError on the row; show it right away.
      if (error instanceof ApiApplicationError && error.code.startsWith("provider_"))
        replace({ ...provider, lastError: error.code, lastCheckedAt: new Date().toISOString() });
      toastError(error, "模型列表没有更新");
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (provider: ChatProvider, enabled: boolean) => {
    const token = tokenRef.current;
    if (!token || busy) return;
    setBusy({ id: provider.id, action: "toggle" });
    try {
      replace(await updateChatProvider(token, provider.id, { enabled }));
      void refreshChatModels();
      console.info("[chat-provider] toggled", provider.id, enabled);
      if (!enabled && provider.id === defaultProviderId)
        show({
          variant: "info",
          title: `已停用「${provider.name}」`,
          message: "它的模型是现在的默认对话模型，记得在上面换一个默认模型。",
        });
    } catch (error) {
      toastError(error, enabled ? "没能启用" : "没能停用");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (provider: ChatProvider) => {
    const token = tokenRef.current;
    if (!token || busy) return;
    setBusy({ id: provider.id, action: "delete" });
    try {
      await deleteChatProvider(token, provider.id);
      console.info("[chat-provider] deleted", provider.id);
      setList((prev) =>
        prev.status === "ready"
          ? { status: "ready", providers: prev.providers.filter((p) => p.id !== provider.id) }
          : prev,
      );
      setConfirmDelete(null);
      // The server clears the default if it pointed here; pick that up too.
      void refreshChatModels();
      if (provider.id === defaultProviderId) void refreshAccount({ force: true });
      success(`已删除「${provider.name}」`);
    } catch (error) {
      toastError(error, "没能删除");
    } finally {
      setBusy(null);
    }
  };

  const onSaved = (provider: ChatProvider, info: { created: boolean; close: boolean }) => {
    replace(provider);
    void refreshChatModels();
    if (!info.close) return;
    setDialog(null);
    success(
      info.created
        ? `已添加「${provider.name}」：${provider.models.length} 个模型`
        : `「${provider.name}」已保存`,
    );
  };

  const providers = list.status === "ready" ? list.providers : [];
  const full = providers.length >= CHAT_PROVIDER_LIMITS.providers;

  return (
    <SettingsSection
      id={ANCHOR}
      title="对话模型服务商"
      description="接入你自己的 OpenAI 兼容服务，给设计助手对话用。用你自己的服务商时，对话费用由该服务商收取，不从主站余额扣。生图仍走主站。"
    >
      {list.status === "loading" ? (
        <div className="space-y-2" aria-label="读取中">
          {[0, 1].map((i) => (
            <div key={i} className="h-[76px] animate-breathe rounded-md" />
          ))}
        </div>
      ) : list.status === "missing" ? (
        <p className="max-w-xl rounded-md bg-tint/[0.05] px-4 py-3 text-[13px] leading-relaxed text-fg-soft">
          服务器暂时还不支持接入自己的服务商。现在对话都走主站的对话 Key。
        </p>
      ) : list.status === "error" ? (
        <div className="flex max-w-xl flex-wrap items-center gap-3 rounded-md bg-tint/[0.05] px-4 py-3 text-[13px] text-fg-soft">
          服务商列表暂时读不到。
          <Button variant="outline" size="sm" onClick={() => void load()}>
            重试
          </Button>
        </div>
      ) : providers.length === 0 ? (
        <div className="max-w-xl rounded-lg border border-dashed border-line-strong px-5 py-6">
          <p className="text-[14px] text-fg">还没有接入自己的服务商。</p>
          <p className="mt-1 text-[13px] leading-relaxed text-fg-soft">
            填写 OpenAI 兼容接口的地址和 API Key，模型列表会自动读取；读不到时可以手动填写模型名。
          </p>
          <Button className="mt-4" onClick={() => setDialog({ kind: "create" })}>
            <PlusIcon strokeWidth={1.75} />
            添加服务商
          </Button>
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              onClick={() => setDialog({ kind: "create" })}
              disabled={full}
            >
              <PlusIcon strokeWidth={1.75} />
              添加服务商
            </Button>
            <span className="text-[12px] text-fg-muted tabular">
              {full
                ? `已达上限 ${CHAT_PROVIDER_LIMITS.providers} 个`
                : `${providers.length} / ${CHAT_PROVIDER_LIMITS.providers}`}
            </span>
          </div>
          <ul className="divide-y divide-line rounded-lg glass">
            {providers.map((provider) => (
              <ProviderRow
                key={provider.id}
                provider={provider}
                isDefault={provider.id === defaultProviderId}
                busy={busy?.id === provider.id ? busy.action : null}
                locked={busy !== null}
                onRefresh={() => void refreshModels(provider)}
                onToggle={(enabled) => void toggle(provider, enabled)}
                onEdit={() => setDialog({ kind: "edit", provider })}
                onDelete={() => setConfirmDelete(provider)}
              />
            ))}
          </ul>
        </>
      )}

      <ChatProviderDialog target={dialog} onClose={() => setDialog(null)} onSaved={onSaved} />

      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(next) => !next && busy?.action !== "delete" && setConfirmDelete(null)}
      >
        <DialogContent className="sm:max-w-md">
          {confirmDelete ? (
            <>
              <DialogHeader>
                <DialogTitle>删除「{confirmDelete.name}」？</DialogTitle>
                <DialogDescription className="text-[13.5px] leading-relaxed text-fg-soft">
                  保存的 API Key 会一起删除，无法找回。
                  {confirmDelete.id === defaultProviderId
                    ? "它是现在的默认对话模型，删除后默认会改回主站。"
                    : "画布里如果选了它的模型，会改回默认模型。"}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setConfirmDelete(null)}
                  disabled={busy?.action === "delete"}
                >
                  取消
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => void remove(confirmDelete)}
                  disabled={busy?.action === "delete"}
                >
                  {busy?.action === "delete" ? "正在删除…" : "删除"}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}

function hostOf(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    return url.host + (url.pathname === "/" ? "" : url.pathname);
  } catch {
    return baseUrl;
  }
}

function ProviderRow({
  provider,
  isDefault,
  busy,
  locked,
  onRefresh,
  onToggle,
  onEdit,
  onDelete,
}: {
  provider: ChatProvider;
  isDefault: boolean;
  busy: "refresh" | "toggle" | "delete" | null;
  locked: boolean;
  onRefresh: () => void;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const status = providerStatusLabel(provider.lastError);
  return (
    <li className="grid gap-x-6 gap-y-3 px-4 py-3.5 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[14px] font-medium text-fg">{provider.name}</span>
          {isDefault ? <Tag tone="ink">默认对话</Tag> : null}
          {!provider.enabled ? <Tag tone="quiet">已停用</Tag> : null}
          {status ? <Tag tone="marker">{status}</Tag> : null}
        </div>
        {/* The dot belongs to the item before it, so a wrapped line never starts with one. */}
        <p className="mt-1 flex flex-wrap gap-x-2 text-[12.5px] text-fg-soft [&>span:not(:last-child)]:after:ml-2 [&>span:not(:last-child)]:after:text-fg-muted [&>span:not(:last-child)]:after:content-['·']">
          <span className="min-w-0 break-all font-mono text-[12px]">{hostOf(provider.baseUrl)}</span>
          <span>
            Key 末 4 位 <span className="font-mono text-[12px] text-fg">{provider.keyHint}</span>
          </span>
          {provider.lastCheckedAt ? (
            <span className="tabular text-fg-muted">
              {status ? "检查于" : "模型读取于"}{" "}
              {new Date(provider.lastCheckedAt).toLocaleString("zh-CN", {
                hour12: false,
                month: "numeric",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          ) : null}
        </p>
        <details className="group/models mt-1.5">
          <summary className="w-fit cursor-pointer list-none rounded-sm text-[12.5px] text-fg-muted outline-none hover:text-fg focus-visible:outline-2 focus-visible:outline-acc [&::-webkit-details-marker]:hidden">
            <span className="group-open/models:hidden">查看</span>
            <span className="hidden group-open/models:inline">收起</span>{" "}
            {provider.models.length} 个模型
            {provider.modelsSource === "manual" ? "（手动填写）" : ""}
          </summary>
          <ul className="mt-2 flex max-h-36 flex-wrap gap-1.5 overflow-y-auto pr-1">
            {provider.models.map((model) => (
              <li
                key={model}
                className="rounded-sm bg-tint/[0.06] px-1.5 py-0.5 font-mono text-[11.5px] text-fg-soft"
              >
                {model}
              </li>
            ))}
          </ul>
        </details>
      </div>

      <div className="flex flex-wrap items-center gap-1 md:justify-end">
        {/* Base UI's Switch is a span with a hidden input; it carries its own label. */}
        <span className="mr-2 inline-flex items-center gap-2 text-[12.5px] text-fg-soft">
          <Switch
            checked={provider.enabled}
            onCheckedChange={(checked) => onToggle(checked)}
            disabled={locked}
            aria-label={`启用「${provider.name}」`}
          />
          <span aria-hidden>{busy === "toggle" ? "正在保存" : "启用"}</span>
        </span>
        {provider.modelsSource === "fetched" ? (
          <Button variant="ghost" size="sm" onClick={onRefresh} disabled={locked}>
            <RefreshCwIcon
              className={cn(busy === "refresh" && "animate-spin motion-reduce:animate-none")}
              strokeWidth={1.75}
            />
            {busy === "refresh" ? "正在读取" : "刷新模型"}
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" onClick={onEdit} disabled={locked}>
          <PencilIcon strokeWidth={1.75} />
          编辑
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          disabled={locked}
          className="hover:bg-alert-wash hover:text-alert"
        >
          <Trash2Icon strokeWidth={1.75} />
          删除
        </Button>
      </div>
    </li>
  );
}

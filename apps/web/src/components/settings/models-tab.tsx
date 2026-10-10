"use client";

/**
 * Default models, plus the user's own chat providers. The image list depends
 * on the selected image key; the chat list merges the chat key's models with
 * the user's providers (lib/chat-models.ts).
 *
 * The default chat model lives only in account preferences (bare model +
 * provider id; null = main site); the agent runtime resolves it from there
 * (model-resolver.ts). The old workspace `default_model` is no longer read.
 */
import Link from "next/link";
import { useMemo, useState } from "react";

import { useAccount, useChatModels, useImageModels } from "@/lib/account-context";
import {
  type ChatModel,
  chatBillingNote,
  chatPreferencePatch,
  groupChatModels,
  preferredChatModelId,
} from "@/lib/chat-models";
import { describeIssue } from "@/lib/generation-errors";
import { describeCapabilities, modelCapabilities } from "@/lib/image-model-meta";

import { useIssues } from "../issues/issue-provider";
import { useToast } from "../toast";
import { type PickerOption, Picker } from "../ui/select";
import { ChatProvidersSection } from "./chat-providers-section";
import { SettingsSection } from "./section";

export function ModelsTab() {
  const { account, updatePreferences } = useAccount();
  const image = useImageModels();
  const chat = useChatModels();
  const { report } = useIssues();
  const { success } = useToast();
  const [saving, setSaving] = useState<"image" | "chat" | null>(null);

  const prefs = account.data?.preferences;
  const imageModels = useMemo(() => image.data ?? [], [image.data]);
  const chatModels = useMemo(() => chat.data ?? [], [chat.data]);

  const currentChat = preferredChatModelId(prefs);
  const chatSelected = chatModels.find((m) => m.id === currentChat) ?? null;
  const chatOptions = useMemo(() => chatPickerOptions(chatModels), [chatModels]);
  const imageValue =
    prefs?.default_image_model && imageModels.some((m) => m.id === prefs.default_image_model)
      ? prefs.default_image_model
      : null;

  const saveImage = async (id: string) => {
    setSaving("image");
    try {
      await updatePreferences({ defaultImageModel: id });
      success("默认生图模型已保存");
    } catch (error) {
      report(error);
    } finally {
      setSaving(null);
    }
  };

  const saveChat = async (id: string) => {
    const patch = chatPreferencePatch(id, prefs);
    if (!patch) {
      console.warn("[settings] unrecognised chat model id", id);
      return;
    }
    setSaving("chat");
    try {
      await updatePreferences(patch);
      success("默认对话模型已保存");
    } catch (error) {
      report(error);
    } finally {
      setSaving(null);
    }
  };

  return (
    <div>
      <SettingsSection
        title="默认生图模型"
        description="生图页和画布生成面板默认选中的模型。每次生成前仍可临时更换。"
      >
        <ModelPickerBlock
          error={image.error}
          loading={image.loading && imageModels.length === 0}
          empty={imageModels.length === 0}
          emptyText="当前生图 Key 没有可用的生图模型。"
        >
          <Picker
            value={imageValue}
            onValueChange={(v) => void saveImage(v)}
            options={imageModels.map((m) => ({
              value: m.id,
              text: m.displayName,
              label: m.displayName,
              description: `${m.description} · ${describeCapabilities(modelCapabilities(m))}`,
            }))}
            ariaLabel="默认生图模型"
            placeholder="未设置（使用列表第一个）"
            disabled={saving === "image"}
            className="h-10 w-full max-w-sm"
            popupClassName="w-[340px]"
          />
          <ul className="mt-6 max-w-xl divide-y divide-line border-y border-line">
            {imageModels.map((m) => (
              <li key={m.id} className="flex items-center gap-4 py-2.5 text-[13px]">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-fg">{m.displayName}</span>
                  <span className="block truncate text-[12px] text-fg-muted">{m.description}</span>
                </span>
                <span className="data-label shrink-0 text-fg-soft">
                  {describeCapabilities(modelCapabilities(m))}
                </span>
              </li>
            ))}
          </ul>
        </ModelPickerBlock>
      </SettingsSection>

      <SettingsSection
        title="默认对话模型"
        description="设计助手默认使用的对话模型。画布里可以按会话临时更换。"
      >
        <ModelPickerBlock
          // Older servers fail the whole list without a chat key; newer ones
          // still list the user's providers and only flag the main site.
          error={chat.error ?? (chatModels.length === 0 ? chat.xy2apiError : null)}
          loading={chat.loading && chatModels.length === 0}
          empty={chatModels.length === 0}
          emptyText="当前对话 Key 没有可用的对话模型。"
        >
          {chat.xy2apiError ? (
            <p className="mb-3 max-w-xl text-[13px] leading-relaxed text-fg-soft">
              主站的对话模型暂时用不了（{describeIssue(chat.xy2apiError, null).title}），下面只列出你自己的服务商。
              <Link href="/settings?tab=keys" className="ml-0.5 text-fg underline underline-offset-4">
                检查对话 Key
              </Link>
            </p>
          ) : null}
          <Picker
            value={chatSelected?.id ?? null}
            onValueChange={(v) => void saveChat(v)}
            options={chatOptions}
            ariaLabel="默认对话模型"
            placeholder="未设置（使用列表第一个）"
            disabled={saving === "chat"}
            className="h-10 w-full max-w-sm"
            popupClassName="w-[320px]"
          />
          {chatSelected ? (
            <p className="mt-2 text-[12px] text-fg-muted">{chatBillingNote(chatSelected)}。</p>
          ) : null}
        </ModelPickerBlock>
      </SettingsSection>

      <ChatProvidersSection defaultProviderId={prefs?.default_chat_provider_id ?? null} />
    </div>
  );
}

/**
 * Flat list when everything is from the main site (as before); grouped by
 * source with the billing side named once the user has providers.
 */
function chatPickerOptions(models: ChatModel[]): PickerOption[] {
  const groups = groupChatModels(models);
  const grouped = groups.some((group) => group.source === "custom");
  return groups.flatMap((group) =>
    group.models.map((m) => ({
      value: m.id,
      text: m.name,
      label: m.name,
      ...(grouped
        ? {
            group: {
              key: group.key,
              label:
                group.source === "custom"
                  ? `${group.label} · 由服务商收费`
                  : "主站 · 从主站余额扣",
            },
          }
        : {}),
    })),
  );
}

function ModelPickerBlock({
  error,
  loading,
  empty,
  emptyText,
  children,
}: {
  error: string | null;
  loading: boolean;
  empty: boolean;
  emptyText: string;
  children: React.ReactNode;
}) {
  if (error) {
    const spec = describeIssue(error, null);
    return (
      <p className="max-w-xl rounded-md bg-tint/[0.05] px-4 py-3 text-[13px] leading-relaxed text-fg-soft">
        {spec.title}。
        <Link href="/settings?tab=keys" className="ml-0.5 text-fg underline underline-offset-4">
          先选择 Key
        </Link>
      </p>
    );
  }
  if (loading) return <div className="h-10 max-w-sm animate-breathe rounded-md" aria-label="读取中" />;
  if (empty) return <p className="text-[13px] text-fg-soft">{emptyText}</p>;
  return <>{children}</>;
}

"use client";

/**
 * Default models, plus the user's own chat providers. The image list holds
 * the models of every image key that is on, grouped by key (第 56 条); the
 * default is a (key, model) pair. The chat list merges the chat key's models
 * with the user's providers (lib/chat-models.ts).
 *
 * The default chat model lives only in account preferences (bare model +
 * provider id; null = main site); the agent runtime resolves it from there
 * (model-resolver.ts). The old workspace `default_model` is no longer read.
 */
import {
  CHAT_EFFORT_HINT,
  CHAT_EFFORT_LABEL,
  chatEffortsFor,
  executionEffortFor,
  parseChatModelRef,
} from "@loomic/shared";
import Link from "next/link";
import { useMemo, useState } from "react";

import { useAccount, useChatModels, useImageModels } from "@/lib/account-context";
import {
  type ChatModel,
  chatPreferencePatch,
  groupChatModels,
  preferredChatModelId,
} from "@/lib/chat-models";
import { describeIssue } from "@/lib/generation-errors";
import { modelNote } from "@/lib/image-model-meta";
import {
  findModel,
  imageModelOptions,
  keyLabel,
  modelRef,
  spansSeveralKeys,
} from "@/lib/image-model-ref";

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
  const [saving, setSaving] = useState<"image" | "chat" | "exec" | null>(null);

  const prefs = account.data?.preferences;
  const imageModels = useMemo(() => image.data ?? [], [image.data]);
  const chatModels = useMemo(() => chat.data ?? [], [chat.data]);

  const currentChat = preferredChatModelId(prefs);
  const chatSelected = chatModels.find((m) => m.id === currentChat) ?? null;
  const chatOptions = useMemo(() => chatPickerOptions(chatModels), [chatModels]);
  const imageDefault = prefs?.default_image_model
    ? findModel(imageModels, { id: prefs.default_image_model, keyId: prefs.image_key_id })
    : null;
  const imageValue = imageDefault ? modelRef(imageDefault) : null;
  const severalKeys = spansSeveralKeys(imageModels);

  const saveImage = async (ref: string) => {
    const picked = findModel(imageModels, ref);
    if (!picked) return;
    setSaving("image");
    try {
      // The default key moves with the model when it is on another key.
      await updatePreferences(
        picked.keyId && picked.keyId !== prefs?.image_key_id
          ? { imageKeyId: picked.keyId, defaultImageModel: picked.id }
          : { defaultImageModel: picked.id },
      );
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

  // 第 70 条 执行步骤模型: the model and level of the steps after a tool
  // result. Unset = the chat model at 低 (the server applies the same rule).
  const execModelId = prefs?.agent_exec_model ?? null;
  const execSelected = execModelId ? (chatModels.find((m) => m.id === execModelId) ?? null) : null;
  const execRef = parseChatModelRef(execModelId ?? currentChat ?? "") ?? null;
  const execEffort = executionEffortFor(execRef, prefs?.agent_exec_effort);
  const execEfforts = chatEffortsFor(execRef);
  const saveExec = async (patch: { agentExecModel?: string | null; agentExecEffort?: string | null }) => {
    setSaving("exec");
    try {
      await updatePreferences(patch);
      success("执行步骤设置已保存");
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
          emptyText="开着的生图 Key 里没有可用的生图模型。"
        >
          <Picker
            value={imageValue}
            onValueChange={(v) => void saveImage(v)}
            options={imageModelOptions(imageModels)}
            ariaLabel="默认生图模型"
            placeholder="未设置（使用列表第一个）"
            disabled={saving === "image"}
            className="h-10 w-full max-w-sm"
            popupClassName="w-[340px]"
          />
          <ul className="mt-6 max-w-xl divide-y divide-line border-y border-line">
            {imageModels.map((m) => {
              const note = modelNote(m.id);
              return (
                <li key={modelRef(m)} className="flex items-baseline gap-3 py-2.5 text-[13px]">
                  <span className="min-w-0 truncate font-medium text-fg">{m.displayName}</span>
                  {note ? <span className="shrink-0 text-[12px] text-fg-muted">{note}</span> : null}
                  {severalKeys ? (
                    <span className="ml-auto shrink-0 truncate pl-3 text-[12px] text-fg-muted">{keyLabel(m)}</span>
                  ) : null}
                </li>
              );
            })}
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
        </ModelPickerBlock>
      </SettingsSection>

      <SettingsSection
        title="执行步骤模型"
        description="设计助手读懂需求后，每一步执行（调用工具之后）用的模型和思考强度。不设置时用对话模型，思考强度「低」，回得更快。"
      >
        <ModelPickerBlock
          error={chat.error ?? (chatModels.length === 0 ? chat.xy2apiError : null)}
          loading={chat.loading && chatModels.length === 0}
          empty={chatModels.length === 0}
          emptyText="当前对话 Key 没有可用的对话模型。"
        >
          {prefs && !("agent_exec_model" in prefs) ? (
            <p className="max-w-xl text-[13px] text-fg-soft">服务器还不支持这项设置。</p>
          ) : (
            <div className="flex max-w-xl flex-wrap items-center gap-3">
              <Picker
                value={execSelected?.id ?? SAME_AS_CHAT}
                onValueChange={(v) => void saveExec({ agentExecModel: v === SAME_AS_CHAT ? null : v })}
                options={[
                  { value: SAME_AS_CHAT, text: "跟随对话模型", label: "跟随对话模型" },
                  ...chatOptions,
                ]}
                ariaLabel="执行步骤模型"
                disabled={saving === "exec"}
                className="h-10 w-full max-w-sm"
                popupClassName="w-[320px]"
              />
              <Picker
                value={execEffort}
                onValueChange={(v) => void saveExec({ agentExecEffort: v })}
                options={execEfforts.map((e) => ({
                  value: e,
                  text: CHAT_EFFORT_LABEL[e],
                  label: CHAT_EFFORT_LABEL[e],
                }))}
                ariaLabel="执行步骤思考强度"
                disabled={saving === "exec" || execEfforts.length <= 1}
                className="h-10 w-28"
                popupClassName="w-[160px]"
              />
              <p className="w-full text-[12.5px] leading-relaxed text-fg-muted">
                {execEfforts.length <= 1
                  ? "这个模型的思考强度由主站决定，执行步骤用「自动」。"
                  : execEffort === "auto"
                    ? "执行步骤不指定思考强度，由模型自己决定。"
                    : `执行步骤：${CHAT_EFFORT_HINT[execEffort]}。`}
                {execModelId && !execSelected ? " 选的模型现在不可用，执行步骤会改用对话模型。" : ""}
              </p>
            </div>
          )}
        </ModelPickerBlock>
      </SettingsSection>

      <ChatProvidersSection defaultProviderId={prefs?.default_chat_provider_id ?? null} />
    </div>
  );
}

const SAME_AS_CHAT = "__same_as_chat__";

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
              label: group.source === "custom" ? group.label : "主站",
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

"use client";

/**
 * Chat model for the design agent. Lists the chat key's models
 * (`openai:<model>`) and, when the user has added providers, their models
 * (`custom:<provider>:<model>`) grouped by who bills the chat. "默认" leaves
 * the choice to the default set in Settings.
 */
import { PlugIcon, SparklesIcon } from "lucide-react";
import { useEffect, useMemo } from "react";

import { useAgentModel } from "@/hooks/use-agent-model";
import { useAccount, useChatModels } from "@/lib/account-context";
import { chatBillingNote, groupChatModels, preferredChatModelId } from "@/lib/chat-models";
import { cn } from "@/lib/utils";

import { type PickerOption, Picker } from "./ui/select";

const AUTO = "__default__";

export function AgentModelSelector({ compact }: { compact?: boolean | undefined } = {}) {
  const { model, setModel } = useAgentModel();
  const { data, loading, error } = useChatModels();
  const { account } = useAccount();
  const models = useMemo(() => data ?? [], [data]);
  const defaultId = preferredChatModelId(account.data?.preferences);
  const defaultModel = models.find((m) => m.id === defaultId) ?? null;

  // A remembered model that is no longer listed (key changed, provider
  // disabled or deleted) falls back to the default instead of failing the
  // next run.
  useEffect(() => {
    if (!model || !data) return;
    if (!data.some((m) => m.id === model)) {
      console.info("[agent-model] stored model unavailable, using default", model);
      setModel(null);
    }
  }, [data, model, setModel]);

  const options = useMemo<PickerOption[]>(() => {
    const groups = groupChatModels(models);
    const grouped = groups.some((group) => group.source === "custom");
    return [
      {
        value: AUTO,
        text: "默认模型",
        label: "默认模型",
        description: defaultModel ? `设置里的默认：${defaultModel.name}` : "使用设置里的默认对话模型",
      },
      ...groups.flatMap((group) =>
        group.models.map((m) => ({
          value: m.id,
          text: m.name,
          label: m.name,
          ...(grouped
            ? {
                group: {
                  key: group.key,
                  label: group.source === "custom" ? `${group.label} · 由服务商收费` : "主站",
                },
              }
            : {}),
        })),
      ),
    ];
  }, [models, defaultModel]);

  // "默认" bills wherever the default model lives.
  const selected = models.find((m) => m.id === model) ?? (model ? null : defaultModel);
  const external = selected?.billing === "external";

  return (
    <Picker
      value={model ?? AUTO}
      onValueChange={(next) => setModel(next === AUTO ? null : next)}
      options={options}
      // The trigger is too narrow for a sentence; screen readers get the
      // billing note in the label, everyone gets the plug glyph.
      ariaLabel={selected ? `对话模型：${model ? selected.name : "默认"}，${chatBillingNote(selected)}` : "对话模型"}
      disabled={Boolean(error) || (loading && models.length === 0)}
      placeholder={error ? "对话 Key 不可用" : "默认模型"}
      side="top"
      icon={
        external ? (
          <PlugIcon className="size-3.5 shrink-0 text-fg-soft" strokeWidth={1.75} />
        ) : (
          <SparklesIcon className="size-3.5 shrink-0 text-fg-soft" strokeWidth={1.75} />
        )
      }
      className={cn(
        "h-8 border-transparent bg-transparent px-2 hover:bg-white/[0.06]",
        compact ? "max-w-[140px] text-[12px]" : "max-w-[180px]",
      )}
      popupClassName="w-[260px]"
    />
  );
}

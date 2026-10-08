"use client";

/**
 * Chat model for the design agent. Lists models the selected chat key can
 * reach (ids are `openai:<model>`, which the server strips). "默认" leaves
 * the choice to the workspace default set in Settings.
 */
import { SparklesIcon } from "lucide-react";
import { useEffect, useMemo } from "react";

import { useAgentModel } from "@/hooks/use-agent-model";
import { useChatModels } from "@/lib/account-context";
import { cn } from "@/lib/utils";

import { Picker } from "./ui/select";

const AUTO = "__default__";

export function AgentModelSelector({ compact }: { compact?: boolean | undefined } = {}) {
  const { model, setModel } = useAgentModel();
  const { data, loading, error } = useChatModels();
  const models = useMemo(() => data ?? [], [data]);

  // A remembered model the current key can no longer reach falls back to
  // the default instead of failing the next run.
  useEffect(() => {
    if (!model || !data) return;
    if (!data.some((m) => m.id === model)) {
      console.info("[agent-model] stored model unavailable, using default", model);
      setModel(null);
    }
  }, [data, model, setModel]);

  const options = useMemo(
    () => [
      { value: AUTO, text: "默认模型", label: "默认模型", description: "使用设置里的默认对话模型" },
      ...models.map((m) => ({ value: m.id, text: m.name, label: m.name })),
    ],
    [models],
  );

  return (
    <Picker
      value={model ?? AUTO}
      onValueChange={(next) => setModel(next === AUTO ? null : next)}
      options={options}
      ariaLabel="对话模型"
      disabled={Boolean(error) || (loading && models.length === 0)}
      placeholder={error ? "对话 Key 不可用" : "默认模型"}
      side="top"
      icon={<SparklesIcon className="size-3.5 shrink-0 text-fg-soft" strokeWidth={1.75} />}
      className={cn(
        "h-8 border-transparent bg-transparent px-2 hover:bg-white/[0.06]",
        compact ? "max-w-[140px] text-[12px]" : "max-w-[180px]",
      )}
      popupClassName="w-[240px]"
    />
  );
}

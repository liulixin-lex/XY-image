"use client";

/**
 * 思考强度 and 联网搜索 for the design assistant (第 67 条), beside the chat
 * model picker. Only the levels the answering model takes are listed
 * (packages/shared chat-options.ts); a remembered level it lacks shows as the
 * one it will run at. The globe shows only for models with built-in search.
 */
import {
  CHAT_EFFORT_HINT,
  CHAT_EFFORT_LABEL,
  chatOptionsForModelId,
  parseChatModelRef,
  resolveChatEffort,
} from "@loomic/shared";
import { BrainIcon, GlobeIcon } from "lucide-react";
import { useMemo } from "react";

import { useAgentModel } from "@/hooks/use-agent-model";
import { useChatOptions } from "@/hooks/use-chat-options";
import { useAccount } from "@/lib/account-context";
import { preferredChatModelId } from "@/lib/chat-models";
import { cn } from "@/lib/utils";

import { type PickerOption, Picker } from "./ui/select";

/** The model that will answer: the picked one, else the Settings default. */
export function useAnsweringModelId(): string | null {
  const { model } = useAgentModel();
  const { account } = useAccount();
  return model ?? preferredChatModelId(account.data?.preferences);
}

export function AgentChatOptions() {
  const modelId = useAnsweringModelId();
  const { effort, webSearch, setEffort, setWebSearch } = useChatOptions();
  const { efforts, webSearch: searchable } = chatOptionsForModelId(modelId);
  const ref = modelId ? parseChatModelRef(modelId) : null;
  const shown = resolveChatEffort(ref, effort);

  const options = useMemo<PickerOption[]>(
    () =>
      efforts.map((value) => ({
        value,
        text: CHAT_EFFORT_LABEL[value],
        label: CHAT_EFFORT_LABEL[value],
        description: CHAT_EFFORT_HINT[value],
      })),
    [efforts],
  );

  return (
    <>
      {efforts.length > 1 ? (
        <Picker
          value={shown}
          onValueChange={(next) => setEffort(next as typeof effort)}
          options={options}
          ariaLabel={`思考强度：${CHAT_EFFORT_LABEL[shown]}`}
          side="top"
          icon={<BrainIcon className="size-3.5 shrink-0 text-fg-soft" strokeWidth={1.75} />}
          className="h-8 min-w-0 max-w-[88px] border-transparent bg-transparent px-2 text-[12px] hover:bg-tint/[0.06]"
          popupClassName="w-[220px]"
        />
      ) : null}
      {searchable ? (
        <button
          type="button"
          onClick={() => setWebSearch(!webSearch)}
          aria-pressed={webSearch}
          aria-label="联网搜索"
          title={webSearch ? "联网搜索：开（需要时模型会自己搜）" : "联网搜索：关"}
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-[10px] transition-colors focus-visible:outline-2 focus-visible:outline-acc",
            webSearch
              ? "bg-acc-soft text-acc-text"
              : "text-fg-soft hover:bg-tint/[0.07] hover:text-fg",
          )}
        >
          <GlobeIcon className="size-4" strokeWidth={1.75} />
        </button>
      ) : null}
    </>
  );
}

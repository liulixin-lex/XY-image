import {
  type ContentBlock,
  RUN_STOPPED_TEXT,
  type StreamEvent,
  type ToolBlock,
  runFailureText,
} from "@loomic/shared";

/**
 * The assistant message a run produces, built from its stream events and
 * saved when the run ends (ws/handler.ts). It follows what the page shows
 * (apps/web hooks/use-chat-stream.ts): a run that is stopped or fails closes
 * its running tools, so a reloaded conversation does not spin forever, and a
 * failed run with no reply keeps a line saying so (runFailureText).
 */
export type AssistantDraft = { text: string[]; blocks: ContentBlock[] };

/** Output of a tool the user stopped (the page shows "已停止"). */
export const STOPPED_TOOL_OUTPUT = { stopped: true } as const;

export function createAssistantDraft(): AssistantDraft {
  return { text: [], blocks: [] };
}

export function applyToAssistantDraft(
  draft: AssistantDraft,
  event: StreamEvent,
): void {
  const { blocks } = draft;
  switch (event.type) {
    case "message.delta": {
      const last = blocks.at(-1);
      if (last?.type === "text") last.text += event.delta;
      else blocks.push({ type: "text", text: event.delta });
      draft.text.push(event.delta);
      return;
    }
    case "tool.started":
      blocks.push({
        type: "tool",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        status: "running",
        ...(event.input ? { input: event.input } : {}),
      });
      return;
    case "tool.completed": {
      const index = blocks.findIndex(
        (block) =>
          block.type === "tool" && block.toolCallId === event.toolCallId,
      );
      if (index < 0) return;
      blocks[index] = {
        ...(blocks[index] as ToolBlock),
        status: "completed",
        ...(event.output ? { output: event.output } : {}),
        ...(event.outputSummary ? { outputSummary: event.outputSummary } : {}),
        ...(event.artifacts ? { artifacts: event.artifacts } : {}),
      };
      return;
    }
    case "run.canceled":
      if (blocks.length === 0) {
        blocks.push({ type: "text", text: RUN_STOPPED_TEXT });
        draft.text.push(RUN_STOPPED_TEXT);
        return;
      }
      closeRunningTools(blocks, {
        output: { ...STOPPED_TOOL_OUTPUT },
        outputSummary: "已停止",
      });
      return;
    case "run.failed": {
      closeRunningTools(blocks, { outputSummary: "处理失败" });
      if (!blocks.some((block) => block.type === "text")) {
        const text = runFailureText(event.error);
        blocks.push({ type: "text", text });
        draft.text.push(text);
      }
      return;
    }
    default:
      return;
  }
}

function closeRunningTools(
  blocks: ContentBlock[],
  close: Pick<ToolBlock, "output" | "outputSummary">,
) {
  blocks.forEach((block, index) => {
    if (block.type === "tool" && block.status === "running") {
      blocks[index] = { ...block, status: "completed", ...close };
    }
  });
}

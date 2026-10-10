"use client";

import React, { useMemo } from "react";

import type { ContentBlock, ToolArtifact, ToolBlock } from "@loomic/shared";
import { LiveDot } from "./ambient/live-dot";
import { ImagePill } from "./chat/image-lightbox";
import { MarkdownRenderer } from "./chat/markdown-renderer";
import { MentionPill } from "./chat/mention-pill";
import { ThinkingBlockView } from "./chat/thinking-block-view";
import { ToolBlockView } from "./chat/tool-block-view";

// Re-export types for backward compatibility with existing consumers
export type { ContentBlock, ToolArtifact };

/** @deprecated Use ToolBlock from @loomic/shared instead */
export type ToolActivity = ToolBlock;

/* ------------------------------------------------------------------ */
/*  ChatMessage                                                        */
/* ------------------------------------------------------------------ */

type ChatMessageProps = {
  role: "user" | "assistant";
  contentBlocks: ContentBlock[];
  isStreaming?: boolean;
};

/**
 * Top-level chat message component.
 *
 * Memoized with a custom comparator: skips re-render when contentBlocks
 * reference and isStreaming flag are unchanged. During streaming, only the
 * actively-streaming message receives new contentBlocks arrays; all prior
 * messages keep the same reference and skip rendering entirely.
 *
 * Sub-components (MarkdownRenderer, ToolBlockView, ThinkingBlockView) are
 * each independently memoized for fine-grained update control.
 */
export const ChatMessage = React.memo(
  function ChatMessage({
    role,
    contentBlocks,
    isStreaming,
  }: ChatMessageProps) {
    const isUser = role === "user";

    if (isUser) {
      return <UserMessage contentBlocks={contentBlocks} />;
    }

    return (
      <AssistantMessage
        contentBlocks={contentBlocks}
        isStreaming={isStreaming ?? false}
      />
    );
  },
  (prev, next) => {
    // Custom comparator: referential equality on contentBlocks is sufficient
    // because updateSessionMessages always creates a new array when content changes
    return (
      prev.role === next.role &&
      prev.contentBlocks === next.contentBlocks &&
      prev.isStreaming === next.isStreaming
    );
  },
);

/** Messages rise into place (CSS `.animate-enter`); with reduced motion they simply appear. */

/* ------------------------------------------------------------------ */
/*  UserMessage                                                        */
/* ------------------------------------------------------------------ */

const UserMessage = React.memo(function UserMessage({
  contentBlocks,
}: {
  contentBlocks: ContentBlock[];
}) {
  // Categorize blocks once per render
  const { text, imageBlocks, mentionBlocks } = useMemo(() => {
    const textParts: string[] = [];
    const images: ContentBlock[] = [];
    const mentions: ContentBlock[] = [];

    for (const block of contentBlocks) {
      if (block.type === "text") {
        textParts.push(block.text);
      } else if (block.type === "image") {
        images.push(block);
      } else if (block.type === "mention") {
        mentions.push(block);
      }
    }

    return {
      text: textParts.join(""),
      imageBlocks: images,
      mentionBlocks: mentions,
    };
  }, [contentBlocks]);

  // Inked bubble: the user's words read as the strongest ink in the thread.
  // Pills inside follow currentColor (mention-pill, ImagePill).
  return (
    <div className="animate-enter flex w-full flex-col items-end gap-2 pl-10">
      {text && (
        <div className="inline-block rounded-[16px] rounded-br-[6px] bg-fg px-3.5 py-2.5 text-[14px] leading-[1.65] whitespace-pre-wrap break-words text-ground selection:bg-acc selection:text-acc-ink">
          <span className="cursor-text select-text [word-break:break-word]">
            {text}
          </span>
          {mentionBlocks.length > 0 && (
            <span className="inline">
              {mentionBlocks.map((block, idx) => (
                <MentionPill
                  key={idx}
                  label={(block as { label: string }).label}
                  kind={
                    (
                      block as {
                        mentionType: "image-model" | "brand-kit-asset" | "skill";
                      }
                    ).mentionType
                  }
                />
              ))}
            </span>
          )}
          {imageBlocks.length > 0 && (
            <span className="inline">
              {imageBlocks.map((block, idx) => (
                <ImagePill
                  key={idx}
                  src={(block as { url: string }).url}
                  name={
                    (block as { name?: string }).name ??
                    `image-${idx + 1}`
                  }
                />
              ))}
            </span>
          )}
        </div>
      )}
      {!text && (imageBlocks.length > 0 || mentionBlocks.length > 0) && (
        <div className="inline-block rounded-[16px] rounded-br-[6px] bg-fg px-3 py-2.5 text-ground">
          {mentionBlocks.map((block, idx) => (
            <MentionPill
              key={`mention-${idx}`}
              label={(block as { label: string }).label}
              kind={
                (
                  block as {
                    mentionType: "image-model" | "brand-kit-asset" | "skill";
                  }
                ).mentionType
              }
            />
          ))}
          {imageBlocks.map((block, idx) => (
            <ImagePill
              key={idx}
              src={(block as { url: string }).url}
              name={
                (block as { name?: string }).name ?? `image-${idx + 1}`
              }
            />
          ))}
        </div>
      )}
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  AssistantMessage                                                    */
/* ------------------------------------------------------------------ */

const AssistantMessage = React.memo(function AssistantMessage({
  contentBlocks,
  isStreaming,
}: {
  contentBlocks: ContentBlock[];
  isStreaming: boolean;
}) {
  // Find the last text block index for streaming cursor placement
  const lastTextIdx = useMemo(() => {
    for (let i = contentBlocks.length - 1; i >= 0; i--) {
      if (contentBlocks[i]!.type === "text") return i;
    }
    return -1;
  }, [contentBlocks]);

  // Show thinking indicator when streaming but no content has arrived yet
  const hasContent = useMemo(
    () =>
      contentBlocks.some(
        (b) =>
          (b.type === "text" && b.text.length > 0) ||
          b.type === "tool" ||
          b.type === "thinking",
      ),
    [contentBlocks],
  );

  const showThinking = isStreaming && !hasContent;

  return (
    <div className="animate-enter flex w-full flex-col gap-2.5 pr-6">
      {showThinking && (
        <output className="flex items-center gap-2 text-[13px] text-fg-muted">
          <LiveDot />
          <span>思考中</span>
        </output>
      )}
      {contentBlocks.map((block, idx) => {
        if (block.type === "thinking") {
          return (
            <ThinkingBlockView
              key={`thinking-${idx}`}
              thinking={block.thinking}
              isStreaming={
                isStreaming && idx === contentBlocks.length - 1
              }
            />
          );
        }

        if (block.type === "text") {
          const showCursor = isStreaming && idx === lastTextIdx;
          return (
            <MarkdownRenderer
              key={idx}
              text={block.text}
              showCursor={showCursor}
            />
          );
        }

        if (block.type === "tool") {
          return (
            <ToolBlockView
              key={block.toolCallId}
              block={block}
              live={isStreaming}
            />
          );
        }

        // ImageBlock -- skip in assistant messages (user-side only)
        return null;
      })}
    </div>
  );
});

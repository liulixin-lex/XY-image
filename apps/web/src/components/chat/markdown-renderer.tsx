"use client";

import React, { createContext, useContext } from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";

import { ChatImage } from "./image-lightbox";
import { isImageUrl } from "./utils";

/**
 * While a text block is still streaming, the character offset where it
 * currently ends; null once it is complete.
 *
 * A bare URL is autolinked as it arrives: `https://…/project-assets/62b`,
 * then `…/62bcd`, and so on. Rendering each prefix as an image sent one
 * request per delta for addresses that do not exist (production 10-11:
 * Storage 400s, then media-access 403s, and console errors in the chat).
 * A link that ends where the text ends may still be growing, so it is not
 * loaded until more text follows it or the block completes.
 */
const StreamingEnd = createContext<number | null>(null);

function stillGrowing(node: ExtraProps["node"], streamingEnd: number | null): boolean {
  if (streamingEnd === null) return false;
  const end = node?.position?.end?.offset;
  return typeof end !== "number" || end >= streamingEnd;
}

function ChatLink({ href, children, node }: React.ComponentProps<"a"> & ExtraProps) {
  const streamingEnd = useContext(StreamingEnd);
  if (href && isImageUrl(href)) {
    if (stillGrowing(node, streamingEnd))
      return <span className="text-fg-muted">图片加载中…</span>;
    return (
      <ChatImage
        src={href}
        alt={typeof children === "string" ? children : "Image"}
        className="my-2 max-w-[280px] rounded-[12px] shadow-card"
      />
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="break-all text-acc-text underline underline-offset-2"
    >
      {children}
    </a>
  );
}

/**
 * Pre-built markdown component overrides.
 *
 * Defined as a module-level constant so every MarkdownRenderer instance
 * shares the same reference — avoids re-creating the components map on
 * every render, which would force ReactMarkdown to remount its tree.
 */
const markdownComponents: Components = {
  a: ChatLink,
  img({ src, alt }) {
    return (
      <ChatImage
        src={typeof src === "string" ? src : ""}
        alt={alt ?? "Image"}
        className="my-2 max-w-[280px] rounded-[12px] shadow-card"
      />
    );
  },
};

/** Stable remarkPlugins array to prevent ReactMarkdown remount */
const remarkPlugins = [remarkGfm];

type MarkdownRendererProps = {
  /** Raw markdown text to render */
  text: string;
  /**
   * This block is still streaming: shows the cursor after it, and holds back
   * an image link that may not have fully arrived yet (see StreamingEnd).
   */
  showCursor?: boolean;
};

/**
 * Memoized markdown renderer for chat messages.
 *
 * Performance notes:
 * - remarkPlugins and components are module-level constants (no re-creation)
 * - React.memo prevents re-render when text hasn't changed
 * - During streaming, text changes every delta — the memo check is O(1) string comparison
 */
export const MarkdownRenderer = React.memo(function MarkdownRenderer({
  text,
  showCursor,
}: MarkdownRendererProps) {
  // Guard against empty/whitespace-only text producing empty markdown output
  const safeText = text || "";

  return (
    <div className="markdown-content text-[14px] leading-[1.7] text-fg">
      <StreamingEnd.Provider value={showCursor ? safeText.length : null}>
        <ReactMarkdown
          remarkPlugins={remarkPlugins}
          components={markdownComponents}
        >
          {safeText}
        </ReactMarkdown>
      </StreamingEnd.Provider>
      {showCursor && (
        <span
          aria-hidden
          className="ml-0.5 -mb-[2px] inline-block h-[15px] w-[2px] animate-pulse rounded-full bg-acc motion-reduce:animate-none"
        />
      )}
    </div>
  );
});

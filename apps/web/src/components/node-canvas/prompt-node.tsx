"use client";

/**
 * A prompt card: text that feeds every generator it is connected to. Typing
 * saves as it goes; one editing session is one undo step.
 */
import type { NodeProps } from "@xyflow/react";
import { TextQuoteIcon } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";

import { bumpElement } from "../../lib/node-canvas/element";
import type { SceneNode } from "../../lib/node-canvas/types";
import { useNodeCanvas } from "./context";
import { CardNode, NodeHandles } from "./node-parts";

export const PROMPT_WIDTH = 260;
const PROMPT_MAX = 4000;

export const PromptNode = memo(function PromptNode({
  id,
  data,
  selected,
}: NodeProps<SceneNode>) {
  const { store } = useNodeCanvas();
  const stored = typeof data.el.text === "string" ? data.el.text : "";
  const [text, setText] = useState(stored);
  const editing = useRef(false);
  const area = useRef<HTMLTextAreaElement>(null);

  // Undo, redo and the server's copy change the text from outside.
  useEffect(() => {
    if (!editing.current) setText(stored);
  }, [stored]);

  // The card grows with its text.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the text changes
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [text]);

  return (
    <>
      <CardNode
        icon={<TextQuoteIcon className="size-4" strokeWidth={1.75} />}
        title="提示词"
        selected={selected}
      >
        <label htmlFor={`prompt-${id}`} className="sr-only">
          提示词
        </label>
        <textarea
          id={`prompt-${id}`}
          ref={area}
          value={text}
          maxLength={PROMPT_MAX}
          rows={3}
          placeholder="写下想要的画面，连到「生成」节点"
          onFocus={() => {
            editing.current = true;
            store.beginEdit();
          }}
          onBlur={() => {
            editing.current = false;
            store.endEdit();
          }}
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            store.updateElement(id, (el) => bumpElement(el, { text: next }), {
              record: false,
            });
          }}
          onKeyDown={(event) => event.stopPropagation()}
          className="nodrag nowheel block w-full resize-none bg-transparent px-3.5 pb-3.5 text-[14px] leading-relaxed text-fg outline-none placeholder:text-fg-muted"
        />
      </CardNode>
      <NodeHandles />
    </>
  );
});

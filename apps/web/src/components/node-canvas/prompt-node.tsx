"use client";

/**
 * A prompt card: text that feeds every generator it is connected to. Typing
 * saves as it goes; one editing session is one undo step.
 *
 * Connected to two or more generators (each can use its own model and key,
 * 第 56 条), the card offers 「全部生成」: every one of them sends its own
 * batch at once, with what its node shows. Ones that can't send yet are
 * skipped and named.
 */
import type { NodeProps } from "@xyflow/react";
import { SparklesIcon, TextQuoteIcon } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";

import { useAccount, useImageModels } from "../../lib/account-context";
import { bumpElement } from "../../lib/node-canvas/element";
import { readGenerator } from "../../lib/node-canvas/generator";
import { planGenerator } from "../../lib/node-canvas/generator-plan";
import { generatorInputs } from "../../lib/node-canvas/runtime";
import type { SceneNode } from "../../lib/node-canvas/types";
import { useToast } from "../toast";
import { useNodeCanvas, useRuntimeState, useStoreState } from "./context";
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
  // Generators this card feeds directly.
  const targetsKey = useStoreState((state) => {
    const generators = new Set(
      state.scene.nodes.flatMap((n) => (n.type === "generator" ? [n.id] : [])),
    );
    return state.scene.edges
      .flatMap((e) => (e.source === id && generators.has(e.target) ? [e.target] : []))
      .join(",");
  });
  const targets = targetsKey ? targetsKey.split(",") : [];
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
        {targets.length >= 2 ? <RunAll generatorIds={targets} /> : null}
      </CardNode>
      <NodeHandles />
    </>
  );
});

/**
 * 全部生成: one batch per connected generator, sent together. The count on
 * the button is what will be asked for (each node's own 数量).
 */
function RunAll({ generatorIds }: { generatorIds: string[] }) {
  const { store, runtime } = useNodeCanvas();
  const { data: modelList, loading: modelsLoading, error: modelsError } =
    useImageModels();
  const { account } = useAccount();
  const { success, toast } = useToast();
  const anySending = useRuntimeState((state) =>
    generatorIds.some((gid) => state.sending.has(gid)),
  );
  const [running, setRunning] = useState(false);

  // Re-read on click: the plan must match the nodes at that moment.
  const plans = useCallback(() => {
    const { nodes, edges } = store.scene;
    return generatorIds.flatMap((gid) => {
      const node = nodes.find((n) => n.id === gid);
      if (!node || node.type !== "generator") return [];
      const config = readGenerator(node.data.el);
      const inputs = generatorInputs(nodes, edges, gid);
      const plan = planGenerator({
        config,
        inputs: { ...inputs, imageCount: inputs.images.length },
        models: modelList ?? [],
        prefs: account.data?.preferences ?? null,
        accountSettled: Boolean(account.data) || Boolean(account.error),
        modelsLoading,
        modelsError,
      });
      return [{ generatorId: gid, count: config.count, plan }];
    });
  }, [store, generatorIds, modelList, account.data, account.error, modelsLoading, modelsError]);

  // Pictures the click would ask for; follows the nodes' own 数量 and state.
  const total = useStoreState(() =>
    plans().reduce((sum, item) => sum + (item.plan.params ? item.count : 0), 0),
  );

  const runAll = async () => {
    if (running || anySending) return;
    const all = plans();
    const ready = all.flatMap((item) =>
      item.plan.params ? [{ generatorId: item.generatorId, params: item.plan.params }] : [],
    );
    const blocked = all.length - ready.length;
    if (ready.length === 0) {
      toast(all[0]?.plan.blockedReason ?? "连着的「生成」都还不能生成");
      return;
    }
    setRunning(true);
    try {
      const sent = await runtime.generateMany(ready);
      if (sent > 0)
        success(
          blocked
            ? `${sent} 个节点开始生成，另外 ${blocked} 个还不能生成`
            : `${sent} 个节点开始生成`,
        );
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="px-3.5 pb-3.5">
      <button
        type="button"
        onClick={() => void runAll()}
        disabled={running || anySending || total === 0}
        title="连着的每个「生成」各发一次，用各自的模型和设置"
        className="nodrag flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-fg text-[13px] font-semibold text-ground transition-[opacity,transform] duration-150 hover:opacity-90 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc disabled:cursor-not-allowed disabled:opacity-40"
      >
        <SparklesIcon className="size-4" strokeWidth={1.9} />
        {running || anySending
          ? "正在发送"
          : `全部生成 · ${generatorIds.length} 个节点${total ? ` ${total} 张` : ""}`}
      </button>
    </div>
  );
}

"use client";

/**
 * 第 70 条 指定: the chat panel's 「+」 menu. The user picks, for the next
 * message, what the assistant works on and with:
 * - 目标: nodes on the canvas (prompt cards, 生成 nodes, pictures, frames,
 *   text) the message is about;
 * - 技能: an enabled skill to follow;
 * - 品牌套件: a whole kit for this message (instead of the project's);
 * - 工具: a tool to use (生图, 搭建 / 运行工作流, 联网搜索, 审图, 编辑画布).
 * Picks show as chips above the input (chat-input.tsx) and go out as
 * mentions; the server turns them into explicit instructions
 * (apps/server/src/agent/runtime.ts buildMentionXmlBlocks).
 */
import {
  AGENT_PICK_TOOLS,
  type BrandKitSummary,
  type MessageMention,
} from "@loomic/shared";
import {
  BoxesIcon,
  CheckIcon,
  FrameIcon,
  ImageIcon,
  PaletteIcon,
  PlusIcon,
  SparklesIcon,
  TypeIcon,
  WandSparklesIcon,
  WrenchIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { fetchBrandKits } from "../../lib/brand-kit-api";
import { cn } from "../../lib/utils";
import type { SkillMentionItem } from "../canvas-image-picker";

/** A node the user can pick as the target (canvas page lists them). */
export type CanvasNodeItem = {
  id: string;
  /** prompt, generator, image, text, frame or a shape type. */
  type: string;
  label: string;
};

type Tab = "target" | "skill" | "kit" | "tool";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "target", label: "目标" },
  { id: "skill", label: "技能" },
  { id: "kit", label: "品牌套件" },
  { id: "tool", label: "工具" },
];

const POPOVER_WIDTH = 320;

const NODE_TYPE_LABEL: Record<string, string> = {
  prompt: "提示词卡片",
  generator: "生成节点",
  image: "图片",
  text: "文字",
  frame: "分组框",
};

function NodeIcon({ type }: { type: string }) {
  const Icon =
    type === "generator"
      ? WandSparklesIcon
      : type === "image"
        ? ImageIcon
        : type === "frame"
          ? FrameIcon
          : type === "prompt" || type === "text"
            ? TypeIcon
            : BoxesIcon;
  return <Icon className="size-3.5 shrink-0 text-fg-muted" strokeWidth={1.75} />;
}

export function mentionKey(m: MessageMention) {
  return `${m.mentionType}:${m.id}`;
}

export function PickMenu({
  accessToken,
  picked,
  onToggle,
  requestNodes,
  skills,
  disabled,
}: {
  accessToken: string;
  picked: MessageMention[];
  onToggle: (mention: MessageMention) => void;
  requestNodes?: () => CanvasNodeItem[];
  skills: SkillMentionItem[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("target");
  const [nodes, setNodes] = useState<CanvasNodeItem[]>([]);
  const [kits, setKits] = useState<BrandKitSummary[] | null>(null);
  const [kitError, setKitError] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null);
  const pickedKeys = useMemo(() => new Set(picked.map(mentionKey)), [picked]);

  // The canvas changes while the panel is open: read its nodes on opening.
  useEffect(() => {
    if (!open) return;
    setNodes(requestNodes?.() ?? []);
    if (kits === null && !kitError)
      fetchBrandKits(accessToken)
        .then((res) => setKits(res.brandKits))
        .catch((error) => {
          console.warn("[pick-menu] brand kits failed to load", error);
          setKitError(true);
        });
  }, [open, requestNodes, accessToken, kits, kitError]);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const above = spaceBelow < 360 && rect.top > spaceBelow;
    setPos({
      top: above ? rect.top - 8 : rect.bottom + 8,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 8)),
      above,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const count = picked.filter((m) =>
    ["canvas-node", "skill", "brand-kit", "tool"].includes(m.mentionType),
  ).length;

  const row = (
    key: string,
    selected: boolean,
    onClick: () => void,
    icon: React.ReactNode,
    title: string,
    hint?: string,
  ) => (
    <button
      key={key}
      type="button"
      role="menuitemcheckbox"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors",
        selected ? "bg-acc-soft" : "hover:bg-tint/[0.06]",
      )}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-fg">{title}</span>
        {hint ? <span className="block truncate text-[11.5px] text-fg-muted">{hint}</span> : null}
      </span>
      {selected ? <CheckIcon className="size-3.5 shrink-0 text-acc-text" strokeWidth={2.5} /> : null}
    </button>
  );

  const empty = (text: string) => <p className="px-2.5 py-3 text-[12.5px] leading-relaxed text-fg-muted">{text}</p>;

  const body = () => {
    if (tab === "target")
      return nodes.length === 0
        ? empty("画布上还没有节点。先生成或放一些内容，再回来指定。")
        : nodes.map((n) =>
            row(
              n.id,
              pickedKeys.has(`canvas-node:${n.id}`),
              () => onToggle({ mentionType: "canvas-node", id: n.id, label: n.label, nodeType: n.type }),
              <NodeIcon type={n.type} />,
              n.label,
              NODE_TYPE_LABEL[n.type] ?? "图形",
            ),
          );
    if (tab === "skill")
      return skills.length === 0
        ? empty("还没有启用的技能。可以在「技能」页启用。")
        : skills.map((s) =>
            row(
              s.id,
              pickedKeys.has(`skill:${s.id}`),
              () => onToggle({ mentionType: "skill", id: s.id, label: s.label, slug: s.slug }),
              <SparklesIcon className="size-3.5 shrink-0 text-fg-muted" strokeWidth={1.75} />,
              s.label,
              s.description,
            ),
          );
    if (tab === "kit") {
      if (kitError) return empty("品牌套件没读到，稍后再试。");
      if (kits === null)
        return (
          <div className="space-y-1.5 p-1.5" aria-hidden>
            {[0, 1].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-md bg-tint/[0.05]" />
            ))}
          </div>
        );
      return kits.length === 0
        ? empty("还没有品牌套件。可以在「品牌套件」页新建。")
        : kits.map((k) =>
            row(
              k.id,
              pickedKeys.has(`brand-kit:${k.id}`),
              () => onToggle({ mentionType: "brand-kit", id: k.id, label: k.name || "未命名套件" }),
              <PaletteIcon className="size-3.5 shrink-0 text-fg-muted" strokeWidth={1.75} />,
              k.name || "未命名套件",
              k.is_default ? "默认套件" : undefined,
            ),
          );
    }
    return AGENT_PICK_TOOLS.map((t) =>
      row(
        t.id,
        pickedKeys.has(`tool:${t.id}`),
        () => onToggle({ mentionType: "tool", id: t.id, label: t.label }),
        <WrenchIcon className="size-3.5 shrink-0 text-fg-muted" strokeWidth={1.75} />,
        t.label,
        t.hint,
      ),
    );
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        title="指定目标、技能、品牌套件或工具"
        aria-label="指定目标、技能、品牌套件或工具"
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "relative flex size-8 shrink-0 items-center justify-center rounded-[10px] transition-colors focus-visible:outline-2 focus-visible:outline-acc disabled:opacity-50",
          open || count > 0 ? "bg-acc-soft text-acc-text" : "text-fg-soft hover:bg-tint/[0.07] hover:text-fg",
        )}
      >
        <PlusIcon className="size-4" strokeWidth={2} />
        {count > 0 ? (
          <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-acc text-[10px] font-semibold text-acc-ink">
            {count}
          </span>
        ) : null}
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={popoverRef}
              role="menu"
              aria-label="指定"
              style={{
                top: pos.above ? undefined : pos.top,
                bottom: pos.above ? window.innerHeight - pos.top : undefined,
                left: pos.left,
                width: POPOVER_WIDTH,
              }}
              className="fixed z-[9999] rounded-lg glass-menu shadow-float"
            >
              <div className="px-3.5 pt-3 pb-2">
                <p className="text-[13.5px] font-semibold text-fg">这条消息指定</p>
                <p className="mt-0.5 text-[12px] leading-snug text-fg-muted">
                  选中的会和消息一起发给助手，助手照着做。再点一次取消。
                </p>
              </div>
              <div role="tablist" aria-label="类别" className="flex gap-1 border-b border-line px-2.5 pb-2">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.id}
                    onClick={() => setTab(t.id)}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-[12.5px] transition-colors",
                      tab === t.id ? "bg-fg text-ground" : "text-fg-soft hover:bg-tint/[0.06] hover:text-fg",
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="max-h-[280px] overflow-y-auto p-1.5">{body()}</div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

"use client";

import {
  BookOpenIcon,
  GalleryHorizontalIcon,
  LayoutGridIcon,
  PackageIcon,
  PenToolIcon,
  SmartphoneIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { BRAND } from "@/lib/brand";

type Starter = { icon: ReactNode; label: string; prompt: string };

const ICON = "size-4 shrink-0";

/** First-message starters shown in an empty conversation. Sent on click. */
const STARTERS: Starter[] = [
  {
    icon: <GalleryHorizontalIcon className={ICON} strokeWidth={1.75} />,
    label: "社媒轮播图",
    prompt: "帮我设计一组社交媒体轮播图，包含封面和多张内页，风格统一",
  },
  {
    icon: <SmartphoneIcon className={ICON} strokeWidth={1.75} />,
    label: "社交媒体海报",
    prompt: "帮我设计一张社交媒体海报，风格现代简洁",
  },
  {
    icon: <PenToolIcon className={ICON} strokeWidth={1.75} />,
    label: "标志与品牌",
    prompt: "帮我设计一个标志和品牌视觉方案",
  },
  {
    icon: <LayoutGridIcon className={ICON} strokeWidth={1.75} />,
    label: "分镜故事板",
    prompt: "帮我创建一组分镜故事板，用于展示创意概念",
  },
  {
    icon: <BookOpenIcon className={ICON} strokeWidth={1.75} />,
    label: "营销宣传册",
    prompt: "帮我设计一套营销宣传册页面，包含封面和内页",
  },
  {
    icon: <PackageIcon className={ICON} strokeWidth={1.75} />,
    label: "产品展示图",
    prompt: "帮我设计一组产品展示图，适合电商平台使用",
  },
];

type ChatSkillsProps = {
  onSend: (text: string) => void;
};

export function ChatSkills({ onSend }: ChatSkillsProps) {
  return (
    <div className="flex h-full flex-col justify-center gap-5 px-1 pb-6">
      <div>
        <h3 className="poster-label text-[28px] leading-[1.1] text-fg">
          从哪儿开始
        </h3>
        <p className="mt-2 max-w-[34ch] text-[13px] leading-relaxed text-fg-soft">
          {BRAND.agentName}
          会在画布上出图、排版。点一个直接开始，或在下面写你自己的需求。
        </p>
      </div>
      {/* Slanted chips: the poster's call-to-action shape (globals.css `sk`). */}
      <ul className="flex flex-wrap gap-2">
        {STARTERS.map((starter) => (
          <li key={starter.label}>
            <button
              type="button"
              onClick={() => onSend(starter.prompt)}
              className="sk inline-flex h-9 items-center rounded-[10px] bg-tint/[0.06] px-3.5 text-[13px] font-semibold text-fg transition-colors hover:bg-acc-soft hover:text-acc-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc active:translate-y-px"
            >
              <span className="sk-in gap-1.5">
                {starter.icon}
                {starter.label}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

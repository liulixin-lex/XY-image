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

const ICON = "size-4 shrink-0 text-fg-muted";

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
    <div className="flex h-full flex-col justify-center gap-4 px-1">
      <div>
        <p className="text-[15px] font-semibold text-fg">从哪儿开始</p>
        <p className="mt-1 text-[13px] leading-relaxed text-fg-soft">
          {BRAND.agentName}会在画布上出图、排版。点一个直接开始，或在下面写你自己的需求。
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {STARTERS.map((starter) => (
          <button
            key={starter.label}
            type="button"
            onClick={() => onSend(starter.prompt)}
            className="flex h-10 min-w-0 items-center gap-2 rounded-md glass px-3 text-left text-[13px] text-fg transition-colors hover:border-line-strong hover:bg-ground"
          >
            {starter.icon}
            <span className="truncate">{starter.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

"use client";

import { ArrowRightIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, forwardRef, useEffect, useImperativeHandle, useRef } from "react";

import { useAuth } from "@/lib/auth-context";
import {
  ASPECT_RATIOS,
  type AspectRatio,
  type ImageResolution,
  RESOLUTIONS,
  RESOLUTION_HINT,
} from "@/lib/image-model-meta";
import { savePendingDraft } from "@/lib/pending-prompt";
import { cn } from "@/lib/utils";

import { Button } from "../ui/button";
import { Picker } from "../ui/select";

export type PromptBoxHandle = { focus: () => void };

const RESOLUTION_OPTIONS = RESOLUTIONS.map((value) => ({
  value,
  text: value,
  label: value,
  description: value === "4K" ? `${RESOLUTION_HINT[value]}，部分模型支持` : RESOLUTION_HINT[value],
}));

/**
 * The landing page's working prompt box. Nothing is generated here:
 * the text (with ratio and 画质) waits in sessionStorage through login
 * and is placed into the studio, where generation needs one more explicit
 * click, because every generation is billed.
 */
export const PromptBox = forwardRef<
  PromptBoxHandle,
  {
    value: string;
    onChange: (value: string) => void;
    ratio: AspectRatio;
    onRatioChange: (ratio: AspectRatio) => void;
    resolution: ImageResolution;
    onResolutionChange: (resolution: ImageResolution) => void;
    className?: string;
  }
>(function PromptBox(
  { value, onChange, ratio, onRatioChange, resolution, onResolutionChange, className },
  ref,
) {
  const router = useRouter();
  const { user } = useAuth();
  const textarea = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => {
      const el = textarea.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
    },
  }));

  // Grow with the text, up to a few lines.
  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [value]);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const prompt = value.trim();
    if (prompt) savePendingDraft({ prompt, aspectRatio: ratio, resolution });
    console.info("[landing] prompt handed to studio", { signedIn: Boolean(user), length: prompt.length });
    router.push(user ? "/studio" : "/login?next=%2Fstudio");
  };

  return (
    <form
      onSubmit={submit}
      className={cn(
        "glass rounded-[24px] px-[18px] pt-[18px] pb-3.5 transition-shadow focus-within:shadow-[inset_0_1px_0_var(--glass-highlight),0_0_0_2px_var(--acc-soft),0_24px_48px_-28px_var(--shadow-2)]",
        className,
      )}
    >
      <label htmlFor="landing-prompt" className="sr-only">
        描述你想要的画面
      </label>
      <textarea
        id="landing-prompt"
        ref={textarea}
        value={value}
        rows={2}
        maxLength={4000}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="描述你想要的画面，比如：雨后的老街，霓虹倒影，胶片质感"
        className="block min-h-[54px] w-full resize-none bg-transparent px-1 text-[16px] leading-[1.65] font-medium text-fg placeholder:font-normal placeholder:text-fg-muted focus:outline-none sm:text-[16.5px]"
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Picker
          slant
          ariaLabel="画面比例"
          value={ratio}
          onValueChange={(v) => onRatioChange(v as AspectRatio)}
          options={ASPECT_RATIOS.map((r) => ({ value: r, text: r, label: r }))}
          className="h-[34px] min-w-[58px] px-3 tabular"
        />
        <Picker
          slant
          ariaLabel="画质"
          value={resolution}
          onValueChange={(v) => onResolutionChange(v as ImageResolution)}
          options={RESOLUTION_OPTIONS}
          className="h-[34px] min-w-[52px] px-3 tabular"
          popupClassName="w-[240px]"
        />
        <span className="hidden min-w-0 flex-1 truncate pl-1 text-[12.5px] text-fg-muted md:block">
          {user ? "会带着这段描述打开生图页" : "先用主站账号登录，写好的内容会保留"}
        </span>
        <Button type="submit" variant="accent" size="poster" slant className="ml-auto">
          开始生成
          <ArrowRightIcon strokeWidth={2.4} />
        </Button>
      </div>
    </form>
  );
});

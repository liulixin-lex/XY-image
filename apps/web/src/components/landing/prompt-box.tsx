"use client";

import { ArrowRightIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, forwardRef, useEffect, useImperativeHandle, useRef } from "react";

import { useAuth } from "@/lib/auth-context";
import { ASPECT_RATIOS, type AspectRatio } from "@/lib/image-model-meta";
import { savePendingDraft } from "@/lib/pending-prompt";
import { cn } from "@/lib/utils";

import { Button } from "../ui/button";
import { Picker } from "../ui/select";

export type PromptBoxHandle = { focus: () => void };

const QUALITY_OPTIONS = [
  { value: "standard", text: "1K", label: "1K", description: "标准画质" },
  { value: "hd", text: "2K", label: "2K", description: "高清，部分模型支持" },
];

/**
 * The landing page's working prompt box. Nothing is generated here:
 * the text (with ratio and quality) waits in sessionStorage through login
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
    quality: "standard" | "hd";
    onQualityChange: (quality: "standard" | "hd") => void;
    className?: string;
  }
>(function PromptBox(
  { value, onChange, ratio, onRatioChange, quality, onQualityChange, className },
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
    if (prompt) savePendingDraft({ prompt, aspectRatio: ratio, quality });
    console.info("[landing] prompt handed to studio", { signedIn: Boolean(user), length: prompt.length });
    router.push(user ? "/studio" : "/login?next=%2Fstudio");
  };

  return (
    <form
      onSubmit={submit}
      className={cn(
        "glass-strong group rounded-[20px] px-4 pt-4 pb-3.5 transition-[box-shadow,border-color] focus-within:border-white/20",
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
        className="block min-h-[56px] w-full resize-none bg-transparent px-1 text-[16px] leading-[1.65] text-fg placeholder:text-fg-muted focus:outline-none sm:text-[17px]"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Picker
          ariaLabel="画面比例"
          value={ratio}
          onValueChange={(v) => onRatioChange(v as AspectRatio)}
          options={ASPECT_RATIOS.map((r) => ({ value: r, text: r, label: r }))}
          className="h-8 w-[78px]"
        />
        <Picker
          ariaLabel="画质"
          value={quality}
          onValueChange={(v) => onQualityChange(v as "standard" | "hd")}
          options={QUALITY_OPTIONS}
          className="h-8 w-[70px]"
          popupClassName="w-[200px]"
        />
        <span className="hidden min-w-0 flex-1 truncate text-right text-[12.5px] text-fg-muted md:block">
          {user ? "会带着这段描述打开生图页" : "先用主站账号登录，写好的内容会保留"}
        </span>
        <Button type="submit" variant="glow" size="lg" className="ml-auto h-11 rounded-xl px-5 md:ml-1">
          开始生成
          <ArrowRightIcon strokeWidth={2} />
        </Button>
      </div>
    </form>
  );
});

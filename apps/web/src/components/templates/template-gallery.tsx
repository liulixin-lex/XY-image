"use client";

/**
 * 生图模板 (第 58 条): browse by category or search, open one, fill a few
 * fields and see the prompt it writes. 「填入生图」 hands the prompt and the
 * suggested 比例 / 画质 / 质量 to the caller (the studio composer, or the 技能
 * page which takes it to the studio). Nothing is generated from here.
 */
import {
  ArrowLeftIcon,
  BrushIcon,
  CameraIcon,
  ImagePlusIcon,
  LayoutTemplateIcon,
  type LucideIcon,
  PenToolIcon,
  SearchIcon,
  ShoppingBagIcon,
  SmartphoneIcon,
  SparklesIcon,
  TypeIcon,
  WandSparklesIcon,
  WorkflowIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import {
  type ImageTemplate,
  TEMPLATE_CATEGORIES,
  TEMPLATES,
  type TemplateCategory,
  buildTemplatePrompt,
  exampleValues,
  filterTemplates,
  initialValues,
  missingFields,
} from "@/lib/templates";
import { cn } from "@/lib/utils";

import { Button } from "../ui/button";
import { Input } from "../ui/input";

/** Each category's mark and tint: the cards read by category at a glance. */
const LOOK: Record<TemplateCategory, { icon: LucideIcon; tint: string }> = {
  ecommerce: { icon: ShoppingBagIcon, tint: "#e2704f" },
  poster: { icon: LayoutTemplateIcon, tint: "#d4412a" },
  social: { icon: SmartphoneIcon, tint: "#d65d8f" },
  brand: { icon: PenToolIcon, tint: "#4f74c8" },
  photo: { icon: CameraIcon, tint: "#4f8f6a" },
  illustration: { icon: BrushIcon, tint: "#b5762a" },
  infographic: { icon: WorkflowIcon, tint: "#2f8f93" },
  edit: { icon: WandSparklesIcon, tint: "#8a62c4" },
};

const QUALITY_LABEL = { auto: "自动", low: "低", medium: "中", high: "高" } as const;

export type TemplateUse = {
  template: ImageTemplate;
  prompt: string;
};

export function TemplateGallery({
  onUse,
  useLabel = "填入生图",
  className,
  initialTemplateId,
}: {
  onUse: (use: TemplateUse) => void;
  useLabel?: string;
  className?: string;
  /** Open this template's form straight away. */
  initialTemplateId?: string | null;
}) {
  const [category, setCategory] = useState<TemplateCategory | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<ImageTemplate | null>(
    () => TEMPLATES.find((t) => t.id === initialTemplateId) ?? null,
  );
  const list = useMemo(() => filterTemplates(query, category), [query, category]);

  if (open)
    return (
      <TemplateForm
        key={open.id}
        template={open}
        useLabel={useLabel}
        onBack={() => setOpen(null)}
        onUse={(prompt) => {
          console.info("[templates] use", { template: open.id, length: prompt.length });
          onUse({ template: open, prompt });
        }}
        className={className}
      />
    );

  return (
    <div className={cn("flex min-h-0 flex-col gap-4", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="模板分类" className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          {[{ value: null, label: "全部" } as const, ...TEMPLATE_CATEGORIES].map((item) => {
            const active = item.value === category;
            const count = item.value ? TEMPLATES.filter((t) => t.category === item.value).length : TEMPLATES.length;
            return (
              <button
                key={item.label}
                type="button"
                // biome-ignore lint/a11y/useSemanticElements: chip-style radio, same as the 作品 filter
                role="radio"
                aria-checked={active}
                onClick={() => setCategory(item.value)}
                className={cn(
                  "h-8 rounded-[10px] px-3 text-[13px] font-semibold transition-[background-color,color,box-shadow] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc active:translate-y-px",
                  active
                    ? "bg-panel text-fg shadow-[0_1px_2px_var(--shadow),0_4px_12px_-6px_var(--shadow-2)]"
                    : "bg-tint/[0.05] text-fg-soft hover:text-fg",
                )}
              >
                {item.label}
                <span className="ml-1 text-[11.5px] font-normal text-fg-muted tabular">{count}</span>
              </button>
            );
          })}
        </div>
        <label className="relative w-full sm:w-56">
          <span className="sr-only">搜索模板</span>
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜模板，如 主图、封面" className="h-9 pl-9" />
        </label>
      </div>

      {list.length === 0 ? (
        <p className="rounded-[14px] border border-dashed border-line-strong px-5 py-8 text-center text-[13.5px] text-fg-soft">
          没有找到「{query}」相关的模板，换个说法试试。
        </p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
          {list.map((template) => (
            <li key={template.id}>
              <TemplateCard template={template} onOpen={() => setOpen(template)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TemplateCard({ template, onOpen }: { template: ImageTemplate; onOpen: () => void }) {
  const look = LOOK[template.category];
  const Icon = look.icon;
  const category = TEMPLATE_CATEGORIES.find((c) => c.value === template.category)?.label;
  const preview = useMemo(() => buildTemplatePrompt(template, exampleValues(template)), [template]);
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{ "--tint": look.tint } as React.CSSProperties}
      className="group/card relative flex h-full w-full flex-col overflow-hidden rounded-[16px] bg-panel/80 p-4 text-left shadow-[inset_0_0_0_1px_var(--line),0_1px_2px_var(--shadow)] transition-[box-shadow,translate] duration-300 ease-(--ease-out-expo) hover:-translate-y-0.5 hover:shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--tint)_45%,transparent),0_14px_30px_-18px_color-mix(in_oklab,var(--tint)_70%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc"
    >
      {/* A wash of the category's colour, stronger on hover. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -top-10 -right-10 size-32 rounded-full opacity-[0.16] blur-2xl transition-opacity duration-300 group-hover/card:opacity-30"
        style={{ background: look.tint }}
      />
      <span className="relative flex items-center gap-2.5">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-[11px] text-white shadow-[0_6px_14px_-8px_var(--tint)] [&_svg]:size-[18px]"
          style={{ background: look.tint }}
        >
          <Icon strokeWidth={2} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-semibold text-fg">{template.name}</span>
          <span className="block text-[11.5px] text-fg-muted">{category}</span>
        </span>
      </span>
      <span className="relative mt-3 block text-[13px] leading-snug text-fg-soft">{template.summary}</span>
      <span className="relative mt-3 rounded-[10px] bg-tint/[0.045] px-3 py-2 text-[12px] leading-relaxed text-fg-muted">
        <span className="line-clamp-3">
        {preview}
        </span>
      </span>
      <span className="relative mt-auto flex flex-wrap gap-1.5 pt-3 text-[11px] font-semibold">
        {template.reference?.need === "required" ? <Badge>需要原图</Badge> : null}
        {template.reference?.need === "recommended" ? <Badge>建议加参考图</Badge> : null}
        {template.textHeavy ? <Badge>图里有字</Badge> : null}
        <Badge>{[template.aspectRatio ?? "原图比例", template.resolution].join(" · ")}</Badge>
      </span>
    </button>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded-[6px] bg-tint/[0.06] px-1.5 py-0.5 text-fg-soft">{children}</span>;
}

function TemplateForm({
  template,
  useLabel,
  onBack,
  onUse,
  className,
}: {
  template: ImageTemplate;
  useLabel: string;
  onBack: () => void;
  onUse: (prompt: string) => void;
  className?: string | undefined;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => initialValues(template));
  const missing = missingFields(template, values);
  const prompt = buildTemplatePrompt(template, values);
  const look = LOOK[template.category];
  const Icon = look.icon;
  const set = (key: string, value: string) => setValues((prev) => ({ ...prev, [key]: value }));

  return (
    <div className={cn("flex min-h-0 flex-col gap-4", className)} style={{ "--tint": look.tint } as React.CSSProperties}>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="返回模板列表"
          className="flex size-9 shrink-0 items-center justify-center rounded-[11px] bg-tint/[0.06] text-fg-soft transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-acc [&_svg]:size-4"
        >
          <ArrowLeftIcon strokeWidth={2} />
        </button>
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-[11px] text-white [&_svg]:size-[18px]"
          style={{ background: look.tint }}
        >
          <Icon strokeWidth={2} />
        </span>
        <div className="min-w-0">
          <h3 className="truncate text-[16px] font-semibold text-fg">{template.name}</h3>
          <p className="truncate text-[12.5px] text-fg-muted">{template.summary}</p>
        </div>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setValues(exampleValues(template))}>
          <SparklesIcon strokeWidth={1.75} />
          用示例填
        </Button>
      </div>

      <div className="grid min-h-0 gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
        <div className="flex flex-col gap-4">
          {template.fields.map((field) => {
            const id = `tpl-${template.id}-${field.key}`;
            return (
              <div key={field.key}>
                <label htmlFor={field.kind === "choice" ? undefined : id} className="mb-1.5 flex items-baseline gap-2 text-[13px] font-semibold text-fg">
                  {field.label}
                  {field.optional ? <span className="text-[11.5px] font-normal text-fg-muted">可选</span> : null}
                </label>
                {field.kind === "choice" ? (
                  <div role="radiogroup" aria-label={field.label} className="flex flex-wrap gap-1.5">
                    {field.options?.map((option) => {
                      const active = values[field.key] === option;
                      return (
                        <button
                          key={option}
                          type="button"
                          // biome-ignore lint/a11y/useSemanticElements: chip-style radio
                          role="radio"
                          aria-checked={active}
                          onClick={() => set(field.key, option)}
                          className={cn(
                            "min-h-8 rounded-[9px] px-2.5 py-1 text-[12.5px] font-semibold transition-[background-color,color,box-shadow] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc",
                            active
                              ? "bg-[color-mix(in_oklab,var(--tint)_16%,var(--panel))] text-fg shadow-[inset_0_0_0_1.5px_var(--tint)]"
                              : "bg-tint/[0.05] text-fg-soft hover:text-fg",
                          )}
                        >
                          {option}
                        </button>
                      );
                    })}
                  </div>
                ) : field.kind === "textarea" ? (
                  <textarea
                    id={id}
                    rows={4}
                    value={values[field.key] ?? ""}
                    maxLength={field.max ?? 600}
                    onChange={(e) => set(field.key, e.target.value)}
                    placeholder={field.placeholder || field.example}
                    className="block w-full resize-y rounded-[12px] border border-line bg-panel/80 px-3.5 py-2.5 text-[14px] leading-relaxed text-fg outline-none placeholder:text-fg-muted focus-visible:border-acc/70 focus-visible:shadow-[0_0_0_3px_var(--acc-soft)]"
                  />
                ) : (
                  <Input
                    id={id}
                    value={values[field.key] ?? ""}
                    maxLength={field.max ?? 600}
                    onChange={(e) => set(field.key, e.target.value)}
                    placeholder={field.placeholder || field.example}
                  />
                )}
              </div>
            );
          })}
        </div>

        <div className="flex min-h-0 flex-col gap-3">
          <div className="rounded-[14px] bg-tint/[0.045] p-3.5 shadow-[inset_0_0_0_1px_var(--line)]">
            <p className="mb-1.5 flex items-center justify-between text-[12px] font-semibold text-fg-muted">
              会写成这样的提示词
              <span className="font-normal tabular">{prompt.length} 字</span>
            </p>
            <p aria-live="polite" className="max-h-[260px] overflow-y-auto text-[13px] leading-relaxed whitespace-pre-wrap text-fg">
              {prompt}
            </p>
          </div>
          <ul className="flex flex-col gap-1.5 text-[12.5px] leading-relaxed text-fg-soft">
            <li>
              会把参数调成：
              {template.aspectRatio ? `比例 ${template.aspectRatio}，` : "比例不变（跟原图走），"}
              画质 {template.resolution}，质量{QUALITY_LABEL[template.quality]}
            </li>
            {template.reference ? (
              <li className="flex items-start gap-1.5">
                <ImagePlusIcon className="mt-0.5 size-3.5 shrink-0 text-(--tint)" strokeWidth={2} />
                {template.reference.hint}
              </li>
            ) : null}
            {template.textHeavy ? (
              <li className="flex items-start gap-1.5">
                <TypeIcon className="mt-0.5 size-3.5 shrink-0 text-(--tint)" strokeWidth={2} />
                图里要写字：GPT Image 2、Nano Banana Pro 写字更准，出图后检查错字
              </li>
            ) : null}
            {template.tips?.map((tip) => (
              <li key={tip} className="text-fg-muted">
                {tip}
              </li>
            ))}
          </ul>
          <div className="mt-auto flex flex-wrap items-center gap-3 pt-1">
            <Button variant="accent" size="lg" slant disabled={missing.length > 0} onClick={() => onUse(prompt)}>
              <span className="sk-in">{useLabel}</span>
            </Button>
            {missing.length ? (
              <span className="text-[12.5px] text-fg-muted">还差：{missing.map((f) => f.label).join("、")}</span>
            ) : (
              <span className="text-[12.5px] text-fg-muted">填入后还能再改，不会直接生成</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

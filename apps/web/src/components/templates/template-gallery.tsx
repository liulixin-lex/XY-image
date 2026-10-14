"use client";

/**
 * 生图模板 (第 58 条, extended in 第 64 条): browse by category or search,
 * open one, fill a few fields and see the prompt it writes. 「填入生图」
 * hands the prompt and the chosen 比例 / 画质 / 质量 to the caller (the studio
 * composer, or the 技能 page which takes it to the studio). Nothing is
 * generated from here.
 *
 * 第 64 条 adds, in the form: choices with the user's own words (自定义),
 * multi-choice fields, 换一组示例, and 更多设置 — a style for the whole
 * picture, 补充要求, 避免出现 and the output settings. 「存为我的模板」 keeps
 * a filled-in template; 「我的」 lists those and the user's own templates
 * with {blanks} (新建模板). See lib/my-templates.ts.
 */
import { IMAGE_ASPECT_RATIOS, IMAGE_QUALITIES, IMAGE_RESOLUTIONS } from "@loomic/shared";

import { QUALITY_LABEL } from "@/lib/image-model-meta";
import {
  ArrowLeftIcon,
  BookmarkIcon,
  BrushIcon,
  CameraIcon,
  ChevronDownIcon,
  ClapperboardIcon,
  Gamepad2Icon,
  ImagePlusIcon,
  LayoutTemplateIcon,
  LaughIcon,
  type LucideIcon,
  MoonStarIcon,
  PaletteIcon,
  PenToolIcon,
  PlusIcon,
  PresentationIcon,
  SearchIcon,
  ShoppingBagIcon,
  SmartphoneIcon,
  SparklesIcon,
  SquareStackIcon,
  StarIcon,
  ToyBrickIcon,
  Trash2Icon,
  TypeIcon,
  WandSparklesIcon,
  WorkflowIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import {
  CUSTOM_BODY_MAX,
  type MyTemplate,
  blanksOf,
  customTemplate,
  deleteMyTemplate,
  loadMyTemplates,
  newMyTemplateId,
  saveMyTemplate,
} from "@/lib/my-templates";
import {
  type ImageTemplate,
  STYLE_PRESETS,
  TEMPLATE_CATEGORIES,
  TEMPLATES,
  type TemplateCategory,
  type TemplateExtras,
  type TemplateField,
  type TemplateSettings,
  buildTemplatePrompt,
  canPickStyle,
  defaultSettings,
  exampleRounds,
  exampleValues,
  filterTemplates,
  findTemplate,
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
  design: { icon: PresentationIcon, tint: "#3f7fb8" },
  photo: { icon: CameraIcon, tint: "#4f8f6a" },
  film: { icon: ClapperboardIcon, tint: "#7a5c3e" },
  anime: { icon: StarIcon, tint: "#e0638a" },
  comic: { icon: SquareStackIcon, tint: "#c8553d" },
  illustration: { icon: BrushIcon, tint: "#b5762a" },
  render3d: { icon: ToyBrickIcon, tint: "#5b8fd4" },
  art: { icon: PaletteIcon, tint: "#8f6d3a" },
  surreal: { icon: MoonStarIcon, tint: "#7b62c4" },
  meme: { icon: LaughIcon, tint: "#e09b2d" },
  game: { icon: Gamepad2Icon, tint: "#3f9b86" },
  infographic: { icon: WorkflowIcon, tint: "#2f8f93" },
  edit: { icon: WandSparklesIcon, tint: "#8a62c4" },
  mine: { icon: BookmarkIcon, tint: "#d4412a" },
};

// 第 66 条: every level, 极高 / 最高 included; a model without them runs at
// its nearest level (the note under the picker says so).
const QUALITIES = IMAGE_QUALITIES;

export type TemplateUse = {
  template: ImageTemplate;
  prompt: string;
  /** What to set the 比例 / 画质 / 质量 to: the template's suggestion or the user's choice. */
  settings: TemplateSettings;
};

type Opened =
  | { kind: "form"; template: ImageTemplate; preset?: MyTemplate }
  | { kind: "editor"; entry: MyTemplate | null };

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
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [category, setCategory] = useState<TemplateCategory | null>(null);
  const [query, setQuery] = useState("");
  const [mine, setMine] = useState<MyTemplate[]>([]);
  const [open, setOpen] = useState<Opened | null>(() => {
    const template = findTemplate(initialTemplateId);
    return template ? { kind: "form", template } : null;
  });
  useEffect(() => setMine(loadMyTemplates(userId)), [userId]);
  const list = useMemo(
    () => (category === "mine" ? [] : filterTemplates(query, category)),
    [query, category],
  );
  const mineShown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return mine.filter((entry) => !q || entry.name.toLowerCase().includes(q));
  }, [mine, query]);

  const save = (entry: MyTemplate) => setMine(saveMyTemplate(entry, userId));
  const remove = (id: string) => setMine(deleteMyTemplate(id, userId));

  if (open?.kind === "editor")
    return (
      <CustomEditor
        entry={open.entry}
        className={className}
        onCancel={() => setOpen(null)}
        onSaved={(entry) => {
          save(entry);
          setCategory("mine");
          setOpen(null);
        }}
      />
    );
  if (open?.kind === "form")
    return (
      <TemplateForm
        key={`${open.template.id}-${open.preset?.id ?? ""}`}
        template={open.template}
        preset={open.preset}
        useLabel={useLabel}
        onBack={() => setOpen(null)}
        onSave={open.template.category === "mine" ? undefined : save}
        onEdit={
          open.template.category === "mine" && open.preset
            ? () => setOpen({ kind: "editor", entry: open.preset ?? null })
            : undefined
        }
        onUse={(prompt, settings) => {
          console.info("[templates] use", { template: open.template.id, length: prompt.length, settings });
          onUse({ template: open.template, prompt, settings });
        }}
        className={className}
      />
    );

  const openMine = (entry: MyTemplate) => {
    if (entry.kind === "custom") {
      setOpen({ kind: "form", template: customTemplate(entry), preset: entry });
      return;
    }
    const template = findTemplate(entry.templateId);
    if (template) setOpen({ kind: "form", template, preset: entry });
  };

  return (
    <div className={cn("flex min-h-0 flex-col gap-4", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="模板分类" className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          {[
            { value: null, label: "全部", count: TEMPLATES.length } as const,
            { value: "mine" as const, label: "我的", count: mine.length },
            ...TEMPLATE_CATEGORIES.map((c) => ({
              value: c.value,
              label: c.label,
              count: TEMPLATES.filter((t) => t.category === c.value).length,
            })),
          ].map((item) => {
            const active = item.value === category;
            return (
              <button
                key={item.label}
                type="button"
                // biome-ignore lint/a11y/useSemanticElements: chip-style radio, same as the 作品 filter
                role="radio"
                aria-checked={active}
                onClick={() => setCategory(item.value)}
                className={cn(
                  "h-8 rounded-[10px] px-3 text-[13px] font-semibold transition-[background-color,color,box-shadow] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc",
                  active
                    ? "bg-panel text-fg shadow-[0_1px_2px_var(--shadow),0_4px_12px_-6px_var(--shadow-2)]"
                    : "bg-tint/[0.05] text-fg-soft hover:text-fg",
                )}
              >
                {item.label}
                <span className="ml-1 text-[11.5px] font-normal text-fg-muted tabular">{item.count}</span>
              </button>
            );
          })}
        </div>
        <label className="relative w-full sm:w-56">
          <span className="sr-only">搜索模板</span>
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜模板，如 电影、二次元、梗图"
            className="h-9 pl-9"
          />
        </label>
      </div>
      {category === "mine" ? (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
          <li>
            <button
              type="button"
              onClick={() => setOpen({ kind: "editor", entry: null })}
              className="flex h-full min-h-[150px] w-full flex-col items-center justify-center gap-2 rounded-[16px] border border-dashed border-line-strong p-4 text-center text-fg-soft transition-colors hover:border-acc hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc"
            >
              <PlusIcon className="size-5" strokeWidth={2} />
              <span className="text-[14px] font-semibold">新建模板</span>
              <span className="text-[12px] text-fg-muted">自己写描述，用 {"{名称}"} 标出要填的空</span>
            </button>
          </li>
          {mineShown.map((entry) => (
            <li key={entry.id}>
              <MyTemplateCard entry={entry} onOpen={() => openMine(entry)} onDelete={() => remove(entry.id)} />
            </li>
          ))}
          {mine.length === 0 ? (
            <li className="col-span-full text-[12.5px] text-fg-muted">
              在任意模板里填好后点「存为我的模板」，下次直接打开。只保存在这台设备的浏览器里。
            </li>
          ) : null}
        </ul>
      ) : list.length === 0 ? (
        <p className="rounded-[14px] border border-dashed border-line-strong px-5 py-8 text-center text-[13.5px] text-fg-soft">
          没有找到「{query}」相关的模板，换个说法试试，或在「我的」里新建一个。
        </p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
          {list.map((template) => (
            <li key={template.id}>
              <TemplateCard template={template} onOpen={() => setOpen({ kind: "form", template })} />
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
      className="group/card relative flex h-full w-full flex-col overflow-hidden rounded-[16px] bg-panel/80 p-4 text-left shadow-[inset_0_0_0_1px_var(--line),0_1px_2px_var(--shadow)] transition-[box-shadow,translate] duration-300 hover:-translate-y-0.5 hover:shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--tint)_45%,var(--line)),0_14px_30px_-18px_var(--shadow-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc"
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
        <span className="line-clamp-3">{preview}</span>
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

function MyTemplateCard({ entry, onOpen, onDelete }: { entry: MyTemplate; onOpen: () => void; onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const base = entry.kind === "preset" ? findTemplate(entry.templateId) : null;
  const preview = useMemo(() => {
    if (entry.kind === "custom") return entry.body ?? "";
    return base ? buildTemplatePrompt(base, entry.values ?? {}, entry.extras) : "原模板已下线";
  }, [entry, base]);
  return (
    <div className="group/card relative flex h-full flex-col overflow-hidden rounded-[16px] bg-panel/80 shadow-[inset_0_0_0_1px_var(--line),0_1px_2px_var(--shadow)]">
      <button
        type="button"
        onClick={onOpen}
        disabled={entry.kind === "preset" && !base}
        className="flex flex-1 flex-col p-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc disabled:opacity-60"
      >
        <span className="flex items-center gap-2 pr-8">
          <BookmarkIcon className="size-4 shrink-0 text-acc" strokeWidth={2} />
          <span className="truncate text-[15px] font-semibold text-fg">{entry.name}</span>
        </span>
        <span className="mt-1 text-[11.5px] text-fg-muted">
          {entry.kind === "custom" ? "自建模板" : `存档 · ${base?.name ?? "原模板已下线"}`}
        </span>
        <span className="mt-3 rounded-[10px] bg-tint/[0.045] px-3 py-2 text-[12px] leading-relaxed text-fg-muted">
          <span className="line-clamp-3">{preview}</span>
        </span>
      </button>
      <button
        type="button"
        aria-label={confirming ? `确认删除「${entry.name}」` : `删除「${entry.name}」`}
        onClick={() => (confirming ? onDelete() : setConfirming(true))}
        onBlur={() => setConfirming(false)}
        className={cn(
          "absolute top-3 right-3 flex h-7 items-center gap-1 rounded-[8px] px-2 text-[12px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-acc",
          confirming ? "bg-acc text-acc-ink" : "text-fg-muted hover:bg-tint/[0.08] hover:text-fg",
        )}
      >
        <Trash2Icon className="size-3.5" strokeWidth={2} />
        {confirming ? "确认删除" : null}
      </button>
    </div>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return <span className="rounded-[6px] bg-tint/[0.06] px-1.5 py-0.5 text-fg-soft">{children}</span>;
}

/** A chip in a radio or checkbox group. */
function Chip({
  active,
  onClick,
  role,
  children,
}: {
  active: boolean;
  onClick: () => void;
  role: "radio" | "checkbox";
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      // biome-ignore lint/a11y/useSemanticElements: chip-style radio / checkbox
      role={role}
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "min-h-8 rounded-[9px] px-2.5 py-1 text-[12.5px] font-semibold transition-[background-color,color,box-shadow] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc",
        active
          ? "bg-[color-mix(in_oklab,var(--tint)_16%,var(--panel))] text-fg shadow-[inset_0_0_0_1.5px_var(--tint)]"
          : "bg-tint/[0.05] text-fg-soft hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

const TEXTAREA =
  "block w-full resize-y rounded-[12px] border border-line bg-panel/80 px-3.5 py-2.5 text-[14px] leading-relaxed text-fg outline-none placeholder:text-fg-muted focus-visible:border-acc/60 focus-visible:ring-2 focus-visible:ring-acc/20";

function FieldInput({
  id,
  field,
  value,
  onChange,
}: {
  id: string;
  field: TemplateField;
  value: string;
  onChange: (value: string) => void;
}) {
  const options = field.options ?? [];
  const custom = field.kind === "choice" && !field.control && value !== "" && !options.includes(value);
  const [typing, setTyping] = useState(custom);
  if (field.kind === "choice")
    return (
      <div className="flex flex-col gap-2">
        <div role="radiogroup" aria-label={field.label} className="flex flex-wrap gap-1.5">
          {options.map((option) => (
            <Chip
              key={option}
              role="radio"
              active={!typing && value === option}
              onClick={() => {
                setTyping(false);
                onChange(option);
              }}
            >
              {option}
            </Chip>
          ))}
          {field.control ? null : (
            <Chip
              role="radio"
              active={typing}
              onClick={() => {
                setTyping(true);
                if (options.includes(value)) onChange("");
              }}
            >
              自定义…
            </Chip>
          )}
        </div>
        {typing ? (
          <Input
            id={id}
            autoFocus
            value={value}
            maxLength={field.max ?? 200}
            onChange={(e) => onChange(e.target.value)}
            placeholder={`写你自己的「${field.label}」`}
          />
        ) : null}
      </div>
    );
  if (field.kind === "multi") {
    const picked = value ? value.split("、").filter(Boolean) : [];
    const toggle = (option: string) => {
      const next = picked.includes(option) ? picked.filter((p) => p !== option) : [...picked, option];
      onChange(options.filter((o) => next.includes(o)).join("、"));
    };
    return (
      <div role="group" aria-label={field.label} className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <Chip key={option} role="checkbox" active={picked.includes(option)} onClick={() => toggle(option)}>
            {option}
          </Chip>
        ))}
      </div>
    );
  }
  if (field.kind === "textarea")
    return (
      <textarea
        id={id}
        rows={4}
        value={value}
        maxLength={field.max ?? 600}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder || field.example}
        className={TEXTAREA}
      />
    );
  return (
    <Input
      id={id}
      value={value}
      maxLength={field.max ?? 600}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.placeholder || field.example}
    />
  );
}

/** 比例 / 画质 / 质量, shared by the form and the custom-template editor. */
function SettingsPicker({
  settings,
  keepRatio,
  onChange,
}: {
  settings: TemplateSettings;
  /** Edits: offer 「跟原图」 (no ratio). */
  keepRatio: boolean;
  onChange: (settings: TemplateSettings) => void;
}) {
  const set = (patch: Partial<TemplateSettings>) => onChange({ ...settings, ...patch });
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="mb-1.5 text-[12.5px] font-semibold text-fg-soft">比例</p>
        <div role="radiogroup" aria-label="比例" className="flex flex-wrap gap-1.5">
          {keepRatio ? (
            <Chip
              role="radio"
              active={!settings.aspectRatio}
              onClick={() => {
                const { aspectRatio: _drop, ...rest } = settings;
                onChange(rest);
              }}
            >
              跟原图
            </Chip>
          ) : null}
          {IMAGE_ASPECT_RATIOS.map((ratio) => (
            <Chip key={ratio} role="radio" active={settings.aspectRatio === ratio} onClick={() => set({ aspectRatio: ratio })}>
              {ratio}
            </Chip>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <div>
          <p className="mb-1.5 text-[12.5px] font-semibold text-fg-soft">画质</p>
          <div role="radiogroup" aria-label="画质" className="flex gap-1.5">
            {IMAGE_RESOLUTIONS.map((resolution) => (
              <Chip key={resolution} role="radio" active={settings.resolution === resolution} onClick={() => set({ resolution })}>
                {resolution}
              </Chip>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-[12.5px] font-semibold text-fg-soft">质量</p>
          <div role="radiogroup" aria-label="质量" className="flex gap-1.5">
            {QUALITIES.map((quality) => (
              <Chip key={quality} role="radio" active={settings.quality === quality} onClick={() => set({ quality })}>
                {QUALITY_LABEL[quality]}
              </Chip>
            ))}
          </div>
        </div>
      </div>
      <p className="text-[12px] text-fg-muted">选的模型不支持时，生图页会换成最接近的设置。</p>
    </div>
  );
}

function TemplateForm({
  template,
  preset,
  useLabel,
  onBack,
  onUse,
  onSave,
  onEdit,
  className,
}: {
  template: ImageTemplate;
  preset?: MyTemplate | undefined;
  useLabel: string;
  onBack: () => void;
  onUse: (prompt: string, settings: TemplateSettings) => void;
  /** Built-in templates: keep this fill-in under a name. */
  onSave?: ((entry: MyTemplate) => void) | undefined;
  /** The user's own template: change its text. */
  onEdit?: (() => void) | undefined;
  className?: string | undefined;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => ({
    ...initialValues(template),
    ...(preset?.kind === "preset" ? preset.values : {}),
  }));
  const [extras, setExtras] = useState<TemplateExtras>(() => preset?.extras ?? {});
  const [settings, setSettings] = useState<TemplateSettings>(() => preset?.settings ?? defaultSettings(template));
  const [round, setRound] = useState(0);
  const [moreOpen, setMoreOpen] = useState(() => Boolean(preset?.extras?.style || preset?.extras?.detail || preset?.extras?.avoid));
  const [saving, setSaving] = useState<string | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null);
  const missing = missingFields(template, values);
  const prompt = buildTemplatePrompt(template, values, extras);
  const look = LOOK[template.category];
  const Icon = look.icon;
  const rounds = exampleRounds(template);
  const set = (key: string, value: string) => setValues((prev) => ({ ...prev, [key]: value }));
  const styleable = canPickStyle(template);

  const fillExamples = () => {
    setValues(exampleValues(template, round));
    setRound((r) => r + 1);
  };
  const keep = () => {
    const name = (saving ?? "").trim();
    if (!name || !onSave) return;
    onSave({
      id: preset?.kind === "preset" ? preset.id : newMyTemplateId(),
      name: name.slice(0, 40),
      kind: "preset",
      createdAt: Date.now(),
      templateId: template.id,
      values,
      extras,
      settings,
    });
    setSaving(null);
    setSavedName(name.slice(0, 40));
  };

  return (
    <div className={cn("flex min-h-0 flex-col gap-4", className)} style={{ "--tint": look.tint } as React.CSSProperties}>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="返回模板列表"
          className="flex size-9 shrink-0 items-center justify-center rounded-[11px] bg-tint/[0.06] text-fg-soft transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc [&_svg]:size-4"
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
          <h3 className="truncate text-[16px] font-semibold text-fg">{preset ? preset.name : template.name}</h3>
          <p className="truncate text-[12.5px] text-fg-muted">
            {preset?.kind === "preset" ? `存档 · ${template.name}` : template.summary}
          </p>
        </div>
        {template.fields.some((f) => f.example) ? (
          <Button variant="ghost" size="sm" className="ml-auto" onClick={fillExamples}>
            <SparklesIcon strokeWidth={1.75} />
            {rounds > 1 && round > 0 ? "换一组示例" : "用示例填"}
          </Button>
        ) : null}
      </div>
      <div className="grid min-h-0 gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
        <div className="flex flex-col gap-4">
          {template.fields.length === 0 ? (
            <p className="text-[13px] text-fg-soft">这个模板没有要填的空，直接使用即可。</p>
          ) : null}
          {template.fields.map((field) => {
            const id = `tpl-${template.id}-${field.key}`;
            const labelled = field.kind !== "choice" && field.kind !== "multi";
            return (
              <div key={field.key}>
                <label
                  htmlFor={labelled ? id : undefined}
                  className="mb-1.5 flex items-baseline gap-2 text-[13px] font-semibold text-fg"
                >
                  {field.label}
                  {field.optional ? <span className="text-[11.5px] font-normal text-fg-muted">可选</span> : null}
                  {field.kind === "multi" ? <span className="text-[11.5px] font-normal text-fg-muted">可多选</span> : null}
                </label>
                <FieldInput id={id} field={field} value={values[field.key] ?? ""} onChange={(value) => set(field.key, value)} />
              </div>
            );
          })}

          <div className="rounded-[14px] shadow-[inset_0_0_0_1px_var(--line)]">
            <button
              type="button"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((v) => !v)}
              className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left text-[13px] font-semibold text-fg focus-visible:outline-2 focus-visible:outline-acc"
            >
              <span>
                更多设置
                <span className="ml-2 text-[12px] font-normal text-fg-muted">
                  {styleable ? "风格、" : ""}补充要求、避免出现、比例和画质
                </span>
              </span>
              <ChevronDownIcon className={cn("size-4 transition-transform", moreOpen && "rotate-180")} />
            </button>
            {moreOpen ? (
              <div className="flex flex-col gap-4 border-t border-line px-3.5 py-3.5">
                {styleable ? (
                  <div>
                    <p className="mb-1.5 text-[12.5px] font-semibold text-fg-soft">整体风格</p>
                    <div role="radiogroup" aria-label="整体风格" className="flex flex-wrap gap-1.5">
                      <Chip role="radio" active={!extras.style} onClick={() => setExtras((e) => ({ ...e, style: "" }))}>
                        不指定
                      </Chip>
                      {STYLE_PRESETS.map((style) => (
                        <Chip key={style} role="radio" active={extras.style === style} onClick={() => setExtras((e) => ({ ...e, style }))}>
                          {style}
                        </Chip>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div>
                  <label htmlFor={`tpl-${template.id}-detail`} className="mb-1.5 block text-[12.5px] font-semibold text-fg-soft">
                    补充要求
                  </label>
                  <textarea
                    id={`tpl-${template.id}-detail`}
                    rows={2}
                    maxLength={600}
                    value={extras.detail ?? ""}
                    onChange={(e) => setExtras((prev) => ({ ...prev, detail: e.target.value }))}
                    placeholder="还想加的细节，如：人物穿红色外套，画面偏暖"
                    className={TEXTAREA}
                  />
                </div>
                <div>
                  <label htmlFor={`tpl-${template.id}-avoid`} className="mb-1.5 block text-[12.5px] font-semibold text-fg-soft">
                    避免出现
                  </label>
                  <Input
                    id={`tpl-${template.id}-avoid`}
                    maxLength={300}
                    value={extras.avoid ?? ""}
                    onChange={(e) => setExtras((prev) => ({ ...prev, avoid: e.target.value }))}
                    placeholder="如：人群、汽车、强烈的阴影"
                  />
                </div>
                <SettingsPicker settings={settings} keepRatio={!template.aspectRatio} onChange={setSettings} />
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex min-h-0 flex-col gap-3">
          <div className="rounded-[14px] bg-tint/[0.045] p-3.5 shadow-[inset_0_0_0_1px_var(--line)]">
            <p className="mb-1.5 flex items-center justify-between text-[12px] font-semibold text-fg-muted">
              会写成这样的提示词
              <span className="font-normal tabular">{prompt.length} 字</span>
            </p>
            <p aria-live="polite" className="max-h-[260px] overflow-y-auto text-[13px] leading-relaxed whitespace-pre-wrap text-fg">
              {prompt || "（填好上面的空，这里会出现完整的描述）"}
            </p>
          </div>
          <ul className="flex flex-col gap-1.5 text-[12.5px] leading-relaxed text-fg-soft">
            <li>
              会把参数调成：
              {settings.aspectRatio ? `比例 ${settings.aspectRatio}，` : "比例不变（跟原图走），"}
              画质 {settings.resolution}，质量{QUALITY_LABEL[settings.quality]}
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
            <Button variant="accent" size="lg" slant disabled={missing.length > 0 || !prompt.trim()} onClick={() => onUse(prompt, settings)}>
              <span className="sk-in">{useLabel}</span>
            </Button>
            {onSave ? (
              saving === null ? (
                <Button variant="ghost" size="sm" onClick={() => setSaving(preset?.kind === "preset" ? preset.name : template.name)}>
                  <BookmarkIcon strokeWidth={1.75} />
                  存为我的模板
                </Button>
              ) : null
            ) : null}
            {onEdit ? (
              <Button variant="ghost" size="sm" onClick={onEdit}>
                <PenToolIcon strokeWidth={1.75} />
                编辑模板
              </Button>
            ) : null}
          </div>
          {saving !== null ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                keep();
              }}
            >
              <Input
                aria-label="模板名称"
                autoFocus
                maxLength={40}
                value={saving}
                onChange={(e) => setSaving(e.target.value)}
                placeholder="给这个模板起个名字"
                className="h-9"
              />
              <Button type="submit" size="sm" disabled={!saving.trim()}>
                保存
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setSaving(null)}>
                取消
              </Button>
            </form>
          ) : null}
          <p className="text-[12.5px] text-fg-muted" aria-live="polite">
            {savedName
              ? `已存到「我的」：${savedName}`
              : missing.length
                ? `还差：${missing.map((f) => f.label).join("、")}`
                : "填入后还能再改，不会直接生成"}
          </p>
        </div>
      </div>
    </div>
  );
}

/** 新建模板 / 编辑模板: the user's own prompt with {blanks} and its settings. */
function CustomEditor({
  entry,
  onCancel,
  onSaved,
  className,
}: {
  entry: MyTemplate | null;
  onCancel: () => void;
  onSaved: (entry: MyTemplate) => void;
  className?: string | undefined;
}) {
  const [name, setName] = useState(entry?.name ?? "");
  const [body, setBody] = useState(
    entry?.body ?? "{主体}站在{场景}里，{光线:黄昏的金色逆光}，电影剧照质感，竖构图。画面中没有文字。",
  );
  const [settings, setSettings] = useState<TemplateSettings>(
    entry?.settings ?? { aspectRatio: "3:4", resolution: "2K", quality: "high" },
  );
  const blanks = blanksOf(body);
  const ok = name.trim().length > 0 && body.trim().length > 0;
  const look = LOOK.mine;
  return (
    <div className={cn("flex min-h-0 flex-col gap-4", className)} style={{ "--tint": look.tint } as React.CSSProperties}>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onCancel}
          aria-label="返回模板列表"
          className="flex size-9 shrink-0 items-center justify-center rounded-[11px] bg-tint/[0.06] text-fg-soft transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc [&_svg]:size-4"
        >
          <ArrowLeftIcon strokeWidth={2} />
        </button>
        <div className="min-w-0">
          <h3 className="truncate text-[16px] font-semibold text-fg">{entry ? "编辑模板" : "新建模板"}</h3>
          <p className="truncate text-[12.5px] text-fg-muted">写一段描述，把每次要换的地方写成 {"{名称}"}，可以加默认值 {"{名称:默认值}"}</p>
        </div>
      </div>
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
        <div className="flex flex-col gap-4">
          <div>
            <label htmlFor="my-template-name" className="mb-1.5 block text-[13px] font-semibold text-fg">
              名称
            </label>
            <Input id="my-template-name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="如：我的产品白底图" />
          </div>
          <div>
            <label htmlFor="my-template-body" className="mb-1.5 flex items-baseline justify-between text-[13px] font-semibold text-fg">
              描述
              <span className="text-[11.5px] font-normal text-fg-muted tabular">
                {body.length}/{CUSTOM_BODY_MAX}
              </span>
            </label>
            <textarea
              id="my-template-body"
              rows={7}
              maxLength={CUSTOM_BODY_MAX}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className={TEXTAREA}
            />
          </div>
          <SettingsPicker settings={settings} keepRatio onChange={setSettings} />
        </div>
        <div className="flex flex-col gap-3">
          <div className="rounded-[14px] bg-tint/[0.045] p-3.5 shadow-[inset_0_0_0_1px_var(--line)]">
            <p className="mb-2 text-[12px] font-semibold text-fg-muted">要填的空（{blanks.length}）</p>
            {blanks.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {blanks.map((blank) => (
                  <li key={blank.name} className="rounded-[8px] bg-panel px-2 py-1 text-[12.5px] text-fg shadow-[inset_0_0_0_1px_var(--line)]">
                    {blank.name}
                    {blank.fallback ? <span className="text-fg-muted">（默认：{blank.fallback}）</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12.5px] text-fg-soft">还没有空：这段描述会原样填入。</p>
            )}
          </div>
          <ul className="flex flex-col gap-1.5 text-[12.5px] leading-relaxed text-fg-muted">
            <li>写法建议：先说用途和画幅，再写场景、主体、细节，最后写限制（如「画面中没有文字」）。</li>
            <li>图里要出现的字放进引号里，写清字体、颜色和位置。</li>
            <li>只保存在这台设备的浏览器里。</li>
          </ul>
          <div className="mt-auto flex flex-wrap items-center gap-3 pt-1">
            <Button
              variant="accent"
              size="lg"
              slant
              disabled={!ok}
              onClick={() =>
                onSaved({
                  id: entry?.id ?? newMyTemplateId(),
                  name: name.trim().slice(0, 40),
                  kind: "custom",
                  createdAt: entry?.createdAt ?? Date.now(),
                  body: body.slice(0, CUSTOM_BODY_MAX),
                  settings,
                })
              }
            >
              <span className="sk-in">保存模板</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={onCancel}>
              取消
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

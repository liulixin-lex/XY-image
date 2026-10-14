/**
 * 我的模板 (第 64 条): templates the user keeps for themselves.
 *
 * - 存档 (kind "preset"): a built-in template with the fields, extras and
 *   output settings the user filled in, saved under a name — open it and
 *   everything is as they left it.
 * - 自建 (kind "custom"): the user's own prompt with blanks written as
 *   {名称} or {名称:默认值}; each blank becomes a field in the same form the
 *   built-in templates use.
 *
 * Stored in this browser (localStorage, one list per signed-in user), not
 * on the server: nothing here leaves the device, and it works signed out.
 * TODO(agent01): move to a table if users ask for the same templates on
 * several devices.
 */
import type { ImageQuality, ImageResolution } from "@loomic/shared";

import type { AspectRatio } from "./image-model-meta";
import type { ImageTemplate, TemplateExtras, TemplateField, TemplateSettings } from "./templates";

export type MyTemplate = {
  id: string;
  name: string;
  kind: "preset" | "custom";
  createdAt: number;
  /** preset: the built-in template it fills in. */
  templateId?: string;
  /** preset: the field values. */
  values?: Record<string, string>;
  extras?: TemplateExtras;
  settings?: TemplateSettings;
  /** custom: the prompt with {blanks}. */
  body?: string;
};

const STORAGE_PREFIX = "xy-my-templates-v1";
/** Keeps the list (and localStorage) small. */
export const MY_TEMPLATES_MAX = 100;
export const CUSTOM_BODY_MAX = 4000;

function storageKey(userId?: string | null) {
  return userId ? `${STORAGE_PREFIX}:${userId}` : STORAGE_PREFIX;
}

function isEntry(value: unknown): value is MyTemplate {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<MyTemplate>;
  return (
    typeof entry.id === "string" &&
    typeof entry.name === "string" &&
    (entry.kind === "preset" || entry.kind === "custom") &&
    typeof entry.createdAt === "number"
  );
}

export function loadMyTemplates(userId?: string | null): MyTemplate[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch (error) {
    console.warn("[templates] my templates unreadable, starting empty", error);
    return [];
  }
}

function store(list: MyTemplate[], userId?: string | null) {
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(list.slice(0, MY_TEMPLATES_MAX)));
  } catch (error) {
    // Quota or private mode: the list still works for this visit.
    console.warn("[templates] could not save my templates", error);
  }
}

/** Adds (or replaces, by id) an entry at the top; returns the new list. */
export function saveMyTemplate(entry: MyTemplate, userId?: string | null): MyTemplate[] {
  const list = [entry, ...loadMyTemplates(userId).filter((item) => item.id !== entry.id)];
  store(list, userId);
  console.info("[templates] saved my template", { kind: entry.kind, id: entry.id });
  return list.slice(0, MY_TEMPLATES_MAX);
}

export function deleteMyTemplate(id: string, userId?: string | null): MyTemplate[] {
  const list = loadMyTemplates(userId).filter((item) => item.id !== id);
  store(list, userId);
  return list;
}

export function newMyTemplateId() {
  return `my-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** {名称} or {名称:默认值}; names up to 20 characters, no braces or colons. */
const BLANK = /\{([^{}:：\n]{1,20})(?:[:：]([^{}\n]{0,200}))?\}/g;

/** The blanks in a custom template, in order of first appearance. */
export function blanksOf(body: string): Array<{ name: string; fallback: string }> {
  const seen = new Map<string, string>();
  for (const match of body.matchAll(BLANK)) {
    const name = (match[1] ?? "").trim();
    if (name && !seen.has(name)) seen.set(name, (match[2] ?? "").trim());
  }
  return [...seen].map(([name, fallback]) => ({ name, fallback }));
}

/** Fills the blanks; an empty value falls back to the blank's default. */
export function fillBlanks(body: string, values: Readonly<Record<string, string>>) {
  return body.replace(BLANK, (_all, rawName: string, rawFallback?: string) => {
    const name = rawName.trim();
    return (values[name] ?? "").trim() || (rawFallback ?? "").trim();
  });
}

/** A custom entry as a template the gallery's form can fill in. */
export function customTemplate(entry: MyTemplate): ImageTemplate {
  const body = (entry.body ?? "").slice(0, CUSTOM_BODY_MAX);
  const fields: TemplateField[] = blanksOf(body).map(({ name, fallback }) => ({
    key: name,
    label: name,
    placeholder: fallback ? `默认：${fallback}` : "",
    example: fallback,
    optional: Boolean(fallback),
  }));
  const settings: TemplateSettings = entry.settings ?? { resolution: "2K", quality: "auto" };
  return {
    id: entry.id,
    name: entry.name,
    category: "mine",
    summary: "我的模板",
    fields,
    build: (v) => fillBlanks(body, v),
    ...(settings.aspectRatio ? { aspectRatio: settings.aspectRatio as AspectRatio } : {}),
    resolution: settings.resolution as ImageResolution,
    quality: settings.quality as ImageQuality,
  };
}

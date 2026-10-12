/**
 * Image models across keys (第 56 条).
 *
 * /api/image-models lists every model of every main-site key that is on, so
 * the same model can appear twice (two keys, two groups, two prices). A
 * model is therefore picked as a (key, model) pair, its ref
 * `<keyId>:<modelId>`, and requests carry `key_id` with `model`. Older
 * servers send no keyId: their refs are `:<modelId>` and requests go
 * without a key (the server's default key), as before.
 */
import type { ReactNode } from "react";

import { describeCapabilities, modelCapabilities } from "./image-model-meta";
import type { ImageModelInfo } from "./server-api";

export type ModelRef = string;

export function refOf(id: string, keyId?: number | null): ModelRef {
  return `${keyId ?? ""}:${id}`;
}

export function modelRef(model: Pick<ImageModelInfo, "id" | "keyId">): ModelRef {
  return refOf(model.id, model.keyId);
}

export function parseModelRef(ref: string): { id: string; keyId: number | null } {
  const at = ref.indexOf(":");
  if (at < 0) return { id: ref, keyId: null };
  const key = Number(ref.slice(0, at));
  return {
    id: ref.slice(at + 1),
    keyId: at > 0 && Number.isInteger(key) && key > 0 ? key : null,
  };
}

/**
 * The listed model a ref (or id + key) names. A ref whose key is gone or off
 * falls back to the same model under another key; a bare id takes the first
 * key that has it (the list puts the default key first).
 */
export function findModel(
  models: readonly ImageModelInfo[],
  wanted: ModelRef | { id: string | null | undefined; keyId?: number | null } | null | undefined,
): ImageModelInfo | null {
  if (!wanted) return null;
  const { id, keyId } =
    typeof wanted === "string" ? parseModelRef(wanted) : { id: wanted.id ?? "", keyId: wanted.keyId ?? null };
  if (!id) return null;
  return (
    (keyId !== null ? models.find((m) => m.id === id && m.keyId === keyId) : undefined) ??
    models.find((m) => m.id === id) ??
    null
  );
}

/**
 * The account's default model: the default model on the default key, else
 * that model under any key that is on, else the first listed.
 */
export function defaultModel(
  models: readonly ImageModelInfo[],
  prefs: { image_key_id: number | null; default_image_model: string | null } | null | undefined,
): ImageModelInfo | null {
  if (models.length === 0) return null;
  return findModel(models, { id: prefs?.default_image_model, keyId: prefs?.image_key_id ?? null }) ?? models[0] ?? null;
}

/** True when the list spans more than one key: pickers then group by key. */
export function spansSeveralKeys(models: readonly ImageModelInfo[]): boolean {
  const first = models[0]?.keyId;
  return models.some((m) => m.keyId !== first);
}

/** 「Key 名 · 分组」 for the key a model comes through. */
export function keyLabel(model: Pick<ImageModelInfo, "keyName" | "groupName" | "keyId">): string {
  const name = model.keyName?.trim() || (model.keyId ? `Key ${model.keyId}` : "当前 Key");
  return model.groupName ? `${name} · ${model.groupName}` : name;
}

/**
 * The model's name, with its key when the same model is listed under
 * another key too (so two 「GPT Image 2」 entries can be told apart).
 */
export function modelLabel(model: ImageModelInfo, models: readonly ImageModelInfo[]): string {
  const twin = models.some((m) => m.id === model.id && m.keyId !== model.keyId);
  return twin ? `${model.displayName}（${model.keyName?.trim() || `Key ${model.keyId}`}）` : model.displayName;
}

/** What a request sends for a model: its id, and the key when known. */
export function modelRequest(model: Pick<ImageModelInfo, "id" | "keyId">): { model: string; key_id?: number } {
  return model.keyId ? { model: model.id, key_id: model.keyId } : { model: model.id };
}

export type ModelOption = {
  value: ModelRef;
  text: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  group?: { key: string; label: ReactNode };
};

/**
 * Picker options for image models, grouped by key when several keys are on.
 * `describe` replaces the default line (description · capabilities);
 * `unavailable` returns why a model can't be picked here (shown, disabled).
 */
export function imageModelOptions(
  models: readonly ImageModelInfo[],
  options: {
    describe?: (model: ImageModelInfo) => string;
    unavailable?: (model: ImageModelInfo) => string | null;
  } = {},
): ModelOption[] {
  const grouped = spansSeveralKeys(models);
  return models.map((m) => {
    const reason = options.unavailable?.(m) ?? null;
    return {
      value: modelRef(m),
      text: modelLabel(m, models),
      label: m.displayName,
      description:
        reason ?? options.describe?.(m) ?? `${m.description} · ${describeCapabilities(modelCapabilities(m))}`,
      ...(reason ? { disabled: true } : {}),
      ...(grouped ? { group: { key: String(m.keyId ?? ""), label: keyLabel(m) } } : {}),
    };
  });
}

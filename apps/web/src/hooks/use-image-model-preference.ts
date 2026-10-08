"use client";

/**
 * Which image models the design agent may pick from.
 *
 * `auto` lets the agent choose among whatever the selected image key can
 * reach. `manual` restricts it to the listed ids. There is deliberately no
 * hard-coded default model: availability depends on the user's key group,
 * so an empty manual list collapses back to `auto`.
 */
import { useCallback, useSyncExternalStore } from "react";
import type { ImageGenerationPreference } from "@loomic/shared";

const STORAGE_KEY = "xy:image-model-preference";

export type ImageModelPreference = ImageGenerationPreference;

const defaultPreference: ImageModelPreference = { mode: "auto", models: [] };

const listeners = new Set<() => void>();
function emitChange() {
  for (const listener of listeners) listener();
}

// useSyncExternalStore needs a stable reference per raw value.
let cachedRaw: string | null = null;
let cachedPreference: ImageModelPreference = defaultPreference;

function getSnapshot(): ImageModelPreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      cachedPreference = raw
        ? normalizePreference(JSON.parse(raw) as Partial<ImageModelPreference>)
        : defaultPreference;
    }
    return cachedPreference;
  } catch {
    return defaultPreference;
  }
}

function getServerSnapshot(): ImageModelPreference {
  return defaultPreference;
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function normalizePreference(
  preference?: Partial<ImageModelPreference>,
): ImageModelPreference {
  if (!preference) return defaultPreference;
  const models = Array.isArray(preference.models)
    ? preference.models.filter(
        (model): model is string => typeof model === "string" && model.length > 0,
      )
    : [];
  if (preference.mode !== "manual" || models.length === 0) return defaultPreference;
  return { mode: "manual", models };
}

/**
 * Drop ids the current key can no longer reach. Returns undefined (= auto)
 * when nothing usable is left, so the agent never receives a dead model.
 */
export function resolveImagePreference(
  preference: ImageModelPreference,
  availableIds: readonly string[] | null,
): ImageModelPreference | undefined {
  if (preference.mode !== "manual") return undefined;
  const models = availableIds
    ? preference.models.filter((id) => availableIds.includes(id))
    : preference.models;
  return models.length ? { mode: "manual", models } : undefined;
}

export function useImageModelPreference() {
  const preference = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setPreference = useCallback((next: ImageModelPreference) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizePreference(next)));
    emitChange();
  }, []);

  const setMode = useCallback(
    (mode: "auto" | "manual") => {
      setPreference({ ...preference, mode });
    },
    [preference, setPreference],
  );

  const toggleModel = useCallback(
    (model: string) => {
      const current = preference.mode === "manual" ? preference.models : [];
      const models = current.includes(model)
        ? current.filter((item) => item !== model)
        : [...current, model];
      setPreference({ mode: models.length ? "manual" : "auto", models });
    },
    [preference, setPreference],
  );

  const activeImageGenerationPreference =
    preference.mode === "manual" && preference.models.length > 0
      ? preference
      : undefined;

  return {
    preference,
    setPreference,
    setMode,
    toggleModel,
    activeImageGenerationPreference,
  };
}

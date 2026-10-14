/**
 * What a generator would send, and why it can't yet (第 56 条).
 *
 * Shared by the 生成 node itself and by the prompt card's 「全部生成」, which
 * runs every generator it feeds at once: both must send the same model, key
 * and values the node shows.
 */
import { type ResolvedImageParams, resolveImageParams } from "@loomic/shared";

import { modelCapabilities } from "../image-model-meta";
import { defaultModel, findModel } from "../image-model-ref";
import type { ImageModelInfo } from "../server-api";
import type { GeneratorConfig } from "./generator";
import {
  type GeneratorInputs,
  type SendParams,
  composePrompt,
  upstreamBlocker,
} from "./runtime";

export type ModelPrefs = {
  image_key_id: number | null;
  default_image_model: string | null;
} | null;

export type GeneratorPlan = {
  /** The model it will use; null while none is listed. */
  model: ImageModelInfo | null;
  /** The node's own model is listed (on its key, or the same model on another). */
  pickedHere: boolean;
  /** What will be sent: the node's values moved to the model's nearest ones. */
  send: Omit<ResolvedImageParams, "adjusted">;
  refLimit: number;
  /** Connected prompts, then the node's own text. */
  prompt: string;
  /** Why 生成 is off; null when it can send. */
  blockedReason: string | null;
  /** What `runtime.generate` gets; null when blocked. */
  params: SendParams | null;
};

export function planGenerator({
  config,
  inputs,
  own = config.prompt,
  models,
  prefs,
  accountSettled,
  modelsLoading,
  modelsError,
}: {
  config: GeneratorConfig;
  inputs: Pick<GeneratorInputs, "prompts" | "upstream"> & { imageCount: number };
  /** The node's text as typed (it is saved as it goes). */
  own?: string;
  models: readonly ImageModelInfo[];
  prefs: ModelPrefs;
  /** The account (with the saved default) arrived or failed. */
  accountSettled: boolean;
  modelsLoading: boolean;
  modelsError: string | null;
}): GeneratorPlan {
  // The node's model (its key first, else the same model on a key that is
  // on), else the account default, else the first listed.
  const picked = config.model
    ? findModel(models, { id: config.model, keyId: config.keyId })
    : null;
  const model = picked ?? defaultModel(models, prefs);
  // Without its own model the node waits for the account (FINDINGS G3): the
  // first model listed before the saved default arrives would be sent.
  const awaitingDefault = !picked && !accountSettled;
  const caps = modelCapabilities(model);
  const { adjusted: _adjusted, ...send } = resolveImageParams(caps, {
    resolution: config.resolution,
    quality: config.quality,
    aspectRatio: config.aspectRatio,
    outputFormat: config.outputFormat,
    outputCompression: config.outputCompression,
    background: config.background,
    moderation: config.moderation,
  });
  const prompt = composePrompt(inputs, own);
  const refLimit = caps.maxInputImages;
  const blockedReason = modelsError
    ? "开着的 Key 都不能生图"
    : !model
      ? modelsLoading
        ? "正在读取可用模型"
        : "开着的 Key 里没有生图模型"
      : awaitingDefault
        ? "正在读取默认模型"
        : upstreamBlocker(inputs.upstream) ??
          (inputs.imageCount > refLimit
            ? refLimit === 0
              ? `${model.displayName} 不支持参考图`
              : `${model.displayName} 最多 ${refLimit} 张参考图`
            : !prompt
              ? "先写描述，或连一张提示词卡片进来"
              : null);
  return {
    model,
    pickedHere: Boolean(picked),
    send,
    refLimit,
    prompt,
    blockedReason,
    params:
      model && !blockedReason
        ? {
            model: model.id,
            keyId: model.keyId ?? null,
            aspectRatio: send.aspectRatio,
            resolution: send.resolution,
            quality: send.quality,
            outputFormat: send.outputFormat,
            outputCompression: send.outputCompression,
            background: send.background,
            moderation: send.moderation,
          }
        : null,
  };
}

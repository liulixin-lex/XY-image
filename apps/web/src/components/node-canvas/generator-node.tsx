"use client";

/**
 * 生成 node: model and settings, a description of its own, and the prompt
 * cards and pictures connected into it. One click on 生成 sends one batch
 * (lib/node-canvas/runtime.ts); its pictures show as pending in their slots
 * and the worker puts each finished one there.
 *
 * Copy follows the billing wording rules: no "charged" labels; a result the
 * page cannot account for is 待核对.
 */
import { resolveImageParams } from "@loomic/shared";
import type { NodeProps } from "@xyflow/react";
import { SparklesIcon } from "lucide-react";
import Link from "next/link";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAccount, useImageModels } from "../../lib/account-context";
import { describeIssue } from "../../lib/generation-errors";
import { describeOutcome, isActiveJob } from "../../lib/image-jobs";
import {
  ASPECT_RATIOS,
  QUALITIES,
  QUALITY_HINT,
  QUALITY_LABEL,
  RESOLUTIONS,
  RESOLUTION_HINT,
  describeCapabilities,
  modelCapabilities,
  resolutionUnavailable,
} from "../../lib/image-model-meta";
import { jobIdOf } from "../../lib/node-canvas/element";
import {
  type GeneratorConfig,
  readGenerator,
  updateGenerator,
} from "../../lib/node-canvas/generator";
import { composePrompt, generatorInputs } from "../../lib/node-canvas/runtime";
import type { SceneNode } from "../../lib/node-canvas/types";
import { cn } from "../../lib/utils";
import { LiveDot } from "../ambient/live-dot";
import { Picker } from "../ui/select";
import { useNodeCanvas, useRuntimeState, useStoreState } from "./context";
import { CardNode, NodeHandles } from "./node-parts";

const PROMPT_MAX = 4000;
const COUNTS = [1, 2, 3, 4] as const;

const pickerClass =
  "nodrag h-7 min-w-[64px] border-transparent bg-transparent px-2 text-[13px] tabular hover:bg-tint/[0.06]";

function Row({
  label,
  children,
}: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex h-8 items-center justify-between gap-3">
      <span className="text-[13px] text-fg-soft">{label}</span>
      {children}
    </div>
  );
}

export const GeneratorNode = memo(function GeneratorNode({
  id,
  data,
  selected,
}: NodeProps<SceneNode>) {
  const { store, runtime } = useNodeCanvas();
  const config = readGenerator(data.el);
  const {
    data: modelList,
    loading: modelsLoading,
    error: modelsError,
  } = useImageModels();
  const { account } = useAccount();
  const models = useMemo(() => modelList ?? [], [modelList]);
  const preferred = account.data?.preferences.default_image_model ?? null;

  // The node's model if the key reaches it, else the account default, else the first.
  const model =
    models.find((m) => m.id === config.model) ??
    models.find((m) => m.id === preferred) ??
    models[0] ??
    null;
  const caps = modelCapabilities(model);
  const send = resolveImageParams(caps, {
    resolution: config.resolution,
    quality: config.quality,
    aspectRatio: config.aspectRatio,
  });

  // What feeds this node; a key string keeps drags elsewhere from re-rendering it.
  const inputsKey = useStoreState((state) => {
    const inputs = generatorInputs(state.scene.nodes, state.scene.edges, id);
    return JSON.stringify([
      inputs.prompts,
      inputs.images.map((image) => image.id),
    ]);
  });
  const [connectedPrompts, imageIds] = JSON.parse(inputsKey) as [
    string[],
    string[],
  ];

  const sending = useRuntimeState((state) => state.sending.has(id));
  const issue = useRuntimeState((state) => state.errors.get(id) ?? null);
  const partial = useRuntimeState((state) => state.partial.get(id) ?? null);
  const jobs = useRuntimeState((state) => state.jobs);
  const runJobIds = useMemo(
    () => (config.run?.jobs ?? []).map((job) => job.jobId),
    [config.run],
  );
  const placedKey = useStoreState((state) => {
    const wanted = new Set(runJobIds);
    return state.scene.nodes
      .flatMap((node) => {
        const jobId = node.type === "image" ? jobIdOf(node.data.el) : null;
        return jobId && wanted.has(jobId) ? [jobId] : [];
      })
      .join(",");
  });

  const update = useCallback(
    (changes: Partial<Omit<GeneratorConfig, "run">>) =>
      store.updateElement(id, (el) => updateGenerator(el, changes)),
    [store, id],
  );

  // Own description: typed text is saved as it goes, one undo step per edit.
  const [own, setOwn] = useState(config.prompt);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setOwn(config.prompt);
  }, [config.prompt]);
  const area = useRef<HTMLTextAreaElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the text changes
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [own]);

  const prompt = composePrompt({ prompts: connectedPrompts, images: [] }, own);
  const refLimit = caps.maxInputImages;
  const blockedReason = modelsError
    ? "当前 Key 不能生图"
    : !model
      ? modelsLoading
        ? "正在读取可用模型"
        : "当前 Key 没有可用的生图模型"
      : imageIds.length > refLimit
        ? refLimit === 0
          ? `${model.displayName} 不支持参考图`
          : `${model.displayName} 最多 ${refLimit} 张参考图`
        : !prompt
          ? "先写描述，或连一张提示词卡片进来"
          : null;
  const canGenerate = !blockedReason && !sending;

  const generate = useCallback(() => {
    if (!canGenerate || !model) return;
    void runtime.generate(id, {
      model: model.id,
      aspectRatio: send.aspectRatio,
      resolution: send.resolution,
      quality: send.quality,
    });
  }, [
    canGenerate,
    model,
    runtime,
    id,
    send.aspectRatio,
    send.resolution,
    send.quality,
  ]);

  const modelOptions = useMemo(
    () =>
      models.map((m) => ({
        value: m.id,
        text: m.displayName,
        label: m.displayName,
        description: `${m.description} · ${describeCapabilities(modelCapabilities(m))}`,
      })),
    [models],
  );
  const ratioOptions = useMemo(
    () =>
      ASPECT_RATIOS.map((r) => ({
        value: r,
        text: r,
        label: r,
        disabled: !caps.aspectRatios.includes(r),
        ...(caps.aspectRatios.includes(r)
          ? {}
          : { description: "当前模型不支持" }),
      })),
    [caps.aspectRatios],
  );
  const resolutionOptions = useMemo(
    () =>
      RESOLUTIONS.map((r) => {
        const reason = resolutionUnavailable(
          { resolutions: caps.resolutions, maxRatio: caps.maxRatio },
          r,
          send.aspectRatio,
        );
        return {
          value: r,
          text: r,
          label: r,
          disabled: reason !== null,
          description: reason ?? RESOLUTION_HINT[r],
        };
      }),
    [caps.resolutions, caps.maxRatio, send.aspectRatio],
  );
  const qualityOptions = useMemo(
    () =>
      QUALITIES.map((q) => {
        const enabled = q === "auto" || caps.qualities.includes(q);
        return {
          value: q,
          text: QUALITY_LABEL[q],
          label: QUALITY_LABEL[q],
          disabled: !enabled,
          description: enabled ? QUALITY_HINT[q] : "当前模型不可调",
        };
      }),
    [caps.qualities],
  );

  const status = runStatus(
    runJobIds,
    placedKey ? new Set(placedKey.split(",")) : new Set(),
    jobs,
  );
  const bumpedUp =
    send.resolution !== config.resolution &&
    caps.resolutions.includes(config.resolution);

  return (
    <>
      <CardNode
        icon={<SparklesIcon className="size-4" strokeWidth={1.75} />}
        title="生成"
        selected={selected}
        aside={
          <Picker
            value={model?.id ?? null}
            onValueChange={(value) => update({ model: value })}
            options={modelOptions}
            ariaLabel="生图模型"
            placeholder={modelsLoading ? "读取模型…" : "无可用模型"}
            disabled={sending || models.length === 0}
            align="end"
            className="nodrag h-7 max-w-[150px] border-transparent bg-transparent px-2 text-[12.5px] text-fg-soft hover:bg-tint/[0.06]"
            popupClassName="w-[280px]"
          />
        }
      >
        <div className="flex flex-col px-3.5">
          <Row label="比例">
            <Picker
              value={send.aspectRatio}
              onValueChange={(value) => update({ aspectRatio: value })}
              options={ratioOptions}
              ariaLabel="画面比例"
              disabled={sending}
              align="end"
              className={pickerClass}
            />
          </Row>
          <Row label="画质">
            <Picker
              value={send.resolution}
              onValueChange={(value) =>
                update({ resolution: value as GeneratorConfig["resolution"] })
              }
              options={resolutionOptions}
              ariaLabel="画质"
              disabled={sending}
              align="end"
              className={pickerClass}
              popupClassName="w-[240px]"
            />
          </Row>
          <Row label="质量">
            <Picker
              value={send.quality}
              onValueChange={(value) =>
                update({ quality: value as GeneratorConfig["quality"] })
              }
              options={qualityOptions}
              ariaLabel="质量"
              disabled={sending}
              align="end"
              className={pickerClass}
              popupClassName="w-[200px]"
            />
          </Row>
          <Row label="数量">
            <div
              role="radiogroup"
              aria-label="数量"
              className="nodrag flex items-center gap-0.5"
            >
              {COUNTS.map((n) => (
                <button
                  key={n}
                  type="button"
                  // biome-ignore lint/a11y/useSemanticElements: a segmented control; buttons keep the room's button styling and focus ring
                  role="radio"
                  aria-checked={config.count === n}
                  disabled={sending}
                  onClick={() => update({ count: n })}
                  className={cn(
                    "flex size-7 items-center justify-center rounded-md text-[13px] tabular transition-colors focus-visible:outline-2 focus-visible:outline-acc disabled:cursor-not-allowed",
                    config.count === n
                      ? "bg-fg text-ground"
                      : "text-fg-soft hover:bg-tint/[0.06]",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </Row>
          <Row label="参考图">
            <span
              className={cn(
                "pr-2 text-[13px] tabular",
                imageIds.length > refLimit ? "text-alert" : "text-fg",
              )}
            >
              {imageIds.length}
              <span className="text-fg-muted"> / {refLimit}</span>
            </span>
          </Row>
          {bumpedUp ? (
            <p className="pb-1 text-[12px] leading-snug text-fg-muted">
              {send.aspectRatio} 最小 {send.resolution}，按 {send.resolution}{" "}
              出图
            </p>
          ) : null}
        </div>

        <label htmlFor={`generator-prompt-${id}`} className="sr-only">
          描述
        </label>
        <textarea
          id={`generator-prompt-${id}`}
          ref={area}
          value={own}
          maxLength={PROMPT_MAX}
          rows={2}
          disabled={sending}
          placeholder={
            connectedPrompts.length
              ? "补充描述（可选），接在连入的提示词后面"
              : "描述想要的画面，或连一张提示词卡片进来"
          }
          onFocus={() => {
            editing.current = true;
            store.beginEdit();
          }}
          onBlur={() => {
            editing.current = false;
            store.endEdit();
          }}
          onChange={(event) => {
            const next = event.target.value;
            setOwn(next);
            store.updateElement(
              id,
              (el) => updateGenerator(el, { prompt: next }),
              { record: false },
            );
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              generate();
            }
          }}
          className="nodrag nowheel mx-3.5 mt-1 block resize-none rounded-md bg-well/70 px-2.5 py-2 text-[13px] leading-relaxed text-fg outline-none placeholder:text-fg-muted focus-visible:ring-2 focus-visible:ring-acc/40 disabled:opacity-60"
        />

        <div className="flex flex-col gap-2 p-3.5 pt-3">
          <button
            type="button"
            onClick={generate}
            disabled={!canGenerate}
            title={blockedReason ?? "生成（⌘/Ctrl + Enter）"}
            className="nodrag flex h-10 items-center justify-center gap-2 rounded-lg bg-acc text-[14px] font-semibold text-acc-ink shadow-acc transition-[background-color,transform] duration-150 hover:bg-acc-hover active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc disabled:cursor-not-allowed disabled:bg-line-strong disabled:text-fg-muted disabled:shadow-none"
          >
            {sending ? (
              <>
                <LiveDot className="bg-acc-ink" />
                正在发送
              </>
            ) : (
              `生成 ${config.count} 张`
            )}
          </button>
          <GeneratorNotice
            modelsError={modelsError}
            issue={issue}
            partial={partial}
            // An empty description is already explained by the placeholder.
            blockedReason={prompt ? blockedReason : null}
            status={status}
          />
        </div>
      </CardNode>
      <NodeHandles />
    </>
  );
});

type RunStatus = { text: string; tone: "live" | "done" | "warn" } | null;

/** One line about the latest run: how many pictures arrived, are on the way, need checking. */
function runStatus(
  jobIds: readonly string[],
  placed: ReadonlySet<string>,
  jobs: ReadonlyMap<string, Parameters<typeof describeOutcome>[0]>,
): RunStatus {
  if (jobIds.length === 0) return null;
  let done = 0;
  let live = 0;
  let unknown = 0;
  let failed = 0;
  for (const jobId of jobIds) {
    if (placed.has(jobId)) {
      done++;
      continue;
    }
    const job = jobs.get(jobId);
    if (!job || isActiveJob(job) || job.status === "succeeded") {
      live++;
      continue;
    }
    const tone = describeOutcome(job).tone;
    if (tone === "unknown" || tone === "charged_failed") unknown++;
    else failed++;
  }
  const total = jobIds.length;
  const parts = [`已完成 ${done}/${total}`];
  if (live) parts.push(`生成中 ${live}`);
  if (unknown) parts.push(`${unknown} 张待核对`);
  if (failed) parts.push(`${failed} 张没出图`);
  return {
    text: parts.join(" · "),
    tone: unknown || failed ? "warn" : live ? "live" : "done",
  };
}

function GeneratorNotice({
  modelsError,
  issue,
  partial,
  blockedReason,
  status,
}: {
  modelsError: string | null;
  issue: ReturnType<typeof describeIssue> | null;
  partial: { queued: number; requested: number } | null;
  blockedReason: string | null;
  status: RunStatus;
}) {
  if (modelsError) {
    const spec = describeIssue(modelsError, null);
    return (
      <output className="block text-[12.5px] leading-snug text-fg-soft">
        {spec.title}。
        <Link
          href="/settings?tab=keys"
          className="nodrag ml-0.5 underline underline-offset-2"
        >
          去选择 Key
        </Link>
      </output>
    );
  }
  return (
    <>
      {issue ? (
        <p
          role="alert"
          className="rounded-md bg-alert-wash px-2.5 py-2 text-[12.5px] leading-snug text-alert"
        >
          <span className="font-semibold">{issue.title}</span>
          <span className="ml-1">
            {issue.maybeCharged
              ? "图片可能已经生成，请先核对再重试。"
              : issue.message}
          </span>
        </p>
      ) : null}
      {partial ? (
        <output className="block text-[12.5px] leading-snug text-fg-soft">
          只排上了 {partial.queued}/{partial.requested} 张，其余没有发出。
        </output>
      ) : null}
      {status ? (
        <output
          className={cn(
            "flex items-center gap-1.5 text-[12.5px] tabular",
            status.tone === "warn"
              ? "text-warn"
              : status.tone === "done"
                ? "text-ok"
                : "text-fg-soft",
          )}
        >
          {status.tone === "live" ? <LiveDot /> : null}
          {status.text}
        </output>
      ) : blockedReason ? (
        <p className="text-[12px] leading-snug text-fg-muted">
          {blockedReason}
        </p>
      ) : null}
    </>
  );
}

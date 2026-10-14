"use client";

/**
 * 生成 node: model and settings, a description of its own, and the prompt
 * cards and pictures connected into it. One click on 生成 sends one batch
 * (lib/node-canvas/runtime.ts); its pictures show as pending in their slots
 * and the worker puts each finished one there.
 *
 * 第 56 条: the model can come from any key that is on (the picker groups
 * them by key), the inputs are listed with a 断开 each, and 「接着生成」 adds
 * a generator fed by this one's pictures (链式).
 *
 * Copy follows the billing wording rules: no "charged" labels; a result the
 * page cannot account for is 待核对.
 */
import type { NodeProps } from "@xyflow/react";
import { IMAGE_BATCH_MAX } from "@loomic/shared";
import {
  ArrowRightIcon,
  ImageIcon,
  MinusIcon,
  PlusIcon,
  SparklesIcon,
  TextQuoteIcon,
  TypeIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAccount, useImageModels } from "../../lib/account-context";
import { describeIssue } from "../../lib/generation-errors";
import { describeOutcome, isActiveJob } from "../../lib/image-jobs";
import {
  ASPECT_RATIOS,
  BACKGROUND_HINT,
  BACKGROUND_LABEL,
  COMPRESSION_PRESETS,
  MODERATION_HINT,
  MODERATION_LABEL,
  OUTPUT_FORMAT_HINT,
  OUTPUT_FORMAT_LABEL,
  QUALITY_LABEL,
  RESOLUTIONS,
  RESOLUTION_HINT,
  defaultFormatLabel,
  modelCapabilities,
  qualityHint,
  qualityOptions as qualityLevels,
  resolutionUnavailable,
} from "../../lib/image-model-meta";
import {
  imageModelOptions,
  modelRef,
} from "../../lib/image-model-ref";
import { jobIdOf } from "../../lib/node-canvas/element";
import {
  type GeneratorConfig,
  readGenerator,
  updateGenerator,
} from "../../lib/node-canvas/generator";
import { planGenerator } from "../../lib/node-canvas/generator-plan";
import {
  type InputLink,
  type UpstreamRun,
  generatorInputs,
} from "../../lib/node-canvas/runtime";
import type { SceneNode } from "../../lib/node-canvas/types";
import { cn } from "../../lib/utils";
import { LiveDot } from "../ambient/live-dot";
import { Picker } from "../ui/select";
import { useNodeCanvas, useRuntimeState, useStoreState } from "./context";
import { CardNode, NodeHandles } from "./node-parts";

const PROMPT_MAX = 4000;

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
  const { store, runtime, actions } = useNodeCanvas();
  const config = readGenerator(data.el);
  const {
    data: modelList,
    loading: modelsLoading,
    error: modelsError,
  } = useImageModels();
  const { account } = useAccount();
  const models = useMemo(() => modelList ?? [], [modelList]);
  const prefs = account.data?.preferences ?? null;

  // What feeds this node; a key string keeps drags elsewhere from re-rendering it.
  const inputsKey = useStoreState((state) => {
    const inputs = generatorInputs(state.scene.nodes, state.scene.edges, id);
    const byId = new Map(state.scene.nodes.map((node) => [node.id, node]));
    return JSON.stringify([
      inputs.prompts,
      inputs.images.map((image) => image.id),
      inputs.upstream,
      inputs.links.map((link) => ({
        ...link,
        text: linkText(byId.get(link.sourceId)?.data.el.text),
      })),
    ]);
  });
  const [connectedPrompts, imageIds, upstream, links] = JSON.parse(
    inputsKey,
  ) as [string[], string[], UpstreamRun[], (InputLink & { text: string })[]];

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

  // Model, values and what stops 生成: the same rules 「全部生成」 uses.
  const plan = planGenerator({
    config,
    inputs: { prompts: connectedPrompts, upstream, imageCount: imageIds.length },
    own,
    models,
    prefs,
    accountSettled: Boolean(account.data) || Boolean(account.error),
    modelsLoading,
    modelsError,
  });
  const { model, send, refLimit, prompt, blockedReason, params } = plan;
  const caps = modelCapabilities(model);
  const canGenerate = Boolean(params) && !sending;

  const generate = useCallback(() => {
    if (!canGenerate || !params) return;
    void runtime.generate(id, params);
  }, [canGenerate, params, runtime, id]);

  const modelOptions = useMemo(() => imageModelOptions(models), [models]);
  const chooseModel = useCallback(
    (ref: string) => {
      const picked = models.find((m) => modelRef(m) === ref);
      if (!picked) return;
      update({ model: picked.id, keyId: picked.keyId ?? null });
      console.info("[node-canvas] generator model", {
        generator: id,
        model: picked.id,
        key: picked.keyId ?? null,
      });
    },
    [models, update, id],
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
  // 第 66 条: only the levels this model has (GPT Image 2.5 adds 极高 /
  // 最高); a level kept from another model shows as its nearest one.
  const qualityOptions = useMemo(
    () =>
      qualityLevels(caps).map((q) => ({
        value: q,
        text: QUALITY_LABEL[q],
        label: QUALITY_LABEL[q],
        description: caps.qualities.length
          ? qualityHint(q, caps)
          : "当前模型不可调，由模型决定",
      })),
    [caps],
  );
  // 第 66 条: OpenAI output options; rows only for models that take them.
  const formatOptions = useMemo(
    () => [
      {
        value: "default",
        text: "默认",
        label: defaultFormatLabel(caps),
        description: "按站点设置",
      },
      ...caps.outputFormats.map((f) => ({
        value: f,
        text: OUTPUT_FORMAT_LABEL[f],
        label: OUTPUT_FORMAT_LABEL[f],
        description: OUTPUT_FORMAT_HINT[f],
      })),
    ],
    [caps],
  );
  const compressionOptions = useMemo(
    () => [
      {
        value: "default",
        text: "默认",
        label: caps.outputDefaults ? `默认 · ${caps.outputDefaults.compression}` : "默认",
        description: "按站点设置",
      },
      ...COMPRESSION_PRESETS.map((value) => ({
        value: String(value),
        text: String(value),
        label: String(value),
        description: value === 100 ? "压缩最少，文件最大" : "数字越小文件越小",
      })),
    ],
    [caps.outputDefaults],
  );
  const backgroundOptions = useMemo(
    () =>
      caps.backgrounds.map((b) => ({
        value: b,
        text: BACKGROUND_LABEL[b],
        label: BACKGROUND_LABEL[b],
        description: BACKGROUND_HINT[b],
      })),
    [caps.backgrounds],
  );
  const moderationOptions = useMemo(
    () =>
      caps.moderations.map((m) => ({
        value: m,
        text: MODERATION_LABEL[m],
        label: MODERATION_LABEL[m],
        description: MODERATION_HINT[m],
      })),
    [caps.moderations],
  );
  const effectiveFormat = send.outputFormat ?? caps.outputDefaults?.format ?? "jpeg";

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
            value={model ? modelRef(model) : null}
            onValueChange={chooseModel}
            options={modelOptions}
            ariaLabel="生图模型"
            placeholder={modelsLoading ? "读取模型…" : "无可用模型"}
            disabled={sending || models.length === 0}
            align="end"
            className="nodrag h-7 max-w-[150px] border-transparent bg-transparent px-2 text-[12.5px] text-fg-soft hover:bg-tint/[0.06]"
            popupClassName="w-[300px]"
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
          {caps.outputFormats.length ? (
            <Row label="格式">
              <Picker
                value={send.outputFormat ?? "default"}
                onValueChange={(value) =>
                  update({
                    outputFormat:
                      value === "default"
                        ? null
                        : (value as GeneratorConfig["outputFormat"]),
                  })
                }
                options={formatOptions}
                ariaLabel="格式"
                disabled={sending}
                align="end"
                className={pickerClass}
                popupClassName="w-[240px]"
              />
            </Row>
          ) : null}
          {caps.outputFormats.length && effectiveFormat !== "png" ? (
            <Row label="压缩">
              <Picker
                value={
                  send.outputCompression === null
                    ? "default"
                    : String(send.outputCompression)
                }
                onValueChange={(value) =>
                  update({
                    outputCompression: value === "default" ? null : Number(value),
                  })
                }
                options={compressionOptions}
                ariaLabel="压缩"
                disabled={sending}
                align="end"
                className={pickerClass}
                popupClassName="w-[220px]"
              />
            </Row>
          ) : null}
          {caps.backgrounds.length ? (
            <Row label="背景">
              <Picker
                value={send.background}
                onValueChange={(value) =>
                  update({ background: value as GeneratorConfig["background"] })
                }
                options={backgroundOptions}
                ariaLabel="背景"
                disabled={sending}
                align="end"
                className={pickerClass}
                popupClassName="w-[260px]"
              />
            </Row>
          ) : null}
          {caps.moderations.length ? (
            <Row label="审核">
              <Picker
                value={send.moderation}
                onValueChange={(value) =>
                  update({ moderation: value as GeneratorConfig["moderation"] })
                }
                options={moderationOptions}
                ariaLabel="审核"
                disabled={sending}
                align="end"
                className={pickerClass}
                popupClassName="w-[260px]"
              />
            </Row>
          ) : null}
          <Row label="数量">
            <CountInput
              value={config.count}
              disabled={sending}
              onChange={(count) => update({ count })}
            />
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
          {links.length ? (
            <InputList
              links={links}
              upstream={upstream}
              disabled={sending}
              onDisconnect={(edgeId) => store.disconnect(edgeId)}
              onFocus={actions.focus}
            />
          ) : null}
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
          {status && status.tone !== "live" && placedKey ? (
            <button
              type="button"
              onClick={() => actions.chainFrom(id)}
              title="新加一个「生成」，用这次出的图做参考图"
              className="nodrag -mb-1 inline-flex h-7 items-center gap-1 self-start rounded-md px-1.5 text-[12.5px] font-semibold text-fg-soft transition-colors hover:bg-tint/[0.06] hover:text-fg focus-visible:outline-2 focus-visible:outline-acc"
            >
              接着生成
              <ArrowRightIcon className="size-3.5" strokeWidth={2.2} />
            </button>
          ) : null}
        </div>
      </CardNode>
      <NodeHandles />
    </>
  );
});

/**
 * 数量: any number (第 57 条; IMAGE_BATCH_MAX only guards runaway input),
 * typed or stepped. Settles on blur or Enter; one undo step per change.
 */
function CountInput({
  value,
  disabled,
  onChange,
}: {
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setText(String(value));
  }, [value]);
  const settle = (raw: string) => {
    const n = Number.parseInt(raw, 10);
    const next = Number.isFinite(n) ? Math.min(IMAGE_BATCH_MAX, Math.max(1, n)) : value;
    setText(String(next));
    if (next !== value) onChange(next);
  };
  const step =
    "flex size-6 items-center justify-center rounded-md text-fg-soft transition-colors hover:bg-tint/[0.07] hover:text-fg focus-visible:outline-2 focus-visible:outline-acc disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div role="group" aria-label="数量" className="nodrag flex items-center gap-0.5">
      <button
        type="button"
        aria-label="少一张"
        disabled={disabled || value <= 1}
        onClick={() => onChange(Math.max(1, value - 1))}
        className={step}
      >
        <MinusIcon className="size-3.5" strokeWidth={2.4} />
      </button>
      <input
        type="text"
        inputMode="numeric"
        aria-label="张数"
        value={text}
        disabled={disabled}
        onFocus={(event) => {
          editing.current = true;
          event.currentTarget.select();
        }}
        onChange={(event) => setText(event.target.value.replace(/\D+/g, "").slice(0, 3))}
        onBlur={(event) => {
          editing.current = false;
          settle(event.target.value);
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        className="nowheel h-7 w-10 rounded-md bg-tint/[0.05] text-center text-[13px] font-semibold tabular text-fg outline-none focus-visible:ring-2 focus-visible:ring-acc/40 disabled:opacity-60"
      />
      <button
        type="button"
        aria-label="多一张"
        disabled={disabled || value >= IMAGE_BATCH_MAX}
        onClick={() => onChange(Math.min(IMAGE_BATCH_MAX, value + 1))}
        className={step}
      >
        <PlusIcon className="size-3.5" strokeWidth={2.4} />
      </button>
    </div>
  );
}

/** A short excerpt of a prompt card's text for the input list. */
function linkText(text: unknown): string {
  if (typeof text !== "string") return "";
  const line = text.trim().replace(/\s+/g, " ");
  return line.length > 14 ? `${line.slice(0, 14)}…` : line;
}

const LINK_ICON = {
  prompt: TextQuoteIcon,
  text: TypeIcon,
  image: ImageIcon,
  generator: SparklesIcon,
  other: ImageIcon,
} as const;

/**
 * What is connected in, one chip each: click to find it on the canvas, ×
 * to disconnect (断开) — the way to undo a connection on any device.
 */
function InputList({
  links,
  upstream,
  disabled,
  onDisconnect,
  onFocus,
}: {
  links: (InputLink & { text: string })[];
  upstream: UpstreamRun[];
  disabled: boolean;
  onDisconnect: (edgeId: string) => void;
  onFocus: (id: string) => void;
}) {
  let pictures = 0;
  return (
    <ul aria-label="连入的内容" className="flex flex-wrap gap-1 pt-1 pb-1.5">
      {links.map((link) => {
        const Icon = LINK_ICON[link.kind];
        const run = upstream.find((item) => item.id === link.sourceId);
        const text =
          link.kind === "prompt" || link.kind === "text"
            ? link.text || "空提示词"
            : link.kind === "generator"
              ? run?.pictures
                ? `上游 ${run.pictures} 张`
                : run?.waiting
                  ? "上游出图中"
                  : "上游未出图"
              : `图片 ${++pictures}`;
        return (
          <li
            key={link.edgeId}
            className="group/link flex h-7 max-w-full items-center rounded-md bg-tint/[0.055] text-[12px] text-fg-soft transition-colors hover:bg-tint/[0.09]"
          >
            <button
              type="button"
              onClick={() => onFocus(link.sourceId)}
              title="在画布上找到它"
              className="nodrag flex h-full min-w-0 items-center gap-1 pr-0.5 pl-2 focus-visible:outline-2 focus-visible:outline-acc"
            >
              <Icon className="size-3.5 shrink-0" strokeWidth={1.9} />
              <span className="max-w-[118px] truncate">{text}</span>
            </button>
            <button
              type="button"
              onClick={() => onDisconnect(link.edgeId)}
              disabled={disabled}
              aria-label={`断开：${text}`}
              title="断开"
              className="nodrag flex size-6 shrink-0 items-center justify-center rounded-[5px] text-fg-muted transition-colors hover:bg-alert-wash hover:text-alert focus-visible:outline-2 focus-visible:outline-acc disabled:opacity-40"
            >
              <XIcon className="size-3" strokeWidth={2.4} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

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
          去看 Key
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

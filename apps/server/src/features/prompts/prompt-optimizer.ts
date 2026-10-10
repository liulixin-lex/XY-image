import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import { createStreamingChatModel } from "../../agent/deep-agent.js";
import type { ServerEnv } from "../../config/env.js";
import { describeErrorForLog } from "../../utils/error-sanitizer.js";
import { createCustomChatModel } from "../chat-providers/chat-model.js";
import { findChatProviderError } from "../chat-providers/errors.js";
import {
  type ResolvedChat,
  resolveRunChatModel,
} from "../chat-providers/model-resolver.js";
import type { ChatProviderService } from "../chat-providers/service.js";
import { BillingGuardError } from "../xy2api/errors.js";
import type { KeyService } from "../xy2api/key-service.js";

/**
 * "优化提示词" in the studio: one chat request that turns a short description
 * into a concrete image prompt. It runs on the user's own chat model (the
 * same choice as the design assistant: a personal provider, or the main
 * site's chat Key), so it costs a little of their balance; the page says so.
 * Sent once, no retry (maxRetries 0 on both model factories).
 */
export const PROMPT_OPTIMIZER_SYSTEM = `你是图像生成提示词编辑。把用户的描述改写成一段更具体、可以直接交给生图模型的提示词。
规则：
- 保留用户的原意、主体和他明确提出的要求，不换题材。
- 补充具体的画面信息：主体细节、场景、构图和景别、光线、色彩、材质、风格、镜头或画幅。
- 不要加入用户没提到的真实人物、品牌、商标，也不要凭空加入画面里的文字。
- 用户写了要出现在画面里的文字时，原样保留并加引号。
- 只输出改写后的提示词本身：不要解释，不要标题，不要分点，不要用引号包住全文。
- 中文不超过 200 字，英文不超过 120 个词。
- 用和用户输入相同的语言。`;

/** Longest answer kept; the image prompt itself allows 4000 characters. */
const MAX_OUTPUT = 1200;
const TIMEOUT_MS = 45_000;

export type PromptOptimizer = {
  optimize(
    userId: string,
    input: { prompt: string; aspect_ratio?: string | undefined },
  ): Promise<{ prompt: string; model: string }>;
};

type ModelFactory = (resolved: ResolvedChat) => BaseLanguageModel;

const defaultModelFactory: ModelFactory = (resolved) =>
  resolved.source === "custom"
    ? createCustomChatModel(resolved.customChat)
    : createStreamingChatModel(resolved.ref, resolved.credentials);

export function createPromptOptimizer(deps: {
  keys: KeyService;
  providers: ChatProviderService;
  env: Pick<ServerEnv, "xy2apiBaseUrl" | "agentModel">;
  /** Tests replace the chat model. */
  createModel?: ModelFactory;
}): PromptOptimizer {
  const createModel = deps.createModel ?? defaultModelFactory;
  return {
    async optimize(userId, input) {
      const resolved = await resolveRunChatModel({
        userId,
        keys: deps.keys,
        providers: deps.providers,
        env: deps.env,
      });
      const modelName =
        resolved.source === "custom"
          ? resolved.customChat.model
          : resolved.ref.replace(/^openai:/, "");
      const started = Date.now();
      const ratio = input.aspect_ratio
        ? `画面比例 ${input.aspect_ratio}（只用来考虑构图，不要写进提示词）\n\n`
        : "";
      let answer: unknown;
      try {
        answer = await createModel(resolved).invoke(
          [
            new SystemMessage(PROMPT_OPTIMIZER_SYSTEM),
            new HumanMessage(`${ratio}${input.prompt}`),
          ],
          { signal: AbortSignal.timeout(TIMEOUT_MS) },
        );
      } catch (error) {
        console.warn(
          `[prompt-optimizer] user ${userId} ${resolved.source}:${modelName} failed after ${Date.now() - started}ms: ${describeErrorForLog(error)}`,
        );
        throw toClientError(error, resolved.source === "custom");
      }
      const prompt = cleanPrompt(textOf(answer));
      if (!prompt) {
        console.warn(
          `[prompt-optimizer] user ${userId} ${resolved.source}:${modelName} returned nothing usable`,
        );
        throw new BillingGuardError(
          "upstream_busy",
          502,
          "这次没有改写出内容，请换个说法再试",
        );
      }
      console.log(
        `[prompt-optimizer] user ${userId} ${resolved.source}:${modelName} ${input.prompt.length}→${prompt.length} chars in ${Date.now() - started}ms`,
      );
      return { prompt, model: modelName };
    },
  };
}

/** Text of a chat answer (string content, or the text parts of a content list). */
export function textOf(answer: unknown): string {
  if (typeof answer === "string") return answer;
  const content = (answer as { content?: unknown } | null)?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((part) =>
        typeof part === "string"
          ? part
          : part && typeof part === "object" && "text" in part
            ? String((part as { text: unknown }).text ?? "")
            : "",
      )
      .join("");
  return "";
}

/**
 * Models sometimes wrap the answer anyway: a code fence, a "提示词：" label,
 * or quotes around the whole text. Keep only the prompt.
 */
export function cleanPrompt(raw: string): string {
  let text = raw.trim();
  text = text.replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/, "");
  text = text.replace(/^(优化后的?)?(提示词|prompt)\s*[:：]\s*/i, "");
  const pairs: [string, string][] = [
    ['"', '"'],
    ["“", "”"],
    ["「", "」"],
    ["'", "'"],
  ];
  for (const [open, close] of pairs)
    if (
      text.length > 2 &&
      text.startsWith(open) &&
      text.endsWith(close) &&
      !text.slice(1, -1).includes(close)
    )
      text = text.slice(1, -1).trim();
  return text.slice(0, MAX_OUTPUT).trim();
}

/**
 * Keep the user-facing meaning of a known refusal (balance, Key, provider,
 * moderation); anything else is a plain "try again". The image wording of
 * upstream_unknown ("可能已扣费") does not fit a chat request.
 */
function toClientError(error: unknown, custom: boolean) {
  const provider = findChatProviderError(error);
  if (provider) return provider;
  let current: unknown = error;
  for (let i = 0; i < 8 && current && typeof current === "object"; i++) {
    if (
      current instanceof BillingGuardError &&
      current.code !== "upstream_unknown"
    )
      return current;
    current = "cause" in current ? current.cause : undefined;
  }
  return new BillingGuardError(
    "upstream_busy",
    502,
    custom
      ? "你的对话服务商没有完成这次改写，请稍后再试"
      : "这次改写没有完成，请稍后再试",
  );
}

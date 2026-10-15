import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type {
  BaseCheckpointSaver,
  BaseStore,
} from "@langchain/langgraph-checkpoint";
import { ChatOpenAI } from "@langchain/openai";
import {
  type ChatEffort,
  type ChatModelRef,
  chatWebSearchMode,
  defaultExecutionEffort,
  parseChatModelRef,
  resolveChatEffort,
  usesResponsesApi,
} from "@loomic/shared";
import {
  createFilesystemMiddleware,
  createPatchToolCallsMiddleware,
} from "deepagents";
import { createAgent, type createMiddleware } from "langchain";
import { createCustomChatModel } from "../features/chat-providers/chat-model.js";
import {
  GatewayError,
  gatewayDiagnostics,
  mapGatewayError,
} from "../features/xy2api/errors.js";
import type { UserSupabaseClient } from "../supabase/user.js";

import { Agent as HttpAgent, fetch as httpFetch } from "undici";
import type { ServerEnv } from "../config/env.js";
import { sharedWebSearchService } from "../features/web-search/service.js";
import type { AvailableModel } from "../generation/providers/registry.js";
import {
  isContextOverflowText,
  markContextOverflow,
} from "../utils/context-overflow.js";
import { describeErrorForLog } from "../utils/error-sanitizer.js";
import { XY2API_USER_AGENT } from "../utils/user-agent.js";
import type { ConnectionManager } from "../ws/connection-manager.js";
import {
  type AgentBackendResult,
  createAgentBackend,
} from "./backends/index.js";
import { createContextWindowMiddleware } from "./context-window.js";
import { createGluedToolCallMiddleware } from "./glued-tool-calls.js";
import {
  type SearchRoute,
  type SentEffort,
  chatEffortKwargs,
  createChatOptionsMiddleware,
  planningEffort,
} from "./model-options.js";
import { ChatConnectError, createModelRetryMiddleware } from "./model-retry.js";
import { createProjectMemoryMiddleware } from "./project-memory.js";
import { LOOMIC_SYSTEM_PROMPT } from "./prompts/loomic-main.js";
import {
  RUN_RECURSION_LIMIT,
  createLoopGuardMiddleware,
  createReadToolRetryMiddleware,
  createToolDietMiddleware,
} from "./run-guards.js";
import { skillsSection } from "./skills-prompt.js";
import { separateToolCallIndexes } from "./tool-call-stream.js";
import { createToolErrorMiddleware } from "./tool-errors.js";
import type {
  SubmitWorkflowBatchFn,
  WaitForJobsFn,
} from "./tools/canvas-workflow.js";
import type {
  PersistImageFn,
  SubmitImageJobFn,
} from "./tools/image-generate.js";
import { createMainAgentTools } from "./tools/index.js";
import { createWebTools } from "./tools/web-search.js";
import {
  type ReviewImageStore,
  createVisionReviewMiddleware,
} from "./vision.js";
import type { WorkspaceSkillEntry } from "./workspace-skills.js";

export type LoomicAgent = Pick<
  ReturnType<typeof createAgent>,
  "stream" | "streamEvents"
> &
  // The compiled graph: state of a thread, for 压缩 (runtime.compactSession).
  Partial<Pick<ReturnType<typeof createAgent>, "graph">>;

export type LoomicAgentFactory = (options: {
  backendResult?: AgentBackendResult;
  brandKitId?: string | null;
  canvasId?: string;
  checkpointer?: BaseCheckpointSaver;
  connectionManager?: ConnectionManager;
  createUserClient?: (accessToken: string) => UserSupabaseClient;
  env: ServerEnv;
  model?: BaseLanguageModel | string;
  persistImage?: PersistImageFn;

  submitImageJob?: SubmitImageJobFn;
  imageModels?: AvailableModel[];
  credentials?: { apiKey: string; baseUrl: string };
  customChat?: Parameters<typeof createCustomChatModel>[0];
  /** 第 67 条: 思考强度, 联网搜索, prompt cache key (model-options.ts). */
  chatOptions?: ChatRunOptions;
  /** 第 67 条 审图: pictures the model is shown (vision.ts). */
  reviewImages?: ReviewImageStore;
  /** 第 69 条: running 生成 nodes from the chat (tools/canvas-workflow.ts). */
  workflow?: WorkflowDeps;
  /** 第 70 条: the model and level after a tool result (runtime.ts). */
  execution?: ExecutionOptions;
  /** 第 70 条: search_web's last resort (tools/web-search.ts fallback). */
  searchFallback?: { baseUrl: string; apiKey: string; model: string };
  store?: BaseStore;
  workspaceSkills?: WorkspaceSkillEntry[];
}) => LoomicAgent;

/**
 * 第 70 条 执行步骤: what the calls after a tool result use (设置 › 模型 ›
 * 执行步骤模型, resolved in runtime.ts). `model` missing: the chat model.
 * `effort` missing: 低 where the model takes it (defaultExecutionEffort).
 */
export type ExecutionOptions = {
  model?:
    | {
        source: "xy2api";
        /** openai:<model> */
        ref: string;
        credentials: { apiKey: string; baseUrl: string };
      }
    | {
        source: "custom";
        customChat: Parameters<typeof createCustomChatModel>[0];
        providerId: string;
      };
  effort?: ChatEffort;
};

export type WorkflowDeps = {
  submitBatch: SubmitWorkflowBatchFn;
  waitForJobs: WaitForJobsFn;
  notifyCanvas?: () => void;
};

export type ChatRunOptions = {
  effort?: ChatEffort;
  webSearch?: boolean;
  /** Sent as prompt_cache_key: one per conversation thread. */
  promptCacheKey?: string;
};

/**
 * Our middleware, after deepagents' own. Glued parallel tool calls from some
 * gateways are split back into separate calls (glued-tool-calls.ts).
 * Innermost tool-call middleware: tool errors go back to the model instead
 * of ending the run (tool-errors.ts). Every wrapModelCall hook adds a layer
 * of MiddlewareError around model errors (see utils/error-chain.ts).
 * Innermost model-call middleware: a call refused as busy, or one that got
 * no response, is sent again (model-retry.ts, 第 67 条).
 */
export function loomicAgentMiddleware(
  extra: ReturnType<typeof createMiddleware>[] = [],
  context: ReturnType<typeof createMiddleware>[] = [],
) {
  return [
    createGluedToolCallMiddleware(),
    // 第 69 条: no ls / glob / grep in front of the model.
    createToolDietMiddleware(),
    // 第 70 条: the same tool call a third time in a row is not run (there
    // is no budget of model calls any more, see run-guards.ts).
    createLoopGuardMiddleware(),
    createToolErrorMiddleware(),
    // Inside the tool-errors one: read-only tools get a second try first.
    createReadToolRetryMiddleware(),
    // Project memory and other system-prompt context (project-memory.ts).
    ...context,
    createModelRetryMiddleware(),
    // Innermost: built-in web search and the effort fallback (第 67 条).
    ...extra,
  ];
}

export function createLoomicDeepAgent(options: {
  backendResult?: AgentBackendResult;
  brandKitId?: string | null;
  canvasId?: string;
  checkpointer?: BaseCheckpointSaver;
  connectionManager?: ConnectionManager;
  createUserClient?: (accessToken: string) => UserSupabaseClient;
  env: ServerEnv;
  model?: BaseLanguageModel | string;
  persistImage?: PersistImageFn;

  submitImageJob?: SubmitImageJobFn;
  imageModels?: AvailableModel[];
  credentials?: { apiKey: string; baseUrl: string };
  customChat?: Parameters<typeof createCustomChatModel>[0];
  chatOptions?: ChatRunOptions;
  reviewImages?: ReviewImageStore;
  workflow?: WorkflowDeps;
  execution?: ExecutionOptions;
  searchFallback?: { baseUrl: string; apiKey: string; model: string };
  store?: BaseStore;
  workspaceSkills?: WorkspaceSkillEntry[];
}): LoomicAgent {
  const backendResult =
    options.backendResult ?? createAgentBackend(options.env, options.canvasId);

  const modelSpec = options.model ?? createDefaultModelSpecifier(options.env);
  // 第 67 条: the chat options this model takes (chat-options.ts decides,
  // the chat panel shows the same), and a builder for the effort fallback.
  const ref: ChatModelRef | null = options.customChat
    ? {
        source: "custom",
        providerId: "custom",
        model: options.customChat.model,
      }
    : typeof modelSpec === "string"
      ? parseChatModelRef(
          modelSpec.includes(":") ? modelSpec : `openai:${modelSpec}`,
        )
      : null;
  const chatOptions = options.chatOptions ?? {};
  const chosenEffort = resolveChatEffort(ref, chatOptions.effort);
  // 第 69 条: the first call of a turn thinks at the chosen level (自动 = 中
  // where the model takes it); 第 70 条: the calls after a tool result use
  // the execution model and level (below).
  const effort = planningEffort(ref, chosenEffort);
  // 第 68 条: every model searches one way or another (chat-options.ts).
  const searchMode = chatOptions.webSearch ? chatWebSearchMode(ref) : null;
  const hostedSearch = searchMode === "hosted";
  const promptCacheKey = chatOptions.promptCacheKey;
  const build = (sent: SentEffort, hosted = hostedSearch) =>
    options.customChat
      ? createCustomChatModel({
          ...options.customChat,
          effort: sent,
          ...(promptCacheKey ? { promptCacheKey } : {}),
        })
      : createStreamingChatModel(modelSpec as string, options.credentials, {
          effort: sent,
          webSearch: hosted,
          ...(promptCacheKey ? { promptCacheKey } : {}),
        });
  const builtHere =
    Boolean(options.customChat) || typeof modelSpec === "string";
  const resolvedModel = builtHere
    ? build(effort)
    : (modelSpec as BaseLanguageModel);
  // search_web / read_webpage: the search itself for "gemini" and "free",
  // the fallback for a refused "hosted" one.
  const searchService = sharedWebSearchService(options.env);
  const searchTools =
    builtHere && searchMode
      ? createWebTools({
          mode:
            searchMode === "gemini" && options.credentials ? "gemini" : "free",
          service: searchService,
          ...(searchMode === "gemini" && options.credentials && ref
            ? { gemini: { ...options.credentials, model: ref.model } }
            : {}),
          // 第 69 / 70 条: pages that refuse us are read through AnySearch,
          // within its rests and daily budget (service.ts).
          ...(searchService.extract
            ? {
                extract: (url: string, signal?: AbortSignal) =>
                  (
                    searchService.extract as NonNullable<
                      typeof searchService.extract
                    >
                  )(url, signal),
              }
            : {}),
          // 第 70 条: when every free source is empty (AnySearch's quota
          // used up), Gemini's Google Search on the user's key.
          ...(options.searchFallback &&
          options.env.webSearchGeminiFallback !== "off"
            ? { fallback: options.searchFallback }
            : {}),
        })
      : [];
  const searchRoute: SearchRoute = !searchMode
    ? "off"
    : hostedSearch
      ? "hosted"
      : "tools";
  // 第 70 条 执行步骤: another model (设置 › 模型 › 执行步骤模型) or the
  // chat model, at the saved level or 低.
  const exec = options.execution ?? {};
  const execModel = builtHere ? exec.model : undefined;
  const execRef: ChatModelRef | null = execModel
    ? execModel.source === "custom"
      ? {
          source: "custom",
          providerId: execModel.providerId,
          model: execModel.customChat.model,
        }
      : parseChatModelRef(execModel.ref)
    : ref;
  const execEffort = resolveChatEffort(
    execRef,
    exec.effort ?? defaultExecutionEffort(execRef),
  );
  const execSearchMode = chatOptions.webSearch
    ? chatWebSearchMode(execRef)
    : null;
  const execRoute: SearchRoute = !execSearchMode
    ? "off"
    : execSearchMode === "hosted"
      ? "hosted"
      : "tools";
  const buildExec = (sent: SentEffort, hosted: boolean) =>
    !execModel
      ? build(sent, hosted)
      : execModel.source === "custom"
        ? createCustomChatModel({
            ...execModel.customChat,
            effort: sent,
            ...(promptCacheKey ? { promptCacheKey } : {}),
          })
        : createStreamingChatModel(execModel.ref, execModel.credentials, {
            effort: sent,
            webSearch: hosted,
            ...(promptCacheKey ? { promptCacheKey } : {}),
          });
  // The context window's summaries are an execution step too.
  const summaryModel = builtHere
    ? (buildExec(execEffort, false) as unknown as BaseChatModel)
    : (resolvedModel as BaseChatModel);
  if (builtHere && ref)
    console.info(
      `[agent-model] ${ref.source === "custom" ? "custom:" : ""}${ref.model} effort=${chatOptions.effort ?? "auto"}→${effort}; after tools ${execModel ? `${execRef?.source === "custom" ? "custom:" : ""}${execRef?.model ?? "?"}` : "same model"} effort=${execEffort} webSearch=${searchMode ?? "off"} cacheKey=${promptCacheKey ? "thread" : "none"}`,
    );
  const optionsMiddleware: ReturnType<typeof createMiddleware>[] = builtHere
    ? [
        createChatOptionsMiddleware({
          planning: {
            ref,
            label: ref?.model ?? "model",
            effort,
            search: searchRoute,
            rebuild: (sent, hosted) =>
              build(sent, hosted) as unknown as BaseChatModel,
          },
          execution: {
            ref: execRef,
            label: execRef?.model ?? ref?.model ?? "model",
            effort: execEffort,
            search: execModel ? execRoute : searchRoute,
            separate: Boolean(execModel),
            rebuild: (sent, hosted) =>
              buildExec(sent, hosted) as unknown as BaseChatModel,
          },
          searchTools,
        }),
      ]
    : [];
  // Innermost of all: a model that refuses pictures is called again without
  // them before the options middleware could take it for an option refusal.
  if (options.reviewImages)
    optionsMiddleware.push(createVisionReviewMiddleware(options.reviewImages));

  const createUserClient =
    options.createUserClient ??
    ((_accessToken: string): never => {
      throw new Error(
        "inspect_canvas is unavailable: no createUserClient was provided to createLoomicDeepAgent.",
      );
    });

  let systemPrompt = options.brandKitId
    ? `${LOOMIC_SYSTEM_PROMPT}\n\n当前项目已绑定品牌套件。在进行设计相关工作时，请先使用 get_brand_kit 工具查询品牌信息，确保设计符合品牌规范。`
    : // No kit: say where to pick one instead of hunting through files
      // (FINDINGS A1 showed a failed step and "无法读取你标记的品牌套件").
      `${LOOMIC_SYSTEM_PROMPT}\n\n当前项目没有选品牌套件，也没有默认品牌套件。用户提到品牌套件或品牌规范时，告诉用户可以在画布顶部的「品牌套件」里选一个，或在「品牌套件」页打开「应用到新项目」；不要去文件里找品牌套件。`;

  // Enabled skills (system and user-created, loaded from the database in
  // runtime.ts), written out in full (skills-prompt.ts, 第 69 条).
  const skills = skillsSection(options.workspaceSkills ?? []);
  if (skills) systemPrompt += `\n\n${skills}`;

  // 第 69 条: a design assistant, not deepagents' coding agent: no todo
  // list (write_todos) and no general-purpose sub-agent (task), which made
  // simple requests take extra rounds; the file tools, the conversation
  // summary (also what handles a context overflow, utils/context-overflow.ts)
  // and the repair of dangling tool calls stay.
  return createAgent({
    model: resolvedModel as BaseChatModel,
    systemPrompt,
    ...(options.checkpointer ? { checkpointer: options.checkpointer } : {}),
    ...(options.store ? { store: options.store } : {}),
    name: "loomic",
    middleware: [
      createFilesystemMiddleware({
        backend: backendResult.factory,
        systemPrompt: FILES_PROMPT,
      }),
      // 第 70 条: a 100k-token window, summarised at 80 % (context-window.ts).
      createContextWindowMiddleware({
        model: summaryModel,
        backend: backendResult.factory,
        ...(options.store ? { store: options.store } : {}),
        label: ref?.model ?? "run",
      }),
      createPatchToolCallsMiddleware(),
      ...loomicAgentMiddleware(optionsMiddleware, [
        createProjectMemoryMiddleware(backendResult.factory),
      ]),
    ],
    tools: createMainAgentTools(backendResult.factory, {
      createUserClient,
      ...(options.brandKitId != null ? { brandKitId: options.brandKitId } : {}),
      ...(options.connectionManager
        ? { connectionManager: options.connectionManager }
        : {}),
      ...(options.persistImage ? { persistImage: options.persistImage } : {}),
      ...(backendResult.sandboxDir
        ? { sandboxDir: backendResult.sandboxDir }
        : {}),

      ...(options.submitImageJob
        ? { submitImageJob: options.submitImageJob }
        : {}),
      availableModels: options.imageModels ?? [],
      ...(options.reviewImages ? { reviewImages: options.reviewImages } : {}),
      ...(options.workflow ? { workflow: options.workflow } : {}),
    }),
  }).withConfig({ recursionLimit: RUN_RECURSION_LIMIT }) as unknown as LoomicAgent;
}

/** What the file tools are for (replaces deepagents' coding-agent prompt). */
export const FILES_PROMPT = `## 文件
- /workspace/ 下是这个项目的文字资料（文案、分镜、方案、清单），这个项目的其他对话也能读到；/memories/AGENTS.md 是项目记忆。
- 知道路径就直接 read_file，不要先列目录或搜索文件；新建用 write_file，修改用 apply_patch（一次改多处）或 edit_file。
- 文件只放文字；图片、提示词卡片和生成节点都在画布上，用画布工具处理。`;

// Only the transport closure sees the credential; it is never put in graph state.
// 第 67 条: no time limit on a whole answer (a long reasoning call is fine),
// but a connection that goes silent for 10 minutes is dropped instead of
// holding the run forever (one old-prod run hung for almost two hours until
// the stale-run sweeper marked it). Reasoning streams send events while the
// model thinks, so 10 silent minutes means the connection is gone.
export const CHAT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const chatDispatcher = new HttpAgent({
  connect: { timeout: 60000 },
  headersTimeout: CHAT_IDLE_TIMEOUT_MS,
  bodyTimeout: CHAT_IDLE_TIMEOUT_MS,
});
export function createStreamingChatModel(
  specifier: string,
  credentials?: { apiKey: string; baseUrl: string },
  chat: {
    effort?: SentEffort;
    webSearch?: boolean;
    promptCacheKey?: string;
  } = {},
): BaseLanguageModel {
  if (!credentials) throw new Error("请先选择可用的对话 Key");
  const modelName = specifier.replace(/^openai:/, "");
  const baseUrl = new URL(`${credentials.baseUrl}/v1/`);
  const transport: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    if (
      url.origin !== baseUrl.origin ||
      !url.pathname.startsWith(baseUrl.pathname)
    )
      throw new Error("Invalid chat gateway URL");
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${credentials.apiKey}`);
    headers.set("User-Agent", XY2API_USER_AGENT);
    try {
      const response = (await httpFetch(url, {
        ...init,
        headers,
        dispatcher: chatDispatcher,
        redirect: "error",
      } as Parameters<typeof httpFetch>[1])) as unknown as Response;
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => undefined);
        // diagnostics: the main site's own words, scrubbed, for the log and
        // for model-options.ts (a model that refuses an effort level).
        const refusal = new GatewayError({
          ...mapGatewayError({ status: response.status, body }),
          diagnostics: gatewayDiagnostics({
            status: response.status,
            body,
            headers: response.headers,
          }),
        });
        // Too long for the model: deepagents compacts and calls again.
        if (
          [400, 413, 422].includes(response.status) &&
          isContextOverflowText(
            `${refusal.failure.diagnostics?.errorId ?? ""} ${refusal.failure.diagnostics?.message ?? ""}`,
          )
        ) {
          console.warn(
            `[agent-model] ${modelName} answered ${response.status}: the conversation is longer than its context; summarizing`,
          );
          markContextOverflow(refusal);
        }
        throw refusal;
      }
      // The main site relays other vendors too; see tool-call-stream.ts.
      return separateToolCallIndexes(response);
    } catch (error) {
      if (error instanceof GatewayError) throw error;
      // No response at all (refused, reset, timed out before the headers):
      // nothing was streamed yet, so model-retry.ts may send it again.
      if (init?.signal?.aborted) throw error;
      throw new ChatConnectError(describeErrorForLog(error));
    }
  };
  // gpt-6* always use the Responses API. The hosted web_search tool exists
  // only there, so a model with hosted 联网搜索 goes through it too
  // (LangChain would switch on its own when it sees the tool; deciding here
  // keeps the effort fields in the matching shape). The search_web function
  // tools (第 68 条) work on either API.
  const responsesApi = usesResponsesApi(modelName) || Boolean(chat.webSearch);
  const kwargs = chatEffortKwargs(
    modelName,
    chat.effort ?? "auto",
    responsesApi,
  );
  return new ChatOpenAI({
    model: modelName,
    apiKey: "loomic-transport-credential",
    configuration: { baseURL: `${credentials.baseUrl}/v1`, fetch: transport },
    streaming: true,
    // Usage (incl. cached input tokens) for the per-turn log line
    // (stream-adapter.ts describeModelTurn); Responses always sends it.
    streamUsage: true,
    maxRetries: 0,
    ...(responsesApi ? { useResponsesApi: true } : {}),
    ...(Object.keys(kwargs).length ? { modelKwargs: kwargs } : {}),
    // OpenAI-style prompt caching: requests with the same key and prefix
    // land where the prefix is cached (xy2api forwards prompt_cache_key).
    ...(chat.promptCacheKey ? { promptCacheKey: chat.promptCacheKey } : {}),
  });
}
export function createDefaultModelSpecifier(
  env: Pick<ServerEnv, "agentModel">,
) {
  return env.agentModel.includes(":")
    ? env.agentModel
    : `openai:${env.agentModel}`;
}

/**
 * 第 70 条: the model that writes conversation summaries outside a run (the
 * 压缩 button, runtime.compactSession): the execution model at its level,
 * without hosted search, exactly as createLoomicDeepAgent builds it for the
 * context window inside a run.
 */
export function createSummaryModel(options: {
  /** The chat model id (openai:<model>); ignored with customChat. */
  modelSpec: string;
  credentials?: { apiKey: string; baseUrl: string };
  customChat?: Parameters<typeof createCustomChatModel>[0];
  execution?: ExecutionOptions;
}): BaseChatModel {
  const exec = options.execution ?? {};
  if (exec.model?.source === "custom") {
    const ref: ChatModelRef = {
      source: "custom",
      providerId: exec.model.providerId,
      model: exec.model.customChat.model,
    };
    return createCustomChatModel({
      ...exec.model.customChat,
      effort: resolveChatEffort(
        ref,
        exec.effort ?? defaultExecutionEffort(ref),
      ),
    }) as unknown as BaseChatModel;
  }
  if (exec.model?.source === "xy2api") {
    const ref = parseChatModelRef(exec.model.ref);
    return createStreamingChatModel(exec.model.ref, exec.model.credentials, {
      effort: resolveChatEffort(
        ref,
        exec.effort ?? defaultExecutionEffort(ref),
      ),
      webSearch: false,
    }) as unknown as BaseChatModel;
  }
  const ref: ChatModelRef | null = options.customChat
    ? { source: "custom", providerId: "custom", model: options.customChat.model }
    : parseChatModelRef(
        options.modelSpec.includes(":")
          ? options.modelSpec
          : `openai:${options.modelSpec}`,
      );
  const effort = resolveChatEffort(
    ref,
    exec.effort ?? defaultExecutionEffort(ref),
  );
  return (
    options.customChat
      ? createCustomChatModel({ ...options.customChat, effort })
      : createStreamingChatModel(options.modelSpec, options.credentials, {
          effort,
          webSearch: false,
        })
  ) as unknown as BaseChatModel;
}

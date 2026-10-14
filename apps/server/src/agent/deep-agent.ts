import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import type {
  BaseCheckpointSaver,
  BaseStore,
} from "@langchain/langgraph-checkpoint";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";
import {
  type ChatEffort,
  type ChatModelRef,
  chatWebSearchSupported,
  parseChatModelRef,
  resolveChatEffort,
  usesResponsesApi,
} from "@loomic/shared";
import { createDeepAgent } from "deepagents";
import { createCustomChatModel } from "../features/chat-providers/chat-model.js";
import {
  GatewayError,
  gatewayDiagnostics,
  mapGatewayError,
} from "../features/xy2api/errors.js";
import type { UserSupabaseClient } from "../supabase/user.js";

import { Agent as HttpAgent, fetch as httpFetch } from "undici";
import type { ServerEnv } from "../config/env.js";
import type { AvailableModel } from "../generation/providers/registry.js";
import type { ConnectionManager } from "../ws/connection-manager.js";
import {
  type AgentBackendResult,
  createAgentBackend,
} from "./backends/index.js";
import { createGluedToolCallMiddleware } from "./glued-tool-calls.js";
import { ChatConnectError, createModelRetryMiddleware } from "./model-retry.js";
import {
  type SentEffort,
  chatEffortKwargs,
  createChatOptionsMiddleware,
} from "./model-options.js";
import { LOOMIC_SYSTEM_PROMPT } from "./prompts/loomic-main.js";
import type {
  PersistImageFn,
  SubmitImageJobFn,
} from "./tools/image-generate.js";
import { createMainAgentTools } from "./tools/index.js";
import { separateToolCallIndexes } from "./tool-call-stream.js";
import { createToolErrorMiddleware } from "./tool-errors.js";
import type { WorkspaceSkillEntry } from "./workspace-skills.js";
import { XY2API_USER_AGENT } from "../utils/user-agent.js";
import { describeErrorForLog } from "../utils/error-sanitizer.js";

export type LoomicAgent = Pick<
  ReturnType<typeof createDeepAgent>,
  "stream" | "streamEvents"
>;

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
  store?: BaseStore;
  workspaceSkills?: WorkspaceSkillEntry[];
}) => LoomicAgent;

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
  extra: ReturnType<typeof createChatOptionsMiddleware>[] = [],
) {
  return [
    createGluedToolCallMiddleware(),
    createToolErrorMiddleware(),
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
  store?: BaseStore;
  workspaceSkills?: WorkspaceSkillEntry[];
}): LoomicAgent {
  const backendResult =
    options.backendResult ?? createAgentBackend(options.env, options.canvasId);

  const modelSpec = options.model ?? createDefaultModelSpecifier(options.env);
  // 第 67 条: the chat options this model takes (chat-options.ts decides,
  // the chat panel shows the same), and a builder for the effort fallback.
  const ref: ChatModelRef | null = options.customChat
    ? { source: "custom", providerId: "custom", model: options.customChat.model }
    : typeof modelSpec === "string"
      ? parseChatModelRef(
          modelSpec.includes(":") ? modelSpec : `openai:${modelSpec}`,
        )
      : null;
  const chatOptions = options.chatOptions ?? {};
  const effort = resolveChatEffort(ref, chatOptions.effort);
  const webSearch = Boolean(chatOptions.webSearch) && chatWebSearchSupported(ref);
  const promptCacheKey = chatOptions.promptCacheKey;
  const build = (sent: SentEffort, search = webSearch) =>
    options.customChat
      ? createCustomChatModel({
          ...options.customChat,
          effort: sent,
          ...(promptCacheKey ? { promptCacheKey } : {}),
        })
      : createStreamingChatModel(modelSpec as string, options.credentials, {
          effort: sent,
          webSearch: search,
          ...(promptCacheKey ? { promptCacheKey } : {}),
        });
  const builtHere = Boolean(options.customChat) || typeof modelSpec === "string";
  const resolvedModel = builtHere ? build(effort) : (modelSpec as BaseLanguageModel);
  if (builtHere && ref)
    console.info(
      `[agent-model] ${ref.source === "custom" ? "custom:" : ""}${ref.model} effort=${chatOptions.effort ?? "auto"}→${effort} webSearch=${webSearch ? "on" : chatOptions.webSearch ? "unsupported" : "off"} cacheKey=${promptCacheKey ? "thread" : "none"}`,
    );
  const optionsMiddleware = builtHere
    ? [
        createChatOptionsMiddleware({
          ref,
          label: ref?.model ?? "model",
          effort,
          webSearch,
          rebuild: (sent, search) =>
            build(sent, search) as unknown as BaseChatModel,
        }),
      ]
    : [];

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

  // Inject enabled skills (both system and user-created) into the system prompt.
  // All skills are loaded from the database via loadWorkspaceSkills() in runtime.ts.
  const wsSkills = options.workspaceSkills ?? [];
  if (wsSkills.length > 0) {
    const skillsList = wsSkills
      .map((s) => {
        let line = `- **${s.name}**: ${s.description}\n  → Read \`${s.path}\` for full instructions`;
        if (s.files.length > 0) {
          const counts: Record<string, number> = {};
          for (const f of s.files) {
            const dir = f.path.split("/")[0] ?? "other";
            counts[dir] = (counts[dir] ?? 0) + 1;
          }
          const summary = Object.entries(counts)
            .map(([dir, n]) => `${dir}/ (${n})`)
            .join(", ");
          line += `\n  → Has: ${summary}`;
        }
        return line;
      })
      .join("\n");
    systemPrompt += `\n\n## Skills\n\nThe following skills are enabled in this workspace:\n${skillsList}`;
  }

  return createDeepAgent({
    backend: backendResult.factory,
    ...(options.checkpointer ? { checkpointer: options.checkpointer } : {}),
    middleware: loomicAgentMiddleware(optionsMiddleware),
    model: resolvedModel,
    name: "loomic",
    ...(options.store ? { store: options.store } : {}),
    subagents: [],
    systemPrompt,
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
    }),
  });
}

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
  chat: { effort?: SentEffort; webSearch?: boolean; promptCacheKey?: string } = {},
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
        throw new GatewayError({
          ...mapGatewayError({ status: response.status, body }),
          diagnostics: gatewayDiagnostics({
            status: response.status,
            body,
            headers: response.headers,
          }),
        });
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
  // only there, so a model with 联网搜索 on goes through it too (LangChain
  // would switch on its own when it sees the tool; deciding here keeps the
  // effort fields in the matching shape).
  const responsesApi = usesResponsesApi(modelName) || Boolean(chat.webSearch);
  const kwargs = chatEffortKwargs(modelName, chat.effort ?? "auto", responsesApi);
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

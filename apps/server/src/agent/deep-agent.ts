import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import type {
  BaseCheckpointSaver,
  BaseStore,
} from "@langchain/langgraph-checkpoint";
import { ChatOpenAI } from "@langchain/openai";
import { createDeepAgent } from "deepagents";
import { createCustomChatModel } from "../features/chat-providers/chat-model.js";
import { GatewayError, mapGatewayError } from "../features/xy2api/errors.js";
import type { UserSupabaseClient } from "../supabase/user.js";

import { Agent as HttpAgent, fetch as httpFetch } from "undici";
import type { ServerEnv } from "../config/env.js";
import type { AvailableModel } from "../generation/providers/registry.js";
import type { ConnectionManager } from "../ws/connection-manager.js";
import {
  type AgentBackendResult,
  createAgentBackend,
} from "./backends/index.js";
import { LOOMIC_SYSTEM_PROMPT } from "./prompts/loomic-main.js";
import type {
  PersistImageFn,
  SubmitImageJobFn,
} from "./tools/image-generate.js";
import { createMainAgentTools } from "./tools/index.js";
import type { WorkspaceSkillEntry } from "./workspace-skills.js";

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
  store?: BaseStore;
  workspaceSkills?: WorkspaceSkillEntry[];
}) => LoomicAgent;

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
  store?: BaseStore;
  workspaceSkills?: WorkspaceSkillEntry[];
}): LoomicAgent {
  const backendResult =
    options.backendResult ?? createAgentBackend(options.env, options.canvasId);

  const modelSpec = options.model ?? createDefaultModelSpecifier(options.env);
  const resolvedModel = options.customChat
    ? createCustomChatModel(options.customChat)
    : typeof modelSpec === "string"
      ? createStreamingChatModel(modelSpec, options.credentials)
      : modelSpec;

  const createUserClient =
    options.createUserClient ??
    ((_accessToken: string): never => {
      throw new Error(
        "inspect_canvas is unavailable: no createUserClient was provided to createLoomicDeepAgent.",
      );
    });

  let systemPrompt = options.brandKitId
    ? `${LOOMIC_SYSTEM_PROMPT}\n\n当前项目已绑定品牌套件。在进行设计相关工作时，请先使用 get_brand_kit 工具查询品牌信息，确保设计符合品牌规范。`
    : LOOMIC_SYSTEM_PROMPT;

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
const chatDispatcher = new HttpAgent({
  connect: { timeout: 60000 },
  headersTimeout: 0,
  bodyTimeout: 0,
});
export function createStreamingChatModel(
  specifier: string,
  credentials?: { apiKey: string; baseUrl: string },
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
    headers.set("User-Agent", "LoomicServer/1.0");
    try {
      const response = (await httpFetch(url, {
        ...init,
        headers,
        dispatcher: chatDispatcher,
        redirect: "error",
      } as Parameters<typeof httpFetch>[1])) as unknown as Response;
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => undefined);
        throw new GatewayError(
          mapGatewayError({ status: response.status, body }),
        );
      }
      return response;
    } catch (error) {
      if (error instanceof GatewayError) throw error;
      throw new Error("对话连接中断，请稍后再试");
    }
  };
  return new ChatOpenAI({
    model: modelName,
    apiKey: "loomic-transport-credential",
    configuration: { baseURL: `${credentials.baseUrl}/v1`, fetch: transport },
    streaming: true,
    streamUsage: false,
    maxRetries: 0,
    ...(modelName.startsWith("gpt-6-") || modelName.startsWith("gpt-6.")
      ? { useResponsesApi: true }
      : {}),
  });
}
export function createDefaultModelSpecifier(
  env: Pick<ServerEnv, "agentModel">,
) {
  return env.agentModel.includes(":")
    ? env.agentModel
    : `openai:${env.agentModel}`;
}

import { ChatOpenAICompletions } from "@langchain/openai";

import { separateToolCallIndexes } from "../../agent/tool-call-stream.js";

// ChatOpenAI may auto-select Responses by model name even with useResponsesApi:false.
// The explicitly exported completions class guarantees the personal-provider contract.
export function createCustomChatModel(options: {
  model: string;
  baseUrl: string;
  transport: typeof fetch;
  /**
   * 第 67 条 思考强度: sent as reasoning_effort (low/medium/high on the chat
   * panel for personal providers). "auto"/"off" send nothing. A provider
   * that refuses it is called again without (agent/model-options.ts).
   * No prompt_cache_key here: some providers refuse unknown fields.
   */
  effort?: string;
  promptCacheKey?: string;
}) {
  const effort =
    options.effort && options.effort !== "auto" && options.effort !== "off"
      ? options.effort
      : undefined;
  return new ChatOpenAICompletions({
    ...(effort ? { modelKwargs: { reasoning_effort: effort } } : {}),
    model: options.model,
    apiKey: "loomic-transport-credential",
    configuration: {
      baseURL: options.baseUrl,
      // Third-party gateways may number parallel tool calls wrongly.
      fetch: async (input, init) =>
        separateToolCallIndexes(await options.transport(input, init)),
    },
    streaming: true,
    streamUsage: false,
    maxRetries: 0,
  });
}

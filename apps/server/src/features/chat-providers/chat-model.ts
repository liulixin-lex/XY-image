import { ChatOpenAICompletions } from "@langchain/openai";

import { separateToolCallIndexes } from "../../agent/tool-call-stream.js";

// ChatOpenAI may auto-select Responses by model name even with useResponsesApi:false.
// The explicitly exported completions class guarantees the personal-provider contract.
export function createCustomChatModel(options: {
  model: string;
  baseUrl: string;
  transport: typeof fetch;
}) {
  return new ChatOpenAICompletions({
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

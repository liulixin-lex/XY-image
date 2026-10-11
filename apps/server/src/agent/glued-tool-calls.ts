import {
  AIMessage,
  type InvalidToolCall,
  type ToolCall,
} from "@langchain/core/messages";
import { createMiddleware } from "langchain";

/**
 * Some OpenAI-compatible gateways send parallel tool calls as ONE call: one
 * id, and the arguments of every call glued together, `{…}{…}`. Seen on the
 * pre-launch site 2026-10-11 with o10.top relaying gemini-3.1-pro: with two
 * skills installed the model read both SKILL.md files at once, LangChain
 * could not parse `{"file_path":"…poster…"}{"file_path":"…json…"}`, nothing
 * ran, the reply was empty and the run ended with a blank chat.
 *
 * This middleware splits such a call back into one call per JSON object
 * (ids `<id>`, `<id>_2`, …). Only arguments that are entirely complete JSON
 * objects side by side are split; any other unparseable call is left for
 * the run to report.
 *
 * TODO: createDeepAgent does not pass custom middleware to the built-in
 * general-purpose `task` sub-agent, so glued calls made inside it are not
 * split (same gap as tool-errors.ts).
 */
export function createGluedToolCallMiddleware() {
  return createMiddleware({
    name: "GluedToolCallMiddleware",
    wrapModelCall: async (request, handler) => {
      const response = await handler(request);
      return AIMessage.isInstance(response)
        ? splitGluedToolCalls(response)
        : response;
    },
  });
}

/** Returns the message with glued calls split, or the same message. */
export function splitGluedToolCalls(message: AIMessage): AIMessage {
  const invalid = message.invalid_tool_calls ?? [];
  if (!invalid.length) return message;
  const fixed: ToolCall[] = [];
  const left: InvalidToolCall[] = [];
  for (const call of invalid) {
    const parts =
      call.name && typeof call.args === "string"
        ? splitJsonObjects(call.args)
        : null;
    if (!parts) {
      left.push(call);
      continue;
    }
    const id = call.id ?? `call_${Date.now().toString(36)}`;
    parts.forEach((args, i) =>
      fixed.push({
        name: call.name as string,
        args,
        id: i === 0 ? id : `${id}_${i + 1}`,
        type: "tool_call",
      }),
    );
  }
  if (!fixed.length) return message;
  console.warn(
    `[tool-calls] split ${fixed.length} glued tool calls (${[...new Set(fixed.map((c) => c.name))].join(", ")})`,
  );
  return new AIMessage({
    content: message.content,
    additional_kwargs: message.additional_kwargs,
    response_metadata: message.response_metadata,
    tool_calls: [...(message.tool_calls ?? []), ...fixed],
    invalid_tool_calls: left,
    ...(message.id ? { id: message.id } : {}),
    ...(message.name ? { name: message.name } : {}),
    // Typed `never` for the default message structure, but present at runtime.
    ...(message.usage_metadata
      ? ({ usage_metadata: message.usage_metadata } as object)
      : {}),
  });
}

/**
 * `{"a":1}{"b":2}` → [{a:1},{b:2}]. Null unless the text is two or more
 * complete JSON objects with only whitespace between them.
 */
export function splitJsonObjects(
  text: string,
): Record<string, unknown>[] | null {
  const parts: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      if (depth === 0) return null;
      inString = true;
    } else if (ch === "{" || ch === "[") {
      if (depth === 0) {
        if (ch === "[") return null;
        start = i;
      }
      depth++;
    } else if (ch === "}" || ch === "]") {
      depth--;
      if (depth < 0) return null;
      if (depth === 0) parts.push(text.slice(start, i + 1));
    } else if (depth === 0 && !/\s/.test(ch ?? "")) return null;
  }
  if (depth !== 0 || inString || parts.length < 2) return null;
  try {
    const objects = parts.map((p) => JSON.parse(p) as unknown);
    return objects.every(
      (o) => o !== null && typeof o === "object" && !Array.isArray(o),
    )
      ? (objects as Record<string, unknown>[])
      : null;
  } catch {
    return null;
  }
}

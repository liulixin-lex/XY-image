/**
 * Some OpenAI-compatible gateways stream parallel tool calls all under
 * `index: 0`. Seen on the pre-launch site 2026-10-11 with o10.top relaying
 * gemini-3.1-pro: with two skills installed, the model read both SKILL.md
 * files at once. LangChain merges stream chunks by index, so the two
 * argument strings were glued into `{…}{…}`, no tool call parsed, the reply
 * was empty and the run ended "completed" with nothing on screen.
 *
 * This rewrites a chat-completions SSE stream so every tool call id gets its
 * own index. Streams that already number their calls pass through byte for
 * byte; anything that is not JSON with `choices[].delta.tool_calls` is left
 * alone (the Responses API stream has no `choices`).
 */

type ToolCallDelta = { index?: unknown; id?: unknown };
type ChoiceState = {
  byId: Map<string, number>;
  /** The index last given to each raw index, for chunks without an id. */
  lastByRaw: Map<number, number>;
  next: number;
};

/** Returns a function that renumbers one parsed SSE payload in place. */
export function createToolCallIndexer() {
  const choices = new Map<number, ChoiceState>();
  return (payload: unknown): boolean => {
    const list = (payload as { choices?: unknown } | null)?.choices;
    if (!Array.isArray(list)) return false;
    let changed = false;
    for (const choice of list) {
      const calls = (choice as { delta?: { tool_calls?: unknown } } | null)
        ?.delta?.tool_calls;
      if (!Array.isArray(calls)) continue;
      const key =
        typeof (choice as { index?: unknown }).index === "number"
          ? (choice as { index: number }).index
          : 0;
      let state = choices.get(key);
      if (!state) {
        state = { byId: new Map(), lastByRaw: new Map(), next: 0 };
        choices.set(key, state);
      }
      for (const call of calls as ToolCallDelta[]) {
        if (!call || typeof call !== "object") continue;
        const raw = typeof call.index === "number" ? call.index : 0;
        let index: number;
        if (typeof call.id === "string" && call.id) {
          const known = state.byId.get(call.id);
          index = known ?? state.next++;
          if (known === undefined) state.byId.set(call.id, index);
          state.lastByRaw.set(raw, index);
        } else {
          // A continuation: it belongs to the call that last used this index.
          index = state.lastByRaw.get(raw) ?? raw;
          if (!state.lastByRaw.has(raw)) {
            state.lastByRaw.set(raw, index);
            state.next = Math.max(state.next, index + 1);
          }
        }
        if (call.index !== index) {
          call.index = index;
          changed = true;
        }
      }
    }
    return changed;
  };
}

/** Wraps a fetch Response; only `text/event-stream` bodies are rewritten. */
export function separateToolCallIndexes(response: Response): Response {
  const type = response.headers.get("content-type") ?? "";
  if (!response.body || !type.includes("text/event-stream")) return response;
  const renumber = createToolCallIndexer();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let warned = false;
  const rewrite = (line: string) => {
    if (!line.startsWith("data:")) return line;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return line;
    let payload: unknown;
    try {
      payload = JSON.parse(data);
    } catch {
      return line;
    }
    if (!renumber(payload)) return line;
    if (!warned) {
      warned = true;
      console.warn(
        "[tool-calls] the chat provider streamed parallel tool calls under one index; renumbered them",
      );
    }
    return `data: ${JSON.stringify(payload)}`;
  };
  const body = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        if (lines.length)
          controller.enqueue(
            encoder.encode(`${lines.map(rewrite).join("\n")}\n`),
          );
      },
      flush(controller) {
        buffer += decoder.decode();
        if (buffer) controller.enqueue(encoder.encode(rewrite(buffer)));
      },
    }),
  );
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

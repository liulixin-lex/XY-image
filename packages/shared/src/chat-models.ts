export type ChatModelRef =
  | { source: "xy2api"; model: string }
  | { source: "custom"; providerId: string; model: string };

// Split only the prefix/provider ID. Model names may contain ":" and "/".
export function parseChatModelRef(id: string): ChatModelRef | null {
  if (id.startsWith("openai:")) {
    const model = id.slice(7);
    return model ? { source: "xy2api", model } : null;
  }
  if (id.startsWith("custom:")) {
    const rest = id.slice(7);
    const separator = rest.indexOf(":");
    if (separator <= 0 || separator === rest.length - 1) return null;
    return {
      source: "custom",
      providerId: rest.slice(0, separator),
      model: rest.slice(separator + 1),
    };
  }
  return null;
}

export function formatChatModelRef(ref: ChatModelRef): string {
  return ref.source === "xy2api"
    ? `openai:${ref.model}`
    : `custom:${ref.providerId}:${ref.model}`;
}

import { describe, expect, it } from "vitest";
import { formatChatModelRef, parseChatModelRef } from "./chat-models.js";

describe("chat model references", () => {
  it("preserves provider model colons and slashes", () => {
    const ref = {
      source: "custom" as const,
      providerId: "provider-id",
      model: "org/model:free:beta",
    };
    expect(parseChatModelRef(formatChatModelRef(ref))).toEqual(ref);
    expect(parseChatModelRef("openai:ft:org/model")).toEqual({
      source: "xy2api",
      model: "ft:org/model",
    });
  });
  it.each([
    "",
    "gpt-4.1",
    "openai:",
    "custom::model",
    "custom:provider",
    "custom:provider:",
  ])("rejects invalid ref %s", (id) => {
    expect(parseChatModelRef(id)).toBeNull();
  });
});

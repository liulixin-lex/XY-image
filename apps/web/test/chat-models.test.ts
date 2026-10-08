import { describe, expect, it } from "vitest";

import {
  chatBillingNote,
  chatPreferencePatch,
  formatChatModelRef,
  groupChatModels,
  normalizeChatModelList,
  parseChatModelRef,
  preferredChatModelId,
} from "../src/lib/chat-models";
import type { AccountPreferences } from "../src/lib/xy2api-api";

const prefs = (patch: Partial<AccountPreferences>): AccountPreferences => ({
  user_id: "u",
  image_key_id: null,
  chat_key_id: null,
  default_image_model: null,
  default_chat_model: null,
  ...patch,
});

describe("chat model refs", () => {
  it("splits custom refs on the first two colons only", () => {
    expect(parseChatModelRef("custom:p-1:my-finetune:v2")).toEqual({
      source: "custom",
      providerId: "p-1",
      model: "my-finetune:v2",
    });
    expect(parseChatModelRef("custom:p-1:anthropic/claude-sonnet-4.5")).toMatchObject({
      model: "anthropic/claude-sonnet-4.5",
    });
    expect(parseChatModelRef("openai:gpt-5.4")).toEqual({ source: "xy2api", model: "gpt-5.4" });
  });

  it("rejects malformed and bare ids", () => {
    for (const id of ["gpt-5.4", "openai:", "custom:", "custom:p-1", "custom::model", "custom:p-1:"]) {
      expect(parseChatModelRef(id)).toBeNull();
    }
  });

  it("round-trips through format", () => {
    for (const id of ["openai:gpt-5.4", "custom:p-1:a:b/c"]) {
      const ref = parseChatModelRef(id);
      expect(ref && formatChatModelRef(ref)).toBe(id);
    }
  });

  it("builds the saved default from bare model + provider id", () => {
    expect(preferredChatModelId(prefs({ default_chat_model: "gpt-5.4" }))).toBe("openai:gpt-5.4");
    expect(
      preferredChatModelId(prefs({ default_chat_model: "glm-4.6", default_chat_provider_id: "p-2" })),
    ).toBe("custom:p-2:glm-4.6");
    expect(preferredChatModelId(prefs({ default_chat_provider_id: "p-2" }))).toBeNull();
    expect(preferredChatModelId(null)).toBeNull();
  });
});

describe("chatPreferencePatch", () => {
  it("leaves the provider field out for servers that do not know it", () => {
    expect(chatPreferencePatch("openai:gpt-5.4", prefs({}))).toEqual({ defaultChatModel: "gpt-5.4" });
  });

  it("clears the provider when switching back to the main site on newer servers", () => {
    expect(chatPreferencePatch("openai:gpt-5.4", prefs({ default_chat_provider_id: "p-1" }))).toEqual({
      defaultChatModel: "gpt-5.4",
      defaultChatProviderId: null,
    });
  });

  it("saves a custom model as bare name + provider id", () => {
    expect(chatPreferencePatch("custom:p-1:vendor/model:v2", prefs({ default_chat_provider_id: null }))).toEqual({
      defaultChatModel: "vendor/model:v2",
      defaultChatProviderId: "p-1",
    });
    expect(chatPreferencePatch("gpt-5.4", prefs({}))).toBeNull();
  });
});

describe("normalizeChatModelList", () => {
  it("reads the current main-site-only shape as available main-site models", () => {
    const list = normalizeChatModelList({
      models: [{ id: "openai:gpt-5.4", name: "GPT-5.4", provider: "openai" }],
    });
    expect(list.xy2api).toEqual({ available: true, error: null });
    expect(list.models[0]).toMatchObject({ source: "xy2api", billing: "xy2api", providerId: null });
  });

  it("keeps provider models and the main-site error from the merged shape", () => {
    const list = normalizeChatModelList({
      models: [
        {
          id: "custom:p-1:deepseek-chat",
          name: "deepseek-chat",
          provider: "openai_compatible",
          source: "custom",
          providerId: "p-1",
          providerName: "我的服务商 A",
          billing: "external",
        },
      ],
      xy2api: { available: false, error: "key_unavailable" },
    });
    expect(list.xy2api).toEqual({ available: false, error: "key_unavailable" });
    expect(list.models[0]).toMatchObject({
      source: "custom",
      billing: "external",
      providerId: "p-1",
      providerName: "我的服务商 A",
    });
  });

  it("never treats a custom id as main-site billing when fields are missing", () => {
    const [model] = normalizeChatModelList({
      models: [{ id: "custom:p-9:x", name: "x", provider: "openai_compatible" }],
    }).models;
    expect(model).toMatchObject({ source: "custom", billing: "external", providerId: "p-9" });
    expect(model && chatBillingNote(model)).toContain("不从主站余额扣");
  });
});

describe("groupChatModels", () => {
  it("puts the main site first, then one group per provider in API order", () => {
    const { models } = normalizeChatModelList({
      models: [
        { id: "custom:p-2:b", name: "b", provider: "x", source: "custom", providerId: "p-2", providerName: "B" },
        { id: "openai:gpt-5.4", name: "GPT-5.4", provider: "openai" },
        { id: "custom:p-1:a", name: "a", provider: "x", source: "custom", providerId: "p-1", providerName: "A" },
        { id: "custom:p-2:c", name: "c", provider: "x", source: "custom", providerId: "p-2", providerName: "B" },
      ],
    });
    const groups = groupChatModels(models);
    expect(groups.map((g) => [g.label, g.models.map((m) => m.name)])).toEqual([
      ["主站", ["GPT-5.4"]],
      ["B", ["b", "c"]],
      ["A", ["a"]],
    ]);
  });
});

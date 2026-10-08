import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadServerEnv } from "../../config/env.js";
import { createSecretBox } from "../xy2api/secret-box.js";
import { createXy2apiServices } from "../xy2api/services.js";
import { memoryDatabase } from "../xy2api/test-support.js";
import { ChatProviderError, mapProviderStatus } from "./errors.js";
import { resolveRunChatModel } from "./model-resolver.js";
import { createProviderNetwork } from "./network.js";
import { ChatProviderService } from "./service.js";
import { createChatProviderStore } from "./store.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(cleanups.splice(0).map((f) => f()));
});
const userId = "11111111-1111-4111-8111-111111111111";
const userB = "22222222-2222-4222-8222-222222222222";
const input = {
  name: "Example",
  protocol: "openai_compatible" as const,
  baseUrl: "https://api.example.com/v1",
  apiKey: "synthetic-private-provider-key",
};

function fixture() {
  const box = createSecretBox(randomBytes(32).toString("base64"));
  const db = memoryDatabase({});
  const network = createProviderNetwork({});
  cleanups.push(() => network.close());
  const listModels = vi
    .spyOn(network, "listModels")
    .mockResolvedValue(["org/model:free", "gpt-6-sol"]);
  const service = new ChatProviderService(
    createChatProviderStore(() => db.admin),
    box,
    network,
  );
  return { ...db, service, box, listModels };
}

describe("personal chat providers", () => {
  it("encrypts with owner/provider AAD, keeps old main-site ciphertext compatible, and never returns/logs secrets", async () => {
    const f = fixture();
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const provider = await f.service.create(userId, input);
    const rows = f.tables.user_chat_providers ?? [];
    const encrypted = String(rows[0]?.secret_enc);
    expect(
      f.box.openSecret(
        encrypted,
        `loomic:chat-provider:v1:${userId}:${provider.id}`,
      ),
    ).toBe(input.apiKey);
    expect(() =>
      f.box.openSecret(
        encrypted,
        `loomic:chat-provider:v1:${userB}:${provider.id}`,
      ),
    ).toThrow();
    expect(() =>
      f.box.openSecret(encrypted, `loomic:chat-provider:v1:${userId}:other`),
    ).toThrow();
    expect(f.box.openSecret(f.box.sealSecret("old-key"))).toBe("old-key");
    expect(provider.keyHint).toBe("-key");
    for (const value of [
      provider,
      await f.service.list(userId),
      log.mock.calls,
      rows,
    ]) {
      expect(JSON.stringify(value)).not.toContain(input.apiKey);
    }
    expect(JSON.stringify(provider)).not.toContain("secret_enc");
    expect(await f.service.list(userB)).toEqual([]);
    await expect(
      f.service.patch(userB, provider.id, { name: "hijack" }),
    ).rejects.toMatchObject({ code: "provider_not_found" });
    await expect(f.service.delete(userB, provider.id)).rejects.toMatchObject({
      code: "provider_not_found",
    });
  });
  it("applies PATCH atomically and only probes when credentials/address are supplied", async () => {
    const f = fixture();
    const p = await f.service.create(userId, input);
    f.listModels.mockClear();
    await f.service.patch(userId, p.id, { name: "Renamed", enabled: false });
    await f.service.patch(userId, p.id, { models: ["manual/model"] });
    expect(f.listModels).not.toHaveBeenCalled();
    await expect(
      f.service.patch(userId, p.id, { baseUrl: "https://new.example.com/v1" }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(f.listModels).not.toHaveBeenCalled();
    f.listModels.mockRejectedValueOnce(mapProviderStatus(404, "", true));
    await expect(
      f.service.patch(userId, p.id, {
        name: "Uncommitted",
        apiKey: "replacement-key",
      }),
    ).rejects.toMatchObject({ code: "provider_models_unavailable" });
    expect((await f.service.list(userId))[0]).toMatchObject({
      name: "Renamed",
      models: ["manual/model"],
      keyHint: "-key",
    });
    f.listModels.mockRejectedValueOnce(mapProviderStatus(404, "", true));
    expect(
      await f.service.patch(userId, p.id, {
        apiKey: "replacement-key",
        models: ["chosen"],
      }),
    ).toMatchObject({ modelsSource: "manual", models: ["chosen"] });
    f.listModels.mockRejectedValueOnce(mapProviderStatus(401));
    await expect(
      f.service.patch(userId, p.id, {
        apiKey: "bad-key-value",
        models: ["chosen"],
      }),
    ).rejects.toMatchObject({ code: "provider_auth_failed" });
    f.listModels.mockRejectedValueOnce(
      new ChatProviderError("provider_models_unavailable"),
    );
    await expect(
      f.service.patch(userId, p.id, {
        apiKey: "bad-response",
        models: ["chosen"],
      }),
    ).rejects.toMatchObject({ code: "provider_models_unavailable" }); // malformed JSON is not a missing endpoint
  });
  it("manual creation only bypasses a 404; refresh preserves models on failure and clears the error on success", async () => {
    const f = fixture();
    f.listModels.mockRejectedValueOnce(mapProviderStatus(404, "", true));
    const p = await f.service.create(userId, { ...input, models: ["manual"] });
    f.listModels.mockRejectedValueOnce(mapProviderStatus(403));
    await expect(f.service.refresh(userId, p.id)).rejects.toMatchObject({
      code: "provider_auth_failed",
    });
    expect((await f.service.list(userId))[0]).toMatchObject({
      models: ["manual"],
      lastError: "provider_auth_failed",
    });
    expect(await f.service.refresh(userId, p.id)).toMatchObject({
      models: ["org/model:free", "gpt-6-sol"],
      modelsSource: "fetched",
      lastError: null,
    });
  });
  it("enforces the ten-provider limit for concurrent creates and enforces per-user unique names", async () => {
    const f = fixture();
    const results = await Promise.allSettled(
      Array.from({ length: 11 }, (_, i) =>
        f.service.create(userId, { ...input, name: `Provider ${i}` }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(10);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({
      reason: { code: "provider_limit_reached" },
    });
    await f.service.create(userB, input);
    await expect(f.service.create(userB, input)).rejects.toMatchObject({
      code: "provider_name_taken",
    });
  });
});

describe("chat preference and runtime resolution", () => {
  function setup() {
    const env = loadServerEnv(
      {},
      {
        XY2API_BASE_URL: "https://main.example.com",
        LOOMIC_SECRET_KEY: randomBytes(32).toString("base64"),
        SSO_EMAIL_DOMAIN: "sso.example.com",
        LOOMIC_AGENT_MODEL: "environment-fallback",
      },
    );
    const db = memoryDatabase({});
    const services = createXy2apiServices(env, () => db.admin);
    cleanups.push(() => services.providers.network.close());
    vi.spyOn(services.providers.network, "listModels").mockResolvedValue([
      "org/model:free",
      "other",
    ]);
    return { ...services, ...db, env };
  }
  it("resolves explicit override then account preference without touching a main-site chat key", async () => {
    const f = setup();
    const p = await f.providers.create(userId, input);
    const main = vi
      .spyOn(f.keys, "resolveChatCredential")
      .mockRejectedValue(new Error("No main key"));
    const prefs = await f.keys.updatePreferences(userId, {
      defaultChatProviderId: p.id,
      defaultChatModel: "org/model:free",
    });
    expect(prefs.default_chat_provider_id).toBe(p.id);
    const selected = await resolveRunChatModel({
      userId,
      keys: f.keys,
      providers: f.providers,
      env: f.env,
    });
    expect(selected).toMatchObject({
      source: "custom",
      ref: `custom:${p.id}:org/model:free`,
    });
    const override = await resolveRunChatModel({
      userId,
      override: `custom:${p.id}:other`,
      keys: f.keys,
      providers: f.providers,
      env: f.env,
    });
    expect(override.ref).toBe(`custom:${p.id}:other`);
    expect(main).not.toHaveBeenCalled();
    await expect(
      f.keys.updatePreferences(userB, {
        defaultChatProviderId: p.id,
        defaultChatModel: "other",
      }),
    ).rejects.toMatchObject({ code: "provider_not_found" });
    await expect(
      f.keys.updatePreferences(userId, { defaultChatModel: "missing" }),
    ).rejects.toMatchObject({ code: "provider_model_not_found" });
  });
  it("preserves the custom default during main-key sync; disabled defaults fall back to the first main-site model", async () => {
    const f = setup();
    const p = await f.providers.create(userId, input);
    await f.keys.updatePreferences(userId, {
      defaultChatProviderId: p.id,
      defaultChatModel: "org/model:free",
    });
    vi.spyOn(f.accounts, "withAccess").mockResolvedValue([]);
    await f.keys.syncKeys(userId);
    expect(await f.keys.preferences(userId)).toMatchObject({
      default_chat_provider_id: p.id,
      default_chat_model: "org/model:free",
    });
    await f.providers.patch(userId, p.id, { enabled: false });
    vi.spyOn(f.keys, "resolveChatCredential").mockResolvedValue({
      keyId: 1,
      apiKey: "main-key",
      platform: "openai",
      chatModels: ["first", "environment-fallback"],
    });
    const resolved = await resolveRunChatModel({
      userId,
      keys: f.keys,
      providers: f.providers,
      env: f.env,
    });
    expect(resolved.ref).toBe("openai:first");
    await expect(
      resolveRunChatModel({
        userId,
        override: `custom:${p.id}:other`,
        keys: f.keys,
        providers: f.providers,
        env: f.env,
      }),
    ).rejects.toMatchObject({ code: "provider_model_not_found" });
  });
  it("uses account main-model preference before the first model and always returns the provider field", async () => {
    const f = setup();
    expect(await f.keys.preferences(userId)).toHaveProperty(
      "default_chat_provider_id",
      null,
    );
    f.tables.xy2api_preferences = [
      {
        user_id: userId,
        default_chat_model: "chosen",
        default_chat_provider_id: null,
      },
    ];
    vi.spyOn(f.keys, "resolveChatCredential").mockResolvedValue({
      keyId: 1,
      apiKey: "main-key",
      platform: "openai",
      chatModels: ["first", "chosen"],
    });
    expect(
      (
        await resolveRunChatModel({
          userId,
          keys: f.keys,
          providers: f.providers,
          env: f.env,
        })
      ).ref,
    ).toBe("openai:chosen");
    expect(
      (
        await resolveRunChatModel({
          userId,
          override: "openai:first",
          keys: f.keys,
          providers: f.providers,
          env: f.env,
        })
      ).ref,
    ).toBe("openai:first");
  });
});

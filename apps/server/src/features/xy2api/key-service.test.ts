import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { loadServerEnv } from "../../config/env.js";
import { Xy2apiError } from "./errors.js";
import { createXy2apiServices } from "./services.js";
import { memoryDatabase } from "./test-support.js";

function setup() {
  const env = loadServerEnv(
    {},
    {
      XY2API_BASE_URL: "https://example.com",
      LOOMIC_SECRET_KEY: randomBytes(32).toString("base64"),
      SSO_EMAIL_DOMAIN: "sso.example.com",
    },
  );
  const db = memoryDatabase({});
  const services = createXy2apiServices(env, () => db.admin);
  vi.spyOn(services.accounts, "getAccessToken").mockResolvedValue(
    "synthetic-access",
  );
  vi.spyOn(services.client, "listModels").mockResolvedValue([
    "gpt-image-2",
    "gpt-4.1",
  ]);
  const remote = {
    id: 1,
    key: "synthetic-user-api-credential",
    name: "测试 Key",
    status: "active",
    quota: 0,
    quota_used: 0,
    group: {
      id: 9,
      name: "生图组",
      platform: "openai",
      status: "active",
      allow_image_generation: true,
    },
  };
  const list = vi
    .spyOn(services.client, "listKeys")
    .mockResolvedValue([remote]);
  return { ...db, ...services, list, remote };
}
describe("user key synchronization", () => {
  it("encrypts keys, chooses usable defaults, and deletes upstream removals", async () => {
    const fixture = setup();
    await fixture.keys.syncKeys("user-1");
    expect(fixture.tables.xy2api_api_keys?.[0]).toMatchObject({
      image_capable: true,
      image_models: ["gpt-image-2"],
      chat_models: ["gpt-4.1"],
    });
    expect(JSON.stringify(fixture.tables)).not.toContain(fixture.remote.key);
    expect(await fixture.keys.preferences("user-1")).toMatchObject({
      image_key_id: 1,
      chat_key_id: 1,
    });
    fixture.list.mockResolvedValue([]);
    await fixture.keys.syncKeys("user-1");
    expect(fixture.tables.xy2api_api_keys).toHaveLength(0);
    expect(await fixture.keys.preferences("user-1")).toMatchObject({
      image_key_id: null,
      chat_key_id: null,
    });
  });
  it("rejects a foreign key and inaccessible model preference", async () => {
    const fixture = setup();
    await fixture.keys.syncKeys("user-1");
    await expect(
      fixture.keys.resolveImageCredential("user-2", 1),
    ).rejects.toMatchObject({ code: "key_unavailable" });
    await expect(
      fixture.keys.updatePreferences("user-1", {
        imageKeyId: 1,
        defaultImageModel: "gpt-image-1.5",
      }),
    ).rejects.toMatchObject({ code: "model_not_accessible" });
  });
  it.each(["expired", "quota", "group", "image_permission"])(
    "does not enable an unusable %s key",
    async (reason) => {
      const fixture = setup();
      fixture.list.mockResolvedValue([
        {
          ...fixture.remote,
          ...(reason === "expired"
            ? { expires_at: "2020-01-01T00:00:00Z" }
            : {}),
          ...(reason === "quota" ? { quota: 1, quota_used: 1 } : {}),
          group: {
            ...fixture.remote.group,
            ...(reason === "group" ? { status: "disabled" } : {}),
            ...(reason === "image_permission"
              ? { allow_image_generation: false }
              : {}),
          },
        },
      ]);
      await fixture.keys.syncKeys("user-1");
      expect(fixture.tables.xy2api_api_keys?.[0]?.image_capable).toBe(false);
    },
  );
  it("does not offer a Gemini group with image generation off for images", async () => {
    // FINDINGS K3: groups 26/27 list Gemini image models, but the main site
    // refuses them because the group has image generation off.
    const fixture = setup();
    vi.spyOn(fixture.client, "listModels").mockResolvedValue([
      "gemini-3.1-flash-image",
      "gemini-3.8-flash",
    ]);
    fixture.list.mockResolvedValue([
      {
        ...fixture.remote,
        group: {
          ...fixture.remote.group,
          platform: "gemini",
          allow_image_generation: false,
        },
      },
    ]);
    await fixture.keys.syncKeys("user-1");
    expect(fixture.tables.xy2api_api_keys?.[0]).toMatchObject({
      image_capable: false,
      chat_models: ["gemini-3.8-flash"],
    });
  });
  it("remembers the group id of a key whose group was deleted", async () => {
    // FINDINGS K5: the main site returns group_id with group null.
    const fixture = setup();
    fixture.list.mockResolvedValue([
      { ...fixture.remote, group_id: 31, group: null },
    ]);
    await fixture.keys.syncKeys("user-1");
    expect(fixture.tables.xy2api_api_keys?.[0]).toMatchObject({
      group_id: 31,
      group_name: null,
      image_capable: false,
      chat_models: [],
    });
  });
  it("keeps a $0 key selectable and points to recharge", async () => {
    const fixture = setup();
    // xy2api refuses /v1/models before it looks at the key when the balance is 0.
    vi.spyOn(fixture.client, "listModels").mockRejectedValue(
      new Xy2apiError(403, "INSUFFICIENT_BALANCE"),
    );
    await fixture.keys.syncKeys("user-1");
    expect(fixture.tables.xy2api_api_keys?.[0]).toMatchObject({
      invalid_reason: null,
      image_capable: true,
      chat_models: [],
    });
    expect(fixture.tables.xy2api_api_keys?.[0]?.image_models).toContain(
      "gpt-image-2",
    );
    expect(await fixture.keys.preferences("user-1")).toMatchObject({
      image_key_id: 1,
      chat_key_id: null,
    });
    await expect(
      fixture.keys.resolveChatCredential("user-1"),
    ).rejects.toMatchObject({ code: "insufficient_balance", statusCode: 402 });
    vi.spyOn(fixture.client, "getUsage").mockResolvedValue({ balance: 0 });
    await expect(
      fixture.billing.prepareImageJob({ id: "user-1" }, {}),
    ).rejects.toMatchObject({ code: "insufficient_balance", statusCode: 402 });
  });
  it.each([
    ["insufficient balance", new Xy2apiError(403, "INSUFFICIENT_BALANCE")],
    ["an unclassified refusal", new Xy2apiError(403, "SOMETHING_NEW")],
    ["a gateway outage", new Xy2apiError(502, "INVALID_RESPONSE")],
    ["a network failure", new TypeError("fetch failed")],
  ])("keeps last known models after %s", async (_label, failure) => {
    const fixture = setup();
    await fixture.keys.syncKeys("user-1");
    vi.spyOn(fixture.client, "listModels").mockRejectedValue(failure);
    await fixture.keys.syncKeys("user-1");
    expect(fixture.tables.xy2api_api_keys?.[0]).toMatchObject({
      invalid_reason: null,
      image_capable: true,
      image_models: ["gpt-image-2"],
      chat_models: ["gpt-4.1"],
    });
    expect(await fixture.keys.preferences("user-1")).toMatchObject({
      image_key_id: 1,
      chat_key_id: 1,
    });
  });
  it.each([
    [401, "INVALID_API_KEY", "key_unavailable"],
    [403, "API_KEY_DISABLED", "key_unavailable"],
    [403, "ACCESS_DENIED", "key_ip_restricted"],
  ])(
    "still disables a key on %i %s during discovery",
    async (status, id, reason) => {
      const fixture = setup();
      await fixture.keys.syncKeys("user-1");
      vi.spyOn(fixture.client, "listModels").mockRejectedValue(
        new Xy2apiError(status, id),
      );
      await fixture.keys.syncKeys("user-1");
      expect(fixture.tables.xy2api_api_keys?.[0]).toMatchObject({
        invalid_reason: reason,
        image_capable: false,
      });
      expect(fixture.keys.deferredDiscoveryReason("user-1")).toBeNull();
    },
  );
  it("re-runs deferred discovery once it may succeed, at most every 15 s", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const fixture = setup();
      const models = vi
        .spyOn(fixture.client, "listModels")
        .mockRejectedValue(new Xy2apiError(403, "INSUFFICIENT_BALANCE"));
      await fixture.keys.syncKeys("user-1");
      expect(fixture.keys.deferredDiscoveryReason("user-1")).toBe(
        "insufficient_balance",
      );
      models.mockResolvedValue(["gpt-image-2", "gpt-4.1"]);
      expect(await fixture.keys.retryDeferredDiscovery("user-1")).toBe(false);
      vi.advanceTimersByTime(15_000);
      expect(await fixture.keys.retryDeferredDiscovery("user-1")).toBe(true);
      expect(fixture.keys.deferredDiscoveryReason("user-1")).toBeNull();
      expect(await fixture.keys.preferences("user-1")).toMatchObject({
        image_key_id: 1,
        chat_key_id: 1,
        default_chat_model: "gpt-4.1",
      });
      vi.advanceTimersByTime(15_000);
      expect(await fixture.keys.retryDeferredDiscovery("user-1")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
  it("limits concurrent model discovery to three requests", async () => {
    const fixture = setup();
    fixture.list.mockResolvedValue(
      Array.from({ length: 8 }, (_, index) => ({
        ...fixture.remote,
        id: index + 1,
      })),
    );
    let active = 0;
    let peak = 0;
    vi.spyOn(fixture.client, "listModels").mockImplementation(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return ["gpt-image-2"];
    });
    await fixture.keys.syncKeys("user-1");
    expect(peak).toBe(3);
    expect(fixture.tables.xy2api_api_keys).toHaveLength(8);
  });
  it("checks balance before recording a job and serializes per-user admission", async () => {
    const fixture = setup();
    await fixture.keys.syncKeys("user-1");
    vi.spyOn(fixture.client, "getUsage").mockResolvedValue({ balance: 0 });
    await expect(
      fixture.billing.prepareImageJob({ id: "user-1" }, {}),
    ).rejects.toMatchObject({ code: "insufficient_balance", statusCode: 402 });
    expect(fixture.tables.background_jobs).toBeUndefined();
    const order: number[] = [];
    await Promise.all([
      fixture.billing.withUserLock("user-1", async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push(1);
      }),
      fixture.billing.withUserLock("user-1", async () => {
        order.push(2);
      }),
    ]);
    expect(order).toEqual([1, 2]);
  });
  it("admits a batch only while the user stays within the pending limit", async () => {
    const fixture = setup();
    await fixture.keys.syncKeys("user-1");
    vi.spyOn(fixture.client, "getUsage").mockResolvedValue({ balance: 5 });
    const job = (status: string, billing_status = "none") => ({
      created_by: "user-1",
      status,
      billing_status,
    });
    fixture.tables.background_jobs = [
      ...Array.from({ length: 5 }, () => job("queued")),
      job("running", "pending"),
      // Not counted: done, or charged and only waiting for storage.
      job("succeeded", "charged"),
      job("queued", "charged"),
      { ...job("queued"), created_by: "user-2" },
    ];
    // 6 pending + 2 = the default limit of 8.
    await expect(
      fixture.billing.prepareImageJob({ id: "user-1" }, {}, { count: 2 }),
    ).resolves.toMatchObject({ model: "gpt-image-2" });
    await expect(
      fixture.billing.prepareImageJob({ id: "user-1" }, {}, { count: 3 }),
    ).rejects.toMatchObject({ code: "concurrency_limit", statusCode: 429 });
    // A route that sends from the API process keeps the in-flight limit (2).
    await expect(
      fixture.billing.prepareImageJob({ id: "user-1" }, {}, { sendsNow: true }),
    ).rejects.toMatchObject({ code: "concurrency_limit" });
    fixture.tables.background_jobs = [job("running", "pending")];
    await expect(
      fixture.billing.prepareImageJob({ id: "user-1" }, {}, { sendsNow: true }),
    ).resolves.toMatchObject({
      resolution: "2K",
      quality: "auto",
      aspect_ratio: "1:1",
    });
  });
  it("resolves 画质 / 质量 / 比例 per model and checks references up front", async () => {
    const fixture = setup();
    await fixture.keys.syncKeys("user-1");
    vi.spyOn(fixture.client, "getUsage").mockResolvedValue({ balance: 5 });
    fixture.tables.background_jobs = [];
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await expect(
      fixture.billing.prepareImageJob(
        { id: "user-1" },
        { resolution: "4K", quality: "high", aspect_ratio: "21:9" },
      ),
    ).resolves.toMatchObject({
      model: "gpt-image-2",
      resolution: "4K",
      quality: "high",
      aspect_ratio: "21:9",
    });
    // An older page's single quality field keeps meaning what it meant.
    await expect(
      fixture.billing.prepareImageJob({ id: "user-1" }, { quality: "hd" }),
    ).resolves.toMatchObject({ resolution: "2K", quality: "medium" });
    // Unknown ratios move to the nearest one the model has, and it is logged.
    await expect(
      fixture.billing.prepareImageJob(
        { id: "user-1" },
        { aspect_ratio: "7:3" },
      ),
    ).resolves.toMatchObject({ aspect_ratio: "21:9" });
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining("aspect 7:3→21:9"),
    );
    await expect(
      fixture.billing.prepareImageJob(
        { id: "user-1" },
        { input_images: Array.from({ length: 11 }, () => "data:") },
      ),
    ).rejects.toMatchObject({ code: "invalid_input", statusCode: 400 });
  });
});

describe("several image keys at once (第 56 条)", () => {
  /**
   * Key 1: GPT group (gpt-image-2). Key 2: a newer Gemini group
   * (nano-banana-2.1). Key 3: a newer GPT group that also has gpt-image-2.
   */
  async function threeKeys() {
    const fixture = setup();
    vi.spyOn(fixture.client, "listModels").mockImplementation(
      async (apiKey: string) =>
        apiKey.endsWith("-2")
          ? ["nano-banana-2.1", "gemini-3.8-flash"]
          : ["gpt-image-2", "gpt-4.1"],
    );
    const key = (id: number, platform: string) => ({
      ...fixture.remote,
      id,
      key: `synthetic-user-api-credential-${id}`,
      name: `Key ${id}`,
      group: { ...fixture.remote.group, id: 9 + id, name: `组 ${id}`, platform },
    });
    fixture.list.mockResolvedValue([
      key(3, "openai"),
      key(2, "gemini"),
      key(1, "openai"),
    ]);
    await fixture.keys.syncKeys("user-1");
    vi.spyOn(fixture.client, "getUsage").mockResolvedValue({ balance: 5 });
    fixture.tables.background_jobs = [];
    return fixture;
  }

  it("lists every key that is on, the default first, then newest first", async () => {
    const fixture = await threeKeys();
    await fixture.keys.updatePreferences("user-1", { imageKeyId: 1 });
    const keys = await fixture.keys.imageKeys("user-1");
    expect(keys.map((k) => [k.keyId, k.isDefault, k.imageModels])).toEqual([
      [1, true, ["gpt-image-2"]],
      [3, false, ["gpt-image-2"]],
      [2, false, ["nano-banana-2.1"]],
    ]);
    expect(JSON.stringify(keys)).not.toContain("synthetic-user-api-credential");
  });

  it("sends a model through the key it was picked under, or finds one that has it", async () => {
    const fixture = await threeKeys();
    await fixture.keys.updatePreferences("user-1", { imageKeyId: 1 });
    // A named key wins even when the default key has the same model.
    await expect(
      fixture.billing.prepareImageJob(
        { id: "user-1" },
        { model: "gpt-image-2", key_id: 3 },
      ),
    ).resolves.toMatchObject({ keyId: 3, model: "gpt-image-2" });
    // Only a model: the default key when it has it ...
    await expect(
      fixture.billing.prepareImageJob({ id: "user-1" }, { model: "gpt-image-2" }),
    ).resolves.toMatchObject({ keyId: 1 });
    // ... else the key that does (it used to be "model_not_accessible").
    await expect(
      fixture.billing.prepareImageJob(
        { id: "user-1" },
        { model: "nano-banana-2.1" },
      ),
    ).resolves.toMatchObject({ keyId: 2, model: "nano-banana-2.1" });
    // A key without the model is refused, not silently swapped.
    await expect(
      fixture.billing.prepareImageJob(
        { id: "user-1" },
        { model: "nano-banana-2.1", key_id: 1 },
      ),
    ).rejects.toMatchObject({ code: "model_not_accessible" });
    // Someone else's key id is just unavailable.
    await expect(
      fixture.billing.prepareImageJob({ id: "user-2" }, { key_id: 1 }),
    ).rejects.toMatchObject({ code: "key_unavailable" });
  });

  it("admits several models side by side only when all of them pass", async () => {
    const fixture = await threeKeys();
    const usage = vi.mocked(fixture.client.getUsage);
    const prepared = await fixture.billing.prepareImageJobs(
      { id: "user-1" },
      { aspect_ratio: "3:4", resolution: "2K" },
      [
        { model: "gpt-image-2", key_id: 3, count: 2 },
        { model: "nano-banana-2.1", key_id: 2, count: 2 },
      ],
    );
    expect(prepared.map((p) => [p.keyId, p.model, p.count])).toEqual([
      [3, "gpt-image-2", 2],
      [2, "nano-banana-2.1", 2],
    ]);
    // Balance is read once per key.
    expect(usage).toHaveBeenCalledTimes(2);
    // The pending cap counts every picture of the request.
    fixture.tables.background_jobs = Array.from({ length: 5 }, () => ({
      created_by: "user-1",
      status: "queued",
      billing_status: "none",
    }));
    await expect(
      fixture.billing.prepareImageJobs({ id: "user-1" }, {}, [
        { model: "gpt-image-2", count: 2 },
        { model: "nano-banana-2.1", count: 2 },
      ]),
    ).rejects.toMatchObject({ code: "concurrency_limit" });
    // One model that can't take the references stops the whole request.
    fixture.tables.background_jobs = [];
    await expect(
      fixture.billing.prepareImageJobs(
        { id: "user-1" },
        { input_images: Array.from({ length: 12 }, () => "data:") },
        [
          { model: "nano-banana-2.1", count: 1 },
          { model: "gpt-image-2", count: 1 },
        ],
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("switches keys off for images, keeping one on and the default on an enabled key", async () => {
    const fixture = await threeKeys();
    await fixture.keys.updatePreferences("user-1", { imageKeyId: 3 });
    const prefs = await fixture.keys.updatePreferences("user-1", {
      disabledImageKeyIds: [3, 999],
    });
    // Unknown ids are dropped; the default moved off the key switched off.
    expect(prefs.disabled_image_key_ids).toEqual([3]);
    expect(prefs.image_key_id).toBe(2);
    expect(prefs.default_image_model).toBe("nano-banana-2.1");
    expect((await fixture.keys.imageKeys("user-1")).map((k) => k.keyId)).toEqual(
      [2, 1],
    );
    // Its models are not offered and requests through it are refused.
    await expect(
      fixture.billing.prepareImageJob(
        { id: "user-1" },
        { model: "gpt-image-2", key_id: 3 },
      ),
    ).rejects.toMatchObject({ code: "key_unavailable" });
    await expect(
      fixture.billing.prepareImageJob({ id: "user-1" }, { model: "gpt-image-2" }),
    ).resolves.toMatchObject({ keyId: 1 });
    // A default model on another key moves the default key with it.
    await expect(
      fixture.keys.updatePreferences("user-1", {
        defaultImageModel: "gpt-image-2",
      }),
    ).resolves.toMatchObject({ image_key_id: 1, default_image_model: "gpt-image-2" });
    // Not every key can be off.
    await expect(
      fixture.keys.updatePreferences("user-1", {
        disabledImageKeyIds: [1, 2, 3],
      }),
    ).rejects.toMatchObject({ code: "invalid_input", statusCode: 400 });
  });

  it("forgets deleted keys and never leaves every key off after a sync", async () => {
    const fixture = await threeKeys();
    await fixture.keys.updatePreferences("user-1", {
      disabledImageKeyIds: [1, 2],
    });
    // The only key left on is deleted on the main site.
    fixture.list.mockResolvedValue(
      (await fixture.list.mock.results[0]?.value).filter(
        (key: { id: number }) => key.id !== 3,
      ),
    );
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await fixture.keys.syncKeys("user-1");
    const prefs = await fixture.keys.preferences("user-1");
    expect(prefs.disabled_image_key_ids).toEqual([]);
    expect(prefs.image_key_id).toBe(2);
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining("switching them back on"),
    );
  });
});

describe("keys the main site lists masked", () => {
  const masked = "sk-synt…tial";
  it("reads the full key from GET /api/v1/keys/:id", async () => {
    const fixture = setup();
    fixture.list.mockResolvedValue([
      { ...fixture.remote, key: masked, masked: true },
    ]);
    const getKey = vi
      .spyOn(fixture.client, "getKey")
      .mockResolvedValue({ ...fixture.remote, masked: false });
    await fixture.keys.syncKeys("user-1");
    expect(getKey).toHaveBeenCalledWith("synthetic-access", 1);
    expect(fixture.client.listModels).toHaveBeenCalledWith(fixture.remote.key);
    expect(
      (await fixture.keys.resolveImageCredential("user-1", 1)).apiKey,
    ).toBe(fixture.remote.key);
  });
  it("keeps the full key from an earlier sync when both reads are masked", async () => {
    const fixture = setup();
    await fixture.keys.syncKeys("user-1");
    fixture.list.mockResolvedValue([
      { ...fixture.remote, key: masked, masked: true },
    ]);
    vi.spyOn(fixture.client, "getKey").mockResolvedValue({
      ...fixture.remote,
      key: masked,
      masked: true,
    });
    await fixture.keys.syncKeys("user-1");
    expect(fixture.tables.xy2api_api_keys?.[0]).toMatchObject({
      invalid_reason: null,
      image_capable: true,
    });
    expect(
      (await fixture.keys.resolveImageCredential("user-1", 1)).apiKey,
    ).toBe(fixture.remote.key);
  });
  it("marks a masked key unusable when no full copy exists", async () => {
    const fixture = setup();
    fixture.list.mockResolvedValue([
      { ...fixture.remote, key: masked, masked: true },
    ]);
    vi.spyOn(fixture.client, "getKey").mockRejectedValue(
      new Xy2apiError(404, "NOT_FOUND"),
    );
    await fixture.keys.syncKeys("user-1");
    expect(fixture.client.listModels).not.toHaveBeenCalled();
    expect(fixture.tables.xy2api_api_keys?.[0]).toMatchObject({
      invalid_reason: "key_unavailable",
      image_capable: false,
    });
  });
});

import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { loadServerEnv } from "../../config/env.js";
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
});

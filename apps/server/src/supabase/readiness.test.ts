import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerEnv } from "../config/env.js";
import { createReadinessProbe, isReady } from "./readiness.js";

const all = {
  database: true,
  schema: true,
  queue: true,
  storage: true,
  realtime: true,
  permissions: true,
  auth: true,
  storageApi: true,
};

describe("readiness", () => {
  it("stays ready without the Realtime publication", () => {
    expect(isReady({ ...all, realtime: false })).toBe(true);
  });
  it.each(Object.keys(all).filter((name) => name !== "realtime"))(
    "fails when %s fails",
    (name) => {
      expect(isReady({ ...all, [name]: false })).toBe(false);
    },
  );
});

describe("readiness probe", () => {
  afterEach(() => vi.unstubAllGlobals());
  const env = {
    supabaseUrl: "https://db.example.com",
    supabaseServiceRoleKey: "service-key",
  } as ServerEnv;

  it("checks Storage with a service-role read, not the status page", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const path = new URL(String(input)).pathname;
        seen.push(path);
        // The permission error a half-initialised database gives.
        if (path === "/storage/v1/bucket/project-assets")
          return new Response(
            '{"error":"permission denied to set role \\"service_role\\""}',
            { status: 400 },
          );
        return new Response("{}", { status: 200 });
      }),
    );
    const result = await createReadinessProbe(env).check();
    expect(seen).toContain("/storage/v1/bucket/project-assets");
    expect(seen).not.toContain("/storage/v1/status");
    expect(result.checks.storageApi).toBe(false);
    expect(result.ok).toBe(false);
  });
});

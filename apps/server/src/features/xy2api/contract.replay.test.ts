// Consumer contract tests: replays responses recorded from real xy2api releases
// (deploy/xy2api-lab/record-fixtures.mjs) through our actual adapters — the
// Xy2apiClient, error mapping, session-revocation ids and both image
// providers (real OpenAI / Google SDKs over HTTP).
//
// Every directory in __fixtures__/ is one xy2api version and must pass. The
// xy2api-contract CI job records the *latest* xy2api release into a temp dir
// and points XY2API_FIXTURES_DIR at it, so an upstream release that breaks a
// shape we depend on fails CI before the main site is upgraded.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_CHAT_MODELS } from "../../config/env.js";
import { Xy2apiGeminiImageProvider } from "../../generation/providers/xy2api-gemini-image.js";
import { Xy2apiOpenAIImageProvider } from "../../generation/providers/xy2api-openai-image.js";
import { REVOKED_SESSION_IDS } from "./account-service.js";
import { loadImageCatalog, matchImageModels } from "./catalog.js";
import { Xy2apiClient } from "./client.js";
import { XY2API_VERIFIED_VERSIONS, classifyVersion } from "./compat.js";
import {
  type GatewayCode,
  GatewayError,
  Xy2apiError,
  mapGatewayError,
} from "./errors.js";

type Fixture = {
  scenario: string;
  request: { method: string; path: string };
  response: {
    status: number;
    headers: Record<string, string>;
    json?: unknown;
    text?: string;
  };
};

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLED = join(HERE, "__fixtures__");

function versionDirs(): { version: string; dir: string; bundled: boolean }[] {
  const out: { version: string; dir: string; bundled: boolean }[] = [];
  const collect = (root: string, bundled: boolean) => {
    if (!existsSync(root)) return;
    if (existsSync(join(root, "manifest.json"))) {
      const { version } = JSON.parse(
        readFileSync(join(root, "manifest.json"), "utf8"),
      );
      out.push({ version, dir: root, bundled });
      return;
    }
    for (const entry of readdirSync(root, { withFileTypes: true }))
      if (
        entry.isDirectory() &&
        existsSync(join(root, entry.name, "manifest.json"))
      )
        out.push({ version: entry.name, dir: join(root, entry.name), bundled });
  };
  collect(BUNDLED, true);
  if (process.env.XY2API_FIXTURES_DIR)
    collect(resolve(process.env.XY2API_FIXTURES_DIR), false);
  return out;
}

// One local HTTP server answers every request with the currently armed fixture,
// so the SDK-based providers exercise their real HTTP + parsing paths.
let armed: Fixture | undefined;
let baseUrl = "";
const server = createServer(async (req, res) => {
  for await (const _ of req) {
    /* drain */
  }
  const fixture = armed;
  if (!fixture) {
    res.writeHead(500).end("no fixture armed");
    return;
  }
  const { status, headers, json, text } = fixture.response;
  res.writeHead(status, headers);
  res.end(json !== undefined ? JSON.stringify(json) : (text ?? ""));
});
beforeAll(async () => {
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
});

const catalog = loadImageCatalog();
const chatModels = DEFAULT_CHAT_MODELS.split(",");

describe("bundled fixtures match the verified version list", () => {
  it("lists exactly the recorded versions", () => {
    const bundled = versionDirs()
      .filter((v) => v.bundled)
      .map((v) => v.version)
      .sort();
    expect(bundled).toEqual([...XY2API_VERIFIED_VERSIONS].sort());
  });
});

for (const { version, dir } of versionDirs()) {
  const load = (scenario: string): Fixture | undefined => {
    const file = join(dir, `${scenario}.json`);
    return existsSync(file)
      ? (JSON.parse(readFileSync(file, "utf8")) as Fixture)
      : undefined;
  };
  const must = (scenario: string): Fixture => {
    const fixture = load(scenario);
    if (!fixture) throw new Error(`xy2api ${version}: missing ${scenario}`);
    return fixture;
  };
  const billingFile = join(dir, "billing.json");
  const billed: Record<string, boolean> = existsSync(billingFile)
    ? JSON.parse(readFileSync(billingFile, "utf8")).scenarios
    : {};
  const arm = (scenario: string) => {
    armed = must(scenario);
    return new Xy2apiClient(baseUrl);
  };
  const rejection = async (promise: Promise<unknown>) => {
    const error = await promise.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Xy2apiError);
    return error as Xy2apiError;
  };

  describe(`xy2api ${version} — web API (tier B)`, () => {
    it("exposes its version in public settings", async () => {
      const client = arm("settings.public");
      expect(await client.getVersion()).toBe(version);
      expect(classifyVersion(version).version).toBe(version);
      const settings = await client.getPublicSettings();
      expect(typeof settings.turnstile_enabled).toBe("boolean");
    });

    it("password login yields tokens and an active user", async () => {
      const result = await arm("auth.login.ok").login({
        email: "fixture@example.com",
        password: "fixture",
      });
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.user.id).toBeGreaterThan(0);
      expect(result.user.status).toBe("active");
      expect(result.tokens.access_token).toBeTruthy();
      expect(result.tokens.expires_in).toBeGreaterThan(0);
    });

    it("2FA challenge and completion", async () => {
      const challenge = await arm("auth.login.requires_2fa").login({
        email: "fixture@example.com",
        password: "fixture",
      });
      expect(challenge).toMatchObject({ kind: "2fa" });
      if (challenge.kind === "2fa") {
        expect(challenge.tempToken).toBeTruthy();
        expect(challenge.maskedEmail).toContain("@");
      }
      const done = await arm(
        load("auth.login_2fa.ok")
          ? "auth.login_2fa.ok"
          : "auth.login_2fa.ok_fresh_challenge",
      ).login2fa("temp", "123456");
      expect(done.kind).toBe("ok");
    });

    it("login failures keep the status our login route maps on", async () => {
      const wrong = await rejection(
        arm("auth.login.wrong_password").login({
          email: "x@y.z",
          password: "x",
        }),
      );
      expect(wrong.status).toBe(401); // -> invalid_credentials
      const disabled = await rejection(
        arm("auth.login.user_disabled").login({
          email: "x@y.z",
          password: "x",
        }),
      );
      expect(disabled.status).toBe(403); // -> account_disabled
      const badCode = await rejection(
        arm("auth.login_2fa.wrong_code").login2fa("temp", "000000"),
      );
      expect([400, 401]).toContain(badCode.status); // -> two_factor_invalid
    });

    it("me/refresh succeed and revoked sessions are recognised", async () => {
      expect((await arm("auth.me.ok").me("token")).status).toBe("active");
      const tokens = await arm("auth.refresh.ok").refresh("refresh");
      expect(tokens.access_token).toBeTruthy();
      expect(tokens.expires_in).toBeGreaterThan(0);
      for (const scenario of [
        "auth.me.user_disabled",
        "auth.me.invalid_token",
      ]) {
        const error = await rejection(arm(scenario).me("token"));
        expect(
          REVOKED_SESSION_IDS.has(error.id),
          `${scenario}: ${error.id}`,
        ).toBe(true);
      }
      for (const scenario of [
        "auth.refresh.invalid",
        "auth.refresh.reused",
        "auth.refresh.after_logout",
        "auth.refresh.user_disabled",
      ]) {
        if (!load(scenario)) continue;
        const error = await rejection(arm(scenario).refresh("refresh"));
        expect(
          REVOKED_SESSION_IDS.has(error.id),
          `${scenario}: ${error.id}`,
        ).toBe(true);
      }
      // AccountService's rotation race handling keys on this exact id.
      expect(
        (await rejection(arm("auth.refresh.invalid").refresh("x"))).id,
      ).toBe("REFRESH_TOKEN_INVALID");
    });

    it("lists full (unmasked) keys with their group", async () => {
      const keys = await arm("keys.list").listKeys("token");
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) {
        expect(key.masked).toBe(false);
        expect(key.group?.platform).toBeTruthy();
        expect(key.group?.status).toBe("active");
      }
      expect(keys.some((key) => key.group?.allow_image_generation)).toBe(true);
    });
  });

  describe(`xy2api ${version} — gateway (tiers A/C)`, () => {
    it("model lists keep our image and chat models discoverable", async () => {
      const openai = await arm("gateway.models.openai").listModels("key");
      expect(
        matchImageModels(catalog, "openai", openai).length,
      ).toBeGreaterThan(0);
      expect(chatModels.some((id) => openai.includes(id))).toBe(true);
      const gemini = await arm("gateway.models.gemini").listModels("key");
      expect(
        matchImageModels(catalog, "gemini", gemini).length,
      ).toBeGreaterThan(0);
    });

    it("usage exposes a numeric balance (billing guard pre-check)", async () => {
      const usage = await arm("gateway.usage.before").getUsage("key");
      expect(usage.balance ?? usage.remaining).toBeGreaterThan(0);
      const broke = await arm("gateway.usage.zero_balance").getUsage("key");
      expect(broke.balance ?? broke.remaining).toBe(0);
    });

    // Several codes = the answer legitimately differs between verified
    // versions; "not charged" must hold for all of them.
    const expected: [string, GatewayCode | GatewayCode[]][] = [
      ["gateway.models.user_disabled", "xy2api_reauth_required"],
      ["gateway.models.ip_restricted", "key_ip_restricted"],
      ["gateway.models.key_disabled", "key_unavailable"],
      ["gateway.images.key_disabled", "key_unavailable"],
      ["gateway.models.key_deleted", "key_unavailable"],
      ["gateway.models.invalid_key", "key_unavailable"],
      [
        "gateway.images.generations.insufficient_balance",
        "insufficient_balance",
      ],
      ["gateway.gemini.generate.insufficient_balance", "insufficient_balance"],
      ["gateway.images.generations.wrong_platform_key", "model_not_accessible"],
      ["gateway.images.upstream_safety", "safety_filter"],
      ["gateway.images.upstream_empty", "upstream_busy"],
      ["gateway.images.after_upstream_empty", "upstream_busy"],
      ["gateway.images.upstream_400", "invalid_input"],
      ["gateway.images.upstream_500", "upstream_busy"],
      ["gateway.images.upstream_429", "rate_limited"],
      ["gateway.images.after_upstream_429", "upstream_busy"],
      ["gateway.images.after_upstream_500", "upstream_busy"],
      // xy2api forwards unknown image models; the upstream 404 comes back as a
      // generic 502 "Upstream request failed" (no cooldown, not billed).
      ["gateway.images.unknown_model", "upstream_busy"],
      // 0.2.2 passes Gemini's 404 through; 0.2.5 rejects in its billing
      // pre-flight with 503 "Billing service temporarily unavailable".
      [
        "gateway.gemini.generate.unknown_model",
        ["model_not_accessible", "upstream_busy"],
      ],
      // Risk-control (content moderation) blocks, on at gguuai.com. Must never
      // land on key_unavailable: image-runner would invalidate the user's Key.
      ["gateway.images.moderation_blocked", "safety_filter"],
      ["gateway.gemini.generate.moderation_blocked", "safety_filter"],
      ["gateway.chat.moderation_blocked", "safety_filter"],
      ["gateway.responses.moderation_blocked", "safety_filter"],
    ];
    it.each(expected)("%s maps to %s (not charged)", (scenario, code) => {
      const fixture = load(scenario);
      if (!fixture) return; // scenario added after this version was recorded
      const failure = mapGatewayError({
        status: fixture.response.status,
        body: fixture.response.json,
      });
      expect([code].flat()).toContain(failure.code);
      expect(failure.billing).toBe("not_charged");
      // Our "not charged" must agree with xy2api's own usage records.
      expect(
        billed[scenario] ?? false,
        `${scenario} was billed by xy2api`,
      ).toBe(false);
    });

    it("every recorded gateway error has an expected mapping", () => {
      // New recorder scenarios (or new error statuses from a new xy2api)
      // must get an explicit expectation instead of passing silently.
      const mapped = new Set(expected.map(([scenario]) => scenario));
      const unmapped = readdirSync(dir)
        .filter((f) => f.startsWith("gateway.") && f.endsWith(".json"))
        .map((f) => f.slice(0, -".json".length))
        .filter(
          (s) => (load(s)?.response.status ?? 0) >= 400 && !mapped.has(s),
        );
      expect(unmapped, "add these to the mapping table").toEqual([]);
    });

    it("never reports a billed error response as not charged", () => {
      for (const [scenario, wasBilled] of Object.entries(billed)) {
        const fixture = load(scenario);
        if (!wasBilled || !fixture || fixture.response.status < 400) continue;
        const failure = mapGatewayError({
          status: fixture.response.status,
          body: fixture.response.json,
        });
        expect(failure.billing, scenario).not.toBe("not_charged");
      }
    });

    it("OpenAI image provider parses success and carries the request id", async () => {
      armed = must("gateway.images.generations.ok");
      const provider = new Xy2apiOpenAIImageProvider(catalog, {
        imageOutputFormat: "png",
        imageOutputCompression: 90,
      });
      const image = await provider.generate(
        { model: "gpt-image-2", prompt: "fixture", quality: "standard" },
        { apiKey: "key", baseUrl },
      );
      expect(image.url).toMatch(/^data:image\//);
      expect(image.width).toBeGreaterThan(0);
      const requestId = armed.response.headers["x-client-request-id"];
      if (requestId) expect(image.requestId).toBe(requestId);

      armed = must("gateway.images.generations.insufficient_balance");
      const error = await provider
        .generate(
          { model: "gpt-image-2", prompt: "fixture" },
          { apiKey: "key", baseUrl },
        )
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(GatewayError);
      expect((error as GatewayError).failure.code).toBe("insufficient_balance");
    });

    it("Gemini image provider parses success, safety and balance errors", async () => {
      const provider = new Xy2apiGeminiImageProvider(catalog);
      const model =
        matchImageModels(
          catalog,
          "gemini",
          await arm("gateway.models.gemini").listModels("key"),
        )[0] ?? "gemini-3.1-flash-image";
      const call = () =>
        provider.generate(
          { model, prompt: "fixture", quality: "standard" },
          { apiKey: "key", baseUrl },
        );
      armed = must("gateway.gemini.generate.ok");
      expect((await call()).url).toMatch(/^data:image\//);
      for (const [scenario, code] of [
        ["gateway.gemini.generate.safety", "safety_filter"],
        [
          "gateway.gemini.generate.insufficient_balance",
          "insufficient_balance",
        ],
      ] as const) {
        armed = must(scenario);
        const error = await call().catch((e: unknown) => e);
        expect(error, scenario).toBeInstanceOf(GatewayError);
        const failure = (error as GatewayError).failure;
        expect(failure.code, scenario).toBe(code);
        if (billed[scenario]) {
          // xy2api billed this 2xx block: never claim "not charged", and keep
          // the request id so the job can be reconciled.
          expect(failure.billing, scenario).toBe("unknown");
          expect(failure.requestId, scenario).toBe(
            armed.response.headers["x-client-request-id"],
          );
        }
      }
    });
  });
}

#!/usr/bin/env node
// Records sanitized request/response pairs from a live xy2api instance (lab or
// CI contract stack) into apps/server/src/features/xy2api/__fixtures__/<version>/.
//
// The server's replay tests run the real adapter (Xy2apiClient, error mapping,
// image providers) against every recorded version, so an xy2api release that
// changes a wire shape we depend on shows up as a failing fixture diff instead
// of a production incident. See docs/XY2API_COMPAT.md.
//
// Requires a seeded instance (seed.mjs) and admin credentials, because a few
// scenarios temporarily flip state (disable a user, create throwaway keys).
//
//   XY2API_BASE_URL=http://127.0.0.1:18080 XY2API_ADMIN_EMAIL=... XY2API_ADMIN_PASSWORD=... \
//   node deploy/xy2api-lab/record-fixtures.mjs --accounts ~/xy-lab/lab-accounts.json [--out-dir DIR]
//
// Secrets never reach disk: tokens/keys are replaced by placeholders, JWTs keep
// only exp/iat, image payloads are replaced by a tiny PNG.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
  fail as failWith,
  login as loginWith,
  makeApi,
  makeLogger,
  solidPng,
  totp,
} from "./lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const { values: args } = parseArgs({
  options: {
    accounts: { type: "string" },
    "out-dir": { type: "string" },
    "skip-faults": { type: "boolean", default: false },
  },
});
const BASE = (process.env.XY2API_BASE_URL ?? "http://127.0.0.1:18080").replace(
  /\/+$/,
  "",
);
const log = makeLogger("xy2api-record");
const fail = (message) => failWith("xy2api-record", message);
const api = makeApi(BASE);
if (!args.accounts)
  fail("--accounts <lab-accounts.json from seed.mjs> is required");
const lab = JSON.parse(readFileSync(args.accounts, "utf8"));
const user = (prefix) =>
  lab.users.find((u) => u.email.startsWith(`${prefix}@`)) ??
  fail(`seeded user ${prefix} missing; re-run seed.mjs`);
const A = user("lab-a");
const BROKE = user("lab-broke");
const TFA = user("lab-2fa");
const OFF = user("lab-off");

// ---------------------------------------------------------------------------
// Sanitizing
// ---------------------------------------------------------------------------

const TINY_PNG_B64 = solidPng(8, 8).toString("base64");
const SECRET_FIELDS = new Set([
  "access_token",
  "refresh_token",
  "temp_token",
  "setup_token",
  "secret",
  "api_key",
  "password",
]);
// One-time codes are harmless once used, but keep fixtures free of anything
// derived from a TOTP secret.
const OTP_FIELDS = new Set(["totp_code", "code"]);
let placeholderSeq = 0;

function fakeJwt(token) {
  const parts = token.split(".");
  let claims = {};
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    );
    claims = {
      ...(payload.exp ? { exp: payload.exp } : {}),
      ...(payload.iat ? { iat: payload.iat } : {}),
    };
  } catch {
    /* not a JWT after all */
  }
  const enc = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
  return `${enc({ alg: "none", typ: "JWT" })}.${enc(claims)}.fixture`;
}

function placeholder(field, value) {
  if (/^[\w-]+\.[\w-]+\.[\w-]+$/.test(value)) return fakeJwt(value);
  const n = String(++placeholderSeq).padStart(4, "0");
  if (field === "key") {
    // Keep prefix + length so masked-key detection is exercised realistically.
    const prefix = /^[a-z]+-/i.exec(value)?.[0] ?? "";
    return prefix + `fixture${n}`.padEnd(value.length - prefix.length, "x");
  }
  return `fixture-${field}-${n}`;
}

function sanitize(value, field = "") {
  if (Array.isArray(value)) return value.map((v) => sanitize(v, field));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, sanitize(v, k)]),
    );
  }
  if (typeof value !== "string") return value;
  if (SECRET_FIELDS.has(field) || (field === "key" && value.length >= 16))
    return placeholder(field, value);
  if (OTP_FIELDS.has(field) && /^\d{6,8}$/.test(value))
    return "0".repeat(value.length);
  if (
    (field === "b64_json" || field === "data") &&
    value.length > 256 &&
    /^[A-Za-z0-9+/=]+$/.test(value)
  )
    return TINY_PNG_B64;
  return value;
}

function sanitizeText(text) {
  return text
    .replace(
      /"(b64_json|data)":"[A-Za-z0-9+/=]{256,}"/g,
      (_m, k) => `"${k}":"${TINY_PNG_B64}"`,
    )
    .slice(0, 8000);
}

const KEEP_HEADERS = [
  "content-type",
  "x-client-request-id",
  "x-request-id",
  "retry-after",
];

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

const recorded = [];
const requestIds = new Map(); // scenario -> { id: x-client-request-id, key }
let outDir;

async function exchange(scenario, spec) {
  const {
    method = "GET",
    path,
    bearer,
    googKey,
    json,
    form,
    tier,
    note,
  } = spec;
  const headers = { accept: "application/json" };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  if (googKey) headers["x-goog-api-key"] = googKey;
  let body;
  if (json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(json);
  } else if (form) {
    body = form;
  }
  const started = Date.now();
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  const fixture = {
    scenario,
    tier,
    ...(note ? { note } : {}),
    request: {
      method,
      path,
      auth: bearer ? "bearer" : googKey ? "x-goog-api-key" : "none",
      ...(json !== undefined
        ? { body: sanitize(json) }
        : form
          ? { body: "<multipart/form-data>" }
          : {}),
    },
    response: {
      status: response.status,
      headers: Object.fromEntries(
        KEEP_HEADERS.filter((h) => response.headers.has(h)).map((h) => [
          h,
          response.headers.get(h),
        ]),
      ),
      ...(parsed !== null
        ? { json: sanitize(parsed) }
        : { text: sanitizeText(text) }),
    },
  };
  writeFileSync(
    join(outDir, `${scenario}.json`),
    `${JSON.stringify(fixture, null, 2)}\n`,
  );
  recorded.push({
    scenario,
    tier,
    status: response.status,
    ms: Date.now() - started,
  });
  const clientRequestId = response.headers.get("x-client-request-id");
  if (clientRequestId)
    requestIds.set(scenario, { id: clientRequestId, key: bearer ?? googKey });
  log("recorded", { scenario, status: response.status });
  return {
    status: response.status,
    json: parsed,
    text,
    headers: response.headers,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function freshTokens(u) {
  const first = await api("POST", "/api/v1/auth/login", {
    body: { email: u.email, password: u.password },
  });
  if (first.access_token) return first;
  return api("POST", "/api/v1/auth/login/2fa", {
    body: { temp_token: first.temp_token, totp_code: totp(u.totpSecret) },
  });
}

async function main() {
  const settings = await api("GET", "/api/v1/settings/public");
  const version = settings?.version;
  if (!version)
    fail(
      "instance does not expose settings.version; pass a version explicitly (TODO) or upgrade",
    );
  outDir = resolve(
    args["out-dir"] ??
      join(HERE, "../../apps/server/src/features/xy2api/__fixtures__", version),
  );
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  log("recording", { base: BASE, version, outDir });
  const admin = await loginWith(
    api,
    required("XY2API_ADMIN_EMAIL"),
    required("XY2API_ADMIN_PASSWORD"),
  );

  // ----- Tier B: web API (auth, keys, settings) ---------------------------
  await exchange("settings.public", {
    tier: "B",
    path: "/api/v1/settings/public",
  });
  const loginA = await exchange("auth.login.ok", {
    tier: "B",
    method: "POST",
    path: "/api/v1/auth/login",
    json: { email: A.email, password: A.password },
  });
  await exchange("auth.login.wrong_password", {
    tier: "B",
    method: "POST",
    path: "/api/v1/auth/login",
    json: { email: A.email, password: `${A.password}-wrong` },
  });
  const challenge = await exchange("auth.login.requires_2fa", {
    tier: "B",
    method: "POST",
    path: "/api/v1/auth/login",
    json: { email: TFA.email, password: TFA.password },
  });
  const temp = challenge.json?.data?.temp_token;
  const good = totp(TFA.totpSecret);
  const bad = String((Number(good) + 500_000) % 1_000_000).padStart(6, "0");
  await exchange("auth.login_2fa.wrong_code", {
    tier: "B",
    method: "POST",
    path: "/api/v1/auth/login/2fa",
    json: { temp_token: temp, totp_code: bad },
  });
  const twoFa = await exchange("auth.login_2fa.ok", {
    tier: "B",
    method: "POST",
    path: "/api/v1/auth/login/2fa",
    json: { temp_token: temp, totp_code: totp(TFA.totpSecret) },
    note: "same temp_token after one wrong code",
  });
  if (twoFa.status !== 200) {
    const again = await api("POST", "/api/v1/auth/login", {
      body: { email: TFA.email, password: TFA.password },
    });
    await exchange("auth.login_2fa.ok_fresh_challenge", {
      tier: "B",
      method: "POST",
      path: "/api/v1/auth/login/2fa",
      json: { temp_token: again.temp_token, totp_code: totp(TFA.totpSecret) },
      note: "a wrong code invalidated the previous temp_token",
    });
  }
  await exchange("auth.login_2fa.invalid_temp_token", {
    tier: "B",
    method: "POST",
    path: "/api/v1/auth/login/2fa",
    json: { temp_token: "invalid-temp-token", totp_code: "123456" },
  });

  const tokA = loginA.json.data;
  await exchange("auth.me.ok", {
    tier: "B",
    path: "/api/v1/auth/me",
    bearer: tokA.access_token,
  });
  await exchange("auth.me.invalid_token", {
    tier: "B",
    path: "/api/v1/auth/me",
    bearer: "invalid.jwt.token",
  });
  const refreshed = await exchange("auth.refresh.ok", {
    tier: "B",
    method: "POST",
    path: "/api/v1/auth/refresh",
    json: { refresh_token: tokA.refresh_token },
  });
  const tokA2 = refreshed.json?.data;
  await exchange("auth.refresh.invalid", {
    tier: "B",
    method: "POST",
    path: "/api/v1/auth/refresh",
    json: { refresh_token: "not-a-refresh-token" },
  });
  await exchange("keys.list", {
    tier: "B",
    path: "/api/v1/keys?page=1&page_size=100",
    bearer: tokA2.access_token,
  });
  await exchange("keys.list.page_beyond", {
    tier: "B",
    path: "/api/v1/keys?page=99&page_size=100",
    bearer: tokA2.access_token,
  });
  await exchange("auth.refresh.reused", {
    tier: "B",
    method: "POST",
    path: "/api/v1/auth/refresh",
    json: { refresh_token: tokA.refresh_token },
    note: "replaying an already-rotated refresh token",
  });
  await exchange("auth.me.after_refresh_reuse", {
    tier: "B",
    path: "/api/v1/auth/me",
    bearer: tokA2.access_token,
  });
  const tokA3 = await freshTokens(A);
  await exchange("auth.logout", {
    tier: "B",
    method: "POST",
    path: "/api/v1/auth/logout",
    json: { refresh_token: tokA3.refresh_token },
    bearer: tokA3.access_token,
  });
  await exchange("auth.me.after_logout", {
    tier: "B",
    path: "/api/v1/auth/me",
    bearer: tokA3.access_token,
  });
  await exchange("auth.refresh.after_logout", {
    tier: "B",
    method: "POST",
    path: "/api/v1/auth/refresh",
    json: { refresh_token: tokA3.refresh_token },
  });

  // Disabled user: capture what our revoke logic keys on.
  const offTokens = await freshTokens(OFF);
  await api("PUT", `/api/v1/admin/users/${OFF.id}`, {
    token: admin,
    body: { status: "disabled" },
  });
  try {
    await exchange("auth.me.user_disabled", {
      tier: "B",
      path: "/api/v1/auth/me",
      bearer: offTokens.access_token,
    });
    await exchange("auth.refresh.user_disabled", {
      tier: "B",
      method: "POST",
      path: "/api/v1/auth/refresh",
      json: { refresh_token: offTokens.refresh_token },
    });
    await exchange("auth.login.user_disabled", {
      tier: "B",
      method: "POST",
      path: "/api/v1/auth/login",
      json: { email: OFF.email, password: OFF.password },
    });
    await exchange("gateway.models.user_disabled", {
      tier: "A",
      path: "/v1/models",
      bearer: OFF.keys.openai.key,
    });
  } finally {
    await api("PUT", `/api/v1/admin/users/${OFF.id}`, {
      token: admin,
      body: { status: "active" },
    });
  }

  // Key states (throwaway keys on lab-a).
  const tok = (await freshTokens(A)).access_token;
  const ipKey = await api("POST", "/api/v1/keys", {
    token: tok,
    body: {
      name: "fixture-tmp-ip",
      group_id: lab.groups.openai.id,
      ip_whitelist: ["203.0.113.7"],
    },
  });
  const offKey = await api("POST", "/api/v1/keys", {
    token: tok,
    body: { name: "fixture-tmp-off", group_id: lab.groups.openai.id },
  });
  try {
    await exchange("gateway.models.ip_restricted", {
      tier: "A",
      path: "/v1/models",
      bearer: ipKey.key,
    });
    await api("PUT", `/api/v1/keys/${offKey.id}`, {
      token: tok,
      body: { status: "inactive" },
    });
    await exchange("gateway.models.key_disabled", {
      tier: "A",
      path: "/v1/models",
      bearer: offKey.key,
    });
    await exchange("gateway.images.key_disabled", {
      tier: "A",
      method: "POST",
      path: "/v1/images/generations",
      bearer: offKey.key,
      json: { model: "gpt-image-2", prompt: "fixture" },
    });
  } finally {
    for (const k of [ipKey, offKey])
      await api("DELETE", `/api/v1/keys/${k.id}`, { token: tok }).catch(
        () => {},
      );
  }
  await exchange("gateway.models.key_deleted", {
    tier: "A",
    path: "/v1/models",
    bearer: offKey.key,
  });
  await exchange("gateway.models.invalid_key", {
    tier: "A",
    path: "/v1/models",
    bearer: "sk-invalid-0000000000000000",
  });

  // ----- Tier A/C: gateway ------------------------------------------------
  await exchange("gateway.models.openai", {
    tier: "A",
    path: "/v1/models",
    bearer: A.keys.openai.key,
  });
  await exchange("gateway.models.gemini", {
    tier: "A",
    path: "/v1/models",
    bearer: A.keys.gemini.key,
  });
  await exchange("gateway.usage.before", {
    tier: "C",
    path: "/v1/usage",
    bearer: A.keys.openai.key,
  });
  await exchange("gateway.usage.zero_balance", {
    tier: "C",
    path: "/v1/usage",
    bearer: BROKE.keys.openai.key,
  });
  await exchange("gateway.images.generations.ok", {
    tier: "A",
    method: "POST",
    path: "/v1/images/generations",
    bearer: A.keys.openai.key,
    json: {
      model: "gpt-image-2",
      prompt: "fixture: a lighthouse at dusk",
      size: "1024x1024",
      quality: "low",
      n: 1,
    },
  });
  const form = new FormData();
  form.append("model", "gpt-image-2");
  form.append("prompt", "fixture: make it warmer");
  form.append("size", "1024x1024");
  form.append(
    "image",
    new Blob([solidPng(64, 64)], { type: "image/png" }),
    "reference.png",
  );
  await exchange("gateway.images.edits.ok", {
    tier: "A",
    method: "POST",
    path: "/v1/images/edits",
    bearer: A.keys.openai.key,
    form,
  });
  await exchange("gateway.images.generations.insufficient_balance", {
    tier: "A",
    method: "POST",
    path: "/v1/images/generations",
    bearer: BROKE.keys.openai.key,
    json: { model: "gpt-image-2", prompt: "fixture", size: "1024x1024" },
  });
  await exchange("gateway.images.generations.wrong_platform_key", {
    tier: "A",
    method: "POST",
    path: "/v1/images/generations",
    bearer: A.keys.gemini.key,
    json: { model: "gpt-image-2", prompt: "fixture" },
  });
  const geminiBody = (prompt) => ({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig: { aspectRatio: "1:1", imageSize: "1K" },
    },
  });
  await exchange("gateway.gemini.generate.ok", {
    tier: "A",
    method: "POST",
    path: "/v1beta/models/gemini-3.1-flash-image:generateContent",
    googKey: A.keys.gemini.key,
    json: geminiBody("fixture: a red bicycle"),
  });
  await exchange("gateway.gemini.generate.safety", {
    tier: "A",
    method: "POST",
    path: "/v1beta/models/gemini-3.1-flash-image:generateContent",
    googKey: A.keys.gemini.key,
    json: geminiBody("fixture [[mock:safety]]"),
  });
  await exchange("gateway.gemini.generate.insufficient_balance", {
    tier: "A",
    method: "POST",
    path: "/v1beta/models/gemini-3.1-flash-image:generateContent",
    googKey: BROKE.keys.gemini.key,
    json: geminiBody("fixture"),
  });
  await exchange("gateway.chat.stream_tool_call", {
    tier: "A",
    method: "POST",
    path: "/v1/chat/completions",
    bearer: A.keys.openai.key,
    json: {
      model: "gpt-5.4",
      stream: true,
      messages: [{ role: "user", content: "帮我画一只猫" }],
      tools: [
        {
          type: "function",
          function: {
            name: "generate_image",
            parameters: {
              type: "object",
              properties: { prompt: { type: "string" } },
            },
          },
        },
      ],
    },
  });
  await exchange("gateway.chat.plain", {
    tier: "A",
    method: "POST",
    path: "/v1/chat/completions",
    bearer: A.keys.openai.key,
    json: { model: "gpt-5.4", messages: [{ role: "user", content: "你好" }] },
  });

  // ----- Content moderation (xy2api "risk control", on in production) -----
  // Blocks happen before any upstream call, so no cooldown. One scenario per
  // wire path we use: images, Gemini, chat completions and Responses (both
  // streaming, as the design assistant streams).
  if (lab.moderation?.keyword) {
    const blocked = `fixture ${lab.moderation.keyword}`;
    await exchange("gateway.images.moderation_blocked", {
      tier: "A",
      method: "POST",
      path: "/v1/images/generations",
      bearer: A.keys.openai.key,
      json: { model: "gpt-image-2", prompt: blocked, size: "1024x1024" },
    });
    await exchange("gateway.gemini.generate.moderation_blocked", {
      tier: "A",
      method: "POST",
      path: "/v1beta/models/gemini-3.1-flash-image:generateContent",
      googKey: A.keys.gemini.key,
      json: geminiBody(blocked),
    });
    await exchange("gateway.chat.moderation_blocked", {
      tier: "A",
      method: "POST",
      path: "/v1/chat/completions",
      bearer: A.keys.openai.key,
      json: {
        model: "gpt-5.4",
        stream: true,
        messages: [{ role: "user", content: blocked }],
      },
    });
    await exchange("gateway.responses.moderation_blocked", {
      tier: "A",
      method: "POST",
      path: "/v1/responses",
      bearer: A.keys.openai.key,
      json: { model: "gpt-5.4", stream: true, input: blocked },
    });
  } else {
    log("moderation not seeded; skipping moderation scenarios");
  }

  await exchange("gateway.usage.after", {
    tier: "C",
    path: "/v1/usage",
    bearer: A.keys.openai.key,
    note: "after one generation + one edit",
  });
  // Last Gemini scenario on purpose: if the upstream 404 cools the account
  // down, nothing after this depends on the Gemini account.
  await exchange("gateway.gemini.generate.unknown_model", {
    tier: "A",
    method: "POST",
    path: "/v1beta/models/gemini-does-not-exist:generateContent",
    googKey: A.keys.gemini.key,
    json: geminiBody("fixture"),
  });
  await exchange("gateway.gemini.generate.after_unknown_model", {
    tier: "A",
    method: "POST",
    path: "/v1beta/models/gemini-3.1-flash-image:generateContent",
    googKey: A.keys.gemini.key,
    json: geminiBody("fixture"),
    note: "immediately after gateway.gemini.generate.unknown_model",
  });

  // ----- Faults (dedicated account; xy2api cools it down) -----------------
  if (!args["skip-faults"]) {
    // Some upstream failures make xy2api cool the account down (~1 min of 503),
    // so every fault starts from a healthy account and the follow-up request
    // captures the cooldown response explicitly.
    const fk = A.keys.faults.key;
    const img = (body) => ({
      tier: "A",
      method: "POST",
      path: "/v1/images/generations",
      bearer: fk,
      json: { model: "gpt-image-2", prompt: "fixture", ...body },
    });
    for (const [name, body] of [
      ["upstream_safety", { prompt: "fixture [[mock:safety]]" }],
      ["upstream_empty", { prompt: "fixture [[mock:empty]]" }],
      ["upstream_400", { prompt: "fixture [[mock:status=400]]" }],
      ["upstream_500", { prompt: "fixture [[mock:status=500]]" }],
      ["upstream_429", { prompt: "fixture [[mock:status=429]]" }],
      // xy2api forwards unknown model names; the upstream's 404 decides.
      ["unknown_model", { model: "gpt-image-does-not-exist" }],
    ]) {
      await waitRecovered(fk);
      await exchange(`gateway.images.${name}`, img(body));
      await exchange(`gateway.images.after_${name}`, {
        ...img({}),
        note: `immediately after ${name}`,
      });
    }
    await waitRecovered(fk);
    await recordBilling(A);
  }

  writeFileSync(
    join(outDir, "manifest.json"),
    `${JSON.stringify({ version, recordedAt: new Date().toISOString(), recorder: "deploy/xy2api-lab/record-fixtures.mjs", scenarios: recorded }, null, 2)}\n`,
  );
  log("done", { version, scenarios: recorded.length, outDir });
}

// xy2api usage records carry request_id "client:<x-client-request-id>", so we
// can tell exactly which recorded requests were billed. The replay suite checks
// that every response we classify as not_charged really has no usage record.
async function recordBilling(u) {
  const token = (await freshTokens(u)).access_token;
  const billed = new Set();
  for (let page = 1; page <= 20; page++) {
    const data = await api("GET", `/api/v1/usage?page=${page}&page_size=100`, {
      token,
    });
    for (const item of data?.items ?? [])
      if (typeof item.request_id === "string")
        billed.add(item.request_id.replace(/^client:/, ""));
    if (!data?.pages || page >= data.pages) break;
  }
  const ownKeys = new Set(Object.values(u.keys).map((k) => k.key));
  const scenarios = Object.fromEntries(
    [...requestIds]
      .filter(
        ([scenario, r]) =>
          scenario.startsWith("gateway.") && ownKeys.has(r.key),
      )
      .map(([scenario, r]) => [scenario, billed.has(r.id)]),
  );
  writeFileSync(
    join(outDir, "billing.json"),
    `${JSON.stringify({ note: "scenario -> whether xy2api wrote a usage record for its x-client-request-id (lab-a only)", user: u.email, scenarios }, null, 2)}\n`,
  );
  log("billing evidence recorded", {
    scenarios: Object.keys(scenarios).length,
  });
}

async function waitRecovered(apiKey) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const r = await fetch(`${BASE}/v1/images/generations`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "gpt-image-2", prompt: "recovery probe" }),
    });
    await r.arrayBuffer();
    if (r.ok) return;
    await sleep(5000);
  }
  log("faults account did not recover within 180s; continuing");
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`${name} is required`);
  return value;
}

main().catch((error) =>
  fail(error instanceof Error ? (error.stack ?? error.message) : String(error)),
);

#!/usr/bin/env node
// Idempotently provisions an xy2api instance for the lab / contract tests:
//   - groups openai / gemini (image generation enabled, image prices) plus a
//     "faults" openai group for [[mock:status=...]] injection: xy2api cools an
//     account down after upstream 429/5xx (~1 min of 503 "No available
//     compatible accounts"), so fault tests get their own account
//   - one "apikey" upstream account per group, all pointing at the mock
//   - users: funded, unfunded (insufficient balance), funded + TOTP, and one
//     the fixture recorder toggles disabled
//   - one API key per user and group
//   - keyword-only content moderation (xy2api "risk control"), so blocked
//     prompts can be recorded without an external moderation API. Auto-ban is
//     off so the funded user stays usable.
//
// Usage (secrets only via env / files, nothing secret is printed):
//   XY2API_BASE_URL=http://127.0.0.1:18080 \
//   XY2API_ADMIN_EMAIL=... XY2API_ADMIN_PASSWORD=... \
//   MOCK_UPSTREAM_KEY=... MOCK_UPSTREAM_BASE_URL=http://mock-upstream:8000 \
//   XY2API_LAB_ACCEPT_ADMIN_COMPLIANCE=1 \
//   node deploy/xy2api-lab/seed.mjs --out /path/to/lab-accounts.json
//
// XY2API_LAB_ACCEPT_ADMIN_COMPLIANCE: xy2api >= 0.2.x refuses admin API calls
// until the operator accepts its deployment compliance commitment. The seed
// only accepts it when the operator opts in explicitly; the phrase is read
// from the instance (never hard-coded) so new commitment versions still work.

import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import {
  ApiError,
  LAB_BLOCKED_KEYWORD,
  fail as failWith,
  items,
  login as loginWith,
  makeApi,
  makeLogger,
  totp,
} from "./lib.mjs";

const { values: args } = parseArgs({
  options: { out: { type: "string" } },
});

const BASE = (process.env.XY2API_BASE_URL ?? "http://127.0.0.1:18080").replace(
  /\/+$/,
  "",
);
const OUT = args.out ?? process.env.XY2API_LAB_ACCOUNTS_FILE;
const MOCK_KEY = required("MOCK_UPSTREAM_KEY");
const MOCK_BASE =
  process.env.MOCK_UPSTREAM_BASE_URL ?? "http://mock-upstream:8000";
const LAB_DOMAIN = process.env.XY2API_LAB_USER_DOMAIN ?? "xy-lab.test";
const log = makeLogger("xy2api-seed");
const fail = (message) => failWith("xy2api-seed", message);
const api = makeApi(BASE);
const login = (email, password, totpSecret) =>
  loginWith(api, email, password, totpSecret);

if (!OUT) fail("--out (or XY2API_LAB_ACCOUNTS_FILE) is required");

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`${name} is required`);
  return value;
}

async function ensureCompliance(admin) {
  let status;
  try {
    status = await api("GET", "/api/v1/admin/compliance", { token: admin });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return; // older xy2api
    throw error;
  }
  if (!status?.required) return;
  if (process.env.XY2API_LAB_ACCEPT_ADMIN_COMPLIANCE !== "1")
    fail(
      `xy2api requires the operator to accept its admin compliance commitment (${status.version}); read it and set XY2API_LAB_ACCEPT_ADMIN_COMPLIANCE=1 to accept on this lab instance`,
    );
  await api("POST", "/api/v1/admin/compliance/accept", {
    token: admin,
    body: {
      phrase: status.ack_phrase_zh ?? status.ack_phrase_en,
      language: status.ack_phrase_zh ? "zh" : "en",
    },
  });
  log("accepted admin compliance commitment on lab instance", {
    version: status.version,
  });
}

// Returns null when this xy2api has no risk control (older releases).
async function ensureModeration(admin) {
  try {
    await api("PUT", "/api/v1/admin/settings", {
      token: admin,
      body: { risk_control_enabled: true },
    });
    await api("PUT", "/api/v1/admin/risk-control/config", {
      token: admin,
      body: {
        enabled: true,
        mode: "pre_block",
        keyword_blocking_mode: "keyword_only",
        blocked_keywords: [LAB_BLOCKED_KEYWORD],
        all_groups: true,
        model_filter: { type: "all", models: [] },
        auto_ban_enabled: false,
        pre_hash_check_enabled: false,
        email_on_hit: false,
      },
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      log("risk control not available on this xy2api; skipping moderation");
      return null;
    }
    throw error;
  }
  log("keyword-only content moderation enabled");
  return { keyword: LAB_BLOCKED_KEYWORD };
}

async function ensureGroup(admin, spec) {
  const existing = items(
    await api("GET", "/api/v1/admin/groups/all", { token: admin }),
  ).find((g) => g.name === spec.name);
  if (existing) return existing;
  const created = await api("POST", "/api/v1/admin/groups", {
    token: admin,
    body: spec,
  });
  log("group created", {
    name: spec.name,
    id: created.id,
    platform: spec.platform,
  });
  return created;
}

async function ensureAccount(admin, spec) {
  const list = await api(
    "GET",
    `/api/v1/admin/accounts?page=1&page_size=100&search=${encodeURIComponent(spec.name)}`,
    { token: admin },
  );
  const existing = items(list).find((a) => a.name === spec.name);
  if (existing) {
    // Keep credentials aligned with the current mock key (it may be rotated).
    await api("PUT", `/api/v1/admin/accounts/${existing.id}`, {
      token: admin,
      body: { credentials: spec.credentials, group_ids: spec.group_ids },
    });
    return existing;
  }
  const created = await api("POST", "/api/v1/admin/accounts", {
    token: admin,
    body: spec,
  });
  log("account created", {
    name: spec.name,
    id: created.id,
    platform: spec.platform,
  });
  return created;
}

async function ensureUser(admin, state, spec) {
  const known = state.users?.find((u) => u.email === spec.email);
  const list = await api(
    "GET",
    `/api/v1/admin/users?page=1&page_size=50&search=${encodeURIComponent(spec.email)}`,
    { token: admin },
  );
  const existing = items(list).find((u) => u.email === spec.email);
  const password = known?.password ?? randomBytes(12).toString("hex");
  if (existing) {
    if (!known?.password)
      await api("PUT", `/api/v1/admin/users/${existing.id}`, {
        token: admin,
        body: { password },
      });
    return {
      id: existing.id,
      email: spec.email,
      password,
      totpSecret: known?.totpSecret ?? null,
    };
  }
  const created = await api("POST", "/api/v1/admin/users", {
    token: admin,
    body: {
      email: spec.email,
      password,
      username: spec.username,
      balance: spec.balance,
      concurrency: 5,
    },
  });
  log("user created", {
    email: spec.email,
    id: created.id,
    balance: spec.balance,
  });
  return { id: created.id, email: spec.email, password, totpSecret: null };
}

async function ensureTotp(user) {
  const token = await login(user.email, user.password, user.totpSecret);
  const status = await api("GET", "/api/v1/user/totp/status", { token });
  if (status?.enabled && user.totpSecret) return user;
  if (status?.enabled)
    throw new Error(
      `${user.email} has TOTP enabled but its secret was lost; reset the lab`,
    );
  const setup = await api("POST", "/api/v1/user/totp/setup", {
    token,
    body: { password: user.password },
  });
  await api("POST", "/api/v1/user/totp/enable", {
    token,
    body: { totp_code: totp(setup.secret), setup_token: setup.setup_token },
  });
  log("totp enabled", { email: user.email });
  return { ...user, totpSecret: setup.secret };
}

async function ensureKeys(user, groups) {
  const token = await login(user.email, user.password, user.totpSecret);
  const keys = items(
    await api("GET", "/api/v1/keys?page=1&page_size=100", { token }),
  );
  const out = {};
  for (const [label, group] of Object.entries(groups)) {
    const name = `lab-${label}`;
    let key = keys.find((k) => k.name === name);
    if (!key) {
      key = await api("POST", "/api/v1/keys", {
        token,
        body: { name, group_id: group.id },
      });
      log("api key created", { email: user.email, name, group: group.name });
    }
    out[label] = { id: key.id, key: key.key };
  }
  return out;
}

async function main() {
  const adminEmail = required("XY2API_ADMIN_EMAIL");
  const adminPassword = required("XY2API_ADMIN_PASSWORD");
  const state = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};

  const settings = await api("GET", "/api/v1/settings/public");
  log("xy2api reachable", {
    base: BASE,
    version: settings?.version ?? "unknown",
  });

  const admin = await login(adminEmail, adminPassword);
  await ensureCompliance(admin);
  // TOTP must be globally enabled before a user can bind an authenticator.
  await api("PUT", "/api/v1/admin/settings", {
    token: admin,
    body: { totp_enabled: true },
  });
  const moderation = await ensureModeration(admin);

  const imagePricing = {
    image_price_1k: 0.04,
    image_price_2k: 0.08,
    image_price_4k: 0.16,
  };
  const groups = {
    openai: await ensureGroup(admin, {
      name: "lab-openai",
      description: "lab: mock upstream (openai wire format)",
      platform: "openai",
      rate_multiplier: 1,
      allow_image_generation: true,
      ...imagePricing,
    }),
    gemini: await ensureGroup(admin, {
      name: "lab-gemini",
      description: "lab: mock upstream (gemini wire format)",
      platform: "gemini",
      rate_multiplier: 1,
      allow_image_generation: true,
      ...imagePricing,
    }),
    faults: await ensureGroup(admin, {
      name: "lab-faults",
      description: "lab: fault injection only (accounts here get cooled down)",
      platform: "openai",
      rate_multiplier: 1,
      allow_image_generation: true,
      ...imagePricing,
    }),
  };

  const accounts = {
    openai: await ensureAccount(admin, {
      name: "lab-mock-openai",
      platform: "openai",
      type: "apikey",
      credentials: { api_key: MOCK_KEY, base_url: MOCK_BASE },
      concurrency: 20,
      group_ids: [groups.openai.id],
    }),
    gemini: await ensureAccount(admin, {
      name: "lab-mock-gemini",
      platform: "gemini",
      type: "apikey",
      credentials: { api_key: MOCK_KEY, base_url: MOCK_BASE },
      concurrency: 20,
      group_ids: [groups.gemini.id],
    }),
    faults: await ensureAccount(admin, {
      name: "lab-mock-faults",
      platform: "openai",
      type: "apikey",
      credentials: { api_key: MOCK_KEY, base_url: MOCK_BASE },
      concurrency: 20,
      group_ids: [groups.faults.id],
    }),
  };

  const users = [];
  for (const spec of [
    {
      email: `lab-a@${LAB_DOMAIN}`,
      username: "lab-a",
      balance: 50,
      totp: false,
    },
    {
      email: `lab-broke@${LAB_DOMAIN}`,
      username: "lab-broke",
      balance: 0,
      totp: false,
    },
    {
      email: `lab-2fa@${LAB_DOMAIN}`,
      username: "lab-2fa",
      balance: 50,
      totp: true,
    },
    // Disabled/re-enabled by the fixture recorder to capture USER_INACTIVE.
    {
      email: `lab-off@${LAB_DOMAIN}`,
      username: "lab-off",
      balance: 1,
      totp: false,
    },
  ]) {
    let user = await ensureUser(admin, state, spec);
    if (spec.totp) user = await ensureTotp(user);
    user.keys = await ensureKeys(user, groups);
    users.push(user);
  }

  const result = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE,
    version: settings?.version ?? null,
    moderation,
    groups: Object.fromEntries(
      Object.entries(groups).map(([k, g]) => [k, { id: g.id, name: g.name }]),
    ),
    accounts: Object.fromEntries(
      Object.entries(accounts).map(([k, a]) => [k, { id: a.id, name: a.name }]),
    ),
    users,
  };
  writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  chmodSync(OUT, 0o600);
  log("done", {
    out: OUT,
    version: result.version,
    users: users.map((u) => ({
      email: u.email,
      totp: Boolean(u.totpSecret),
      keys: Object.keys(u.keys),
    })),
  });
}

main().catch((error) =>
  fail(error instanceof Error ? error.message : String(error)),
);

// Shared helpers for the xy2api lab scripts (seed, fixture recorder).
// Wire handling is deliberately tolerant: responses are unwrapped from the
// {code,message,data} envelope when present, lists accept {items} or arrays.

import { createHmac } from "node:crypto";
import { deflateSync } from "node:zlib";

// Prompts containing this word are rejected by the lab's keyword-only content
// moderation (seed.mjs). Production gguuai.com runs xy2api risk control, so
// the contract must include what a moderation block looks like.
export const LAB_BLOCKED_KEYWORD = "xylabblockedword";

export function makeLogger(tag) {
  return (message, fields = {}) =>
    console.log(
      `[${tag}] ${message}${Object.keys(fields).length ? ` ${JSON.stringify(fields)}` : ""}`,
    );
}

export function fail(tag, message) {
  console.error(`[${tag}] ${message}`);
  process.exit(1);
}

export class ApiError extends Error {
  constructor(status, code, message) {
    super(`${status} ${code ?? ""} ${message ?? ""}`.trim());
    this.status = status;
    this.code = code;
  }
}

export function makeApi(baseUrl) {
  const base = baseUrl.replace(/\/+$/, "");
  return async function api(method, path, { token, body } = {}) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new ApiError(response.status, "non_json", text.slice(0, 120));
    }
    if (!response.ok || (json && "code" in json && json.code !== 0)) {
      throw new ApiError(
        response.status,
        json?.reason ?? json?.code,
        json?.message,
      );
    }
    return json && "data" in json ? json.data : json;
  };
}

export const items = (data) =>
  Array.isArray(data) ? data : (data?.items ?? []);

// RFC 6238 TOTP (SHA1, 6 digits, 30 s) — matches xy2api's authenticator setup.
function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of input.replace(/=+$/, "").toUpperCase()) {
    const idx = alphabet.indexOf(ch);
    if (idx >= 0) bits += idx.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8)
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function totp(secret, at = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const hmac = createHmac("sha1", base32Decode(secret))
    .update(counter)
    .digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, "0");
}

export async function login(api, email, password, totpSecret) {
  const data = await api("POST", "/api/v1/auth/login", {
    body: { email, password },
  });
  if (data.access_token) return data.access_token;
  if (data.requires_2fa && data.temp_token && totpSecret) {
    const second = await api("POST", "/api/v1/auth/login/2fa", {
      body: { temp_token: data.temp_token, totp_code: totp(totpSecret) },
    });
    return second.access_token;
  }
  throw new Error(`login for ${email} needs 2FA but no secret is known`);
}

// Minimal solid-colour PNG (used as an edit/reference input in recordings).
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  let c = 0xffffffff;
  for (const byte of td) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE((c ^ 0xffffffff) >>> 0);
  return Buffer.concat([len, td, crc]);
}

export function solidPng(width, height, [r, g, b] = [40, 80, 160]) {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) raw.set([r, g, b], y * stride + 1 + x * 3);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

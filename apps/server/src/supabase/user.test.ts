import { SignJWT } from "jose";
import { describe, expect, it, vi } from "vitest";
import {
  type UserSupabaseClient,
  createSupabaseRequestAuthenticator,
} from "./user.js";
const secret = "synthetic-test-secret-32-characters-long";
const issuer = "https://db.example.com/auth/v1";
const env = {
  supabaseUrl: "https://db.example.com",
  supabaseJwtSecret: secret,
};
async function jwt(values: Record<string, unknown> = {}, signingKey = secret) {
  return new SignJWT({
    email: "user@example.com",
    role: "authenticated",
    ...values,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("user-1")
    .setAudience("authenticated")
    .setIssuer(issuer)
    .setIssuedAt(1000)
    .setExpirationTime(1010)
    .sign(new TextEncoder().encode(signingKey));
}
const request = (token: string) => ({
  headers: { authorization: `Bearer ${token}` },
});
describe("Supabase trust boundaries", () => {
  it("never accepts a cached token after expiration", async () => {
    let now = 1001000;
    const auth = createSupabaseRequestAuthenticator(env, { now: () => now });
    const token = await jwt();
    expect(await auth.authenticate(request(token))).toMatchObject({
      id: "user-1",
    });
    now = 1010000;
    expect(await auth.authenticate(request(token))).toBeNull();
  });
  it("isolates signing keys across authenticators", async () => {
    const a = createSupabaseRequestAuthenticator(env, { now: () => 1001000 });
    const b = createSupabaseRequestAuthenticator(
      { ...env, supabaseJwtSecret: "different-signing-secret" },
      { now: () => 1001000 },
    );
    const token = await jwt();
    expect(await a.authenticate(request(token))).not.toBeNull();
    expect(await b.authenticate(request(token))).toBeNull();
    expect(await a.authenticate(request(token))).not.toBeNull();
  });
  it("rejects wrong issuer, service role and malformed authorization", async () => {
    const auth = createSupabaseRequestAuthenticator(
      { ...env, supabaseJwtIssuer: "https://another.example.com/auth/v1" },
      { now: () => 1001000 },
    );
    expect(await auth.authenticate(request(await jwt()))).toBeNull();
    const local = createSupabaseRequestAuthenticator(env, {
      now: () => 1001000,
    });
    expect(
      await local.authenticate(request(await jwt({ role: "service_role" }))),
    ).toBeNull();
    expect(
      await local.authenticate(request(`${await jwt()} extra`)),
    ).toBeNull();
  });
  it("bounds remote cache by JWT expiry and handles remote errors safely", async () => {
    let now = 1001000;
    const getUser = vi.fn().mockResolvedValue({
      data: { user: { id: "u", email: "u@example.com" } },
      error: null,
    });
    const auth = createSupabaseRequestAuthenticator(
      { supabaseUrl: env.supabaseUrl },
      {
        now: () => now,
        createUserClient: () =>
          ({ auth: { getUser } }) as unknown as UserSupabaseClient,
      },
    );
    const token = await jwt();
    await auth.authenticate(request(token));
    await auth.authenticate(request(token));
    expect(getUser).toHaveBeenCalledTimes(1);
    now = 1010000;
    expect(await auth.authenticate(request(token))).toBeNull();
    expect(getUser).toHaveBeenCalledTimes(1);
  });
});

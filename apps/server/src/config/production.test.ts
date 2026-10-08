import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadServerEnv } from "./env.js";
import { validateProductionEnv } from "./production.js";
const source = {
  XY2API_BASE_URL: "https://gguuai.com",
  LOOMIC_SECRET_KEY: randomBytes(32).toString("base64"),
  SSO_EMAIL_DOMAIN: "sso.example.com",
  LOOMIC_WEB_ORIGIN: "https://image.example.com",
  SUPABASE_URL: "https://db.example.com",
  SUPABASE_INTERNAL_URL: "http://api-gw:8000",
  SUPABASE_DB_URL: "postgresql://postgres:synthetic@db:5432/postgres",
  SUPABASE_ANON_KEY: "synthetic-anon",
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-service",
};
describe("selfhost production configuration", () => {
  it("accepts internal HTTP with public HTTPS", () =>
    expect(() =>
      validateProductionEnv(loadServerEnv({}, source), "production"),
    ).not.toThrow());
  it.each([
    "SUPABASE_URL",
    "SUPABASE_DB_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_ANON_KEY",
  ])("requires %s before listening", (key) =>
    expect(() =>
      validateProductionEnv(
        loadServerEnv({}, { ...source, [key]: "" }),
        "production",
      ),
    ).toThrow(key),
  );
  it("rejects insecure public URLs and malformed internal endpoints without leaking them", () => {
    expect(() =>
      validateProductionEnv(
        loadServerEnv({}, { ...source, SUPABASE_URL: "http://db.example.com" }),
        "production",
      ),
    ).toThrow("Invalid SUPABASE_URL");
    expect(() =>
      validateProductionEnv(
        loadServerEnv(
          {},
          {
            ...source,
            SUPABASE_INTERNAL_URL: "http://admin:secret@api-gw:8000",
          },
        ),
        "production",
      ),
    ).toThrow("Invalid SUPABASE_INTERNAL_URL");
  });
});

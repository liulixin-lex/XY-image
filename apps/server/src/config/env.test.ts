import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadServerEnv } from "./env.js";

const source = {
  XY2API_BASE_URL: "https://api.example.com",
  LOOMIC_SECRET_KEY: randomBytes(32).toString("base64"),
  SSO_EMAIL_DOMAIN: "sso.example.com",
};
describe("integration startup configuration", () => {
  it.each(["XY2API_BASE_URL", "LOOMIC_SECRET_KEY", "SSO_EMAIL_DOMAIN"])(
    "requires %s without printing values",
    (name) => {
      expect(() => loadServerEnv({}, { ...source, [name]: "" })).toThrow(name);
    },
  );
  it("rejects a wrong secret length and unsafe filesystem execution", () => {
    expect(() =>
      loadServerEnv(
        {},
        { ...source, LOOMIC_SECRET_KEY: "synthetic-sensitive-value" },
      ),
    ).toThrow("Missing or invalid LOOMIC_SECRET_KEY");
    expect(() =>
      loadServerEnv({}, { ...source, LOOMIC_AGENT_BACKEND_MODE: "filesystem" }),
    ).toThrow("LOOMIC_AGENT_BACKEND_MODE");
  });
  it("does not load legacy provider secrets", () => {
    const env = loadServerEnv(
      {},
      {
        ...source,
        OPENAI_API_KEY: "synthetic-sensitive-value",
        GOOGLE_API_KEY: "synthetic-sensitive-value",
      },
    );
    expect(JSON.stringify(env)).not.toContain("synthetic-sensitive-value");
    expect(env.chatModels[0]).toBe("gpt-5.4");
  });
});

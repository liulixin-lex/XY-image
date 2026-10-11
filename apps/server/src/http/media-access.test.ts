import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MEDIA_COOKIE, mintMediaToken } from "../features/media/media-access.js";
import { registerMediaAccessRoutes } from "./media-access.js";

const SECRET = "synthetic-secret-for-media-tests";
const USER = "11111111-2222-4333-8444-555555555555";
const WS = "62bcdca6-40f1-4100-ab63-14fca67032dd";
const OBJECT = `/storage/v1/object/public/project-assets/${WS}/generated/a.png`;

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

function fixture(mediaAccess: "cookie" | "open" = "cookie") {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const app = Fastify();
  registerMediaAccessRoutes(app, {
    env: { mediaAccess, secretKey: SECRET },
    auth: {
      authenticate: async (request) =>
        request.headers.authorization === "Bearer good"
          ? { id: USER, accessToken: "good", email: "", userMetadata: {} }
          : null,
    },
    isMember: async (user, ws) => user === USER && ws === WS,
  });
  apps.push(app);
  return app;
}
const cookies = (header: string | string[] | undefined) =>
  ([] as string[]).concat(header ?? []);

describe("media session", () => {
  it("trades a signed-in session for an HttpOnly cookie and clears it", async () => {
    const app = fixture();
    const refused = await app.inject({ method: "POST", url: "/api/media/session" });
    expect(refused.statusCode).toBe(401);
    const res = await app.inject({
      method: "POST",
      url: "/api/media/session",
      headers: { authorization: "Bearer good", "x-forwarded-proto": "https" },
    });
    expect(res.statusCode).toBe(204);
    const [media, expiry] = cookies(res.headers["set-cookie"]);
    expect(media).toMatch(new RegExp(`^${MEDIA_COOKIE}=v1\\.${USER}\\.`));
    expect(media).toContain("HttpOnly");
    expect(media).toContain("Secure");
    expect(media).toContain("SameSite=Lax");
    expect(expiry).toMatch(/^xy_media_exp=\d+;/);
    expect(expiry).not.toContain("HttpOnly");
    const cleared = await app.inject({ method: "DELETE", url: "/api/media/session" });
    expect(cookies(cleared.headers["set-cookie"])[0]).toContain("Max-Age=0");
  });
  it("sets nothing when media access is open", async () => {
    const app = fixture("open");
    const res = await app.inject({ method: "POST", url: "/api/media/session" });
    expect(res.statusCode).toBe(204);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });
});

describe("media authorize (edge subrequest)", () => {
  const ask = (app: ReturnType<typeof fixture>, headers: Record<string, string>) =>
    app.inject({ method: "GET", url: "/api/media/authorize", headers });
  const cookie = `${MEDIA_COOKIE}=${mintMediaToken(SECRET, USER).token}`;

  it("allows a member, from Caddy's or nginx's header", async () => {
    const app = fixture();
    expect((await ask(app, { "x-forwarded-uri": `/supabase${OBJECT}`, cookie })).statusCode).toBe(204);
    expect((await ask(app, { "x-original-uri": `/supabase${OBJECT}`, cookie })).statusCode).toBe(204);
  });
  it("refuses a leaked link opened without the cookie", async () => {
    const app = fixture();
    expect((await ask(app, { "x-forwarded-uri": OBJECT })).statusCode).toBe(401);
    expect(
      (await ask(app, { "x-forwarded-uri": OBJECT.replace(WS, "69aba91c-13e4-4b93-8134-4cfcd97a1d30"), cookie })).statusCode,
    ).toBe(403);
    expect((await ask(app, { cookie })).statusCode).toBe(403);
  });
  it("lets everything through when media access is open", async () => {
    expect((await ask(fixture("open"), { "x-forwarded-uri": OBJECT })).statusCode).toBe(204);
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  MEDIA_COOKIE,
  authorizeMedia,
  createMemberCheck,
  mediaWorkspace,
  mintMediaToken,
  readCookie,
  verifyMediaToken,
} from "./media-access.js";

const SECRET = "synthetic-secret-for-media-tests";
const USER = "11111111-2222-4333-8444-555555555555";
const WS = "62bcdca6-40f1-4100-ab63-14fca67032dd";
const OTHER_WS = "69aba91c-13e4-4b93-8134-4cfcd97a1d30";
const image = (ws: string, rest = "generated/0b6c4a5e-1111-4222-8333-444455556666.png") =>
  `/storage/v1/object/public/project-assets/${ws}/${rest}`;

describe("media token", () => {
  it("round-trips and expires", () => {
    const now = Date.UTC(2026, 9, 11);
    const { token, expiresAt } = mintMediaToken(SECRET, USER, now);
    expect(verifyMediaToken(SECRET, token, now)).toBe(USER);
    expect(verifyMediaToken(SECRET, token, expiresAt * 1000)).toBeNull();
    expect(verifyMediaToken("another-secret", token, now)).toBeNull();
  });
  it("refuses a token edited to another user or a later expiry", () => {
    const { token } = mintMediaToken(SECRET, USER);
    const [v, , exp, mac] = token.split(".");
    expect(
      verifyMediaToken(SECRET, [v, "99999999-2222-4333-8444-555555555555", exp, mac].join(".")),
    ).toBeNull();
    expect(
      verifyMediaToken(SECRET, [v, USER, String(Number(exp) + 3600), mac].join(".")),
    ).toBeNull();
    expect(verifyMediaToken(SECRET, "v1.x.y")).toBeNull();
  });
});

describe("mediaWorkspace", () => {
  it("reads the workspace of a project-assets object", () => {
    expect(mediaWorkspace(image(WS))).toBe(WS);
    expect(mediaWorkspace(`/supabase${image(WS)}?download=a.png`)).toBe(WS);
    expect(mediaWorkspace(image(WS, "1791730023018-%E5%9B%BE.jpg"))).toBe(WS);
  });
  it("refuses paths that are not one object of one workspace", () => {
    expect(mediaWorkspace(image(WS, `..%2F${OTHER_WS}/a.png`))).toBeNull();
    expect(mediaWorkspace(image(WS, `../${OTHER_WS}/a.png`))).toBeNull();
    expect(mediaWorkspace(image(WS, "a%5Cb.png"))).toBeNull();
    expect(mediaWorkspace(image(WS, ""))).toBeNull();
    expect(mediaWorkspace(`/storage/v1/object/public/project-assets/${WS}`)).toBeNull();
    expect(mediaWorkspace("/storage/v1/object/public/project-assets/not-a-uuid/a.png")).toBeNull();
    expect(mediaWorkspace(`/storage/v1/object/public/brand-kit-assets/${WS}/a.png`)).toBeNull();
    expect(mediaWorkspace(image(WS, "a%ZZ.png"))).toBeNull();
  });
});

describe("authorizeMedia", () => {
  const isMember = async (user: string, ws: string) => user === USER && ws === WS;
  const cookieFor = (user = USER) =>
    `theme=dark; ${MEDIA_COOKIE}=${mintMediaToken(SECRET, user).token}`;

  it("lets a member read their workspace's images", async () => {
    await expect(
      authorizeMedia({ uri: image(WS), cookieHeader: cookieFor(), secret: SECRET, isMember }),
    ).resolves.toMatchObject({ allowed: true, userId: USER, workspaceId: WS });
  });
  it("refuses without a cookie, with a bad one, and outside the workspace", async () => {
    const base = { secret: SECRET, isMember };
    await expect(
      authorizeMedia({ ...base, uri: image(WS), cookieHeader: undefined }),
    ).resolves.toMatchObject({ allowed: false, status: 401, reason: "no_cookie" });
    await expect(
      authorizeMedia({ ...base, uri: image(WS), cookieHeader: `${MEDIA_COOKIE}=v1.a.b.c` }),
    ).resolves.toMatchObject({ allowed: false, status: 401, reason: "bad_cookie" });
    await expect(
      authorizeMedia({ ...base, uri: image(OTHER_WS), cookieHeader: cookieFor() }),
    ).resolves.toMatchObject({ allowed: false, status: 403, reason: "not_member" });
    await expect(
      authorizeMedia({ ...base, uri: "/storage/v1/object/public/canvases/x.png", cookieHeader: cookieFor() }),
    ).resolves.toMatchObject({ allowed: false, status: 403, reason: "bad_path" });
  });
});

describe("createMemberCheck", () => {
  function admin(rows: Array<{ workspace_id: string }>) {
    const select = vi.fn();
    const client = {
      from: () => ({
        select: () => ({
          eq: async () => {
            select();
            return { data: rows, error: null };
          },
        }),
      }),
    };
    return { client: client as never, select, rows };
  }
  it("caches membership per user and reloads once for a new workspace", async () => {
    const db = admin([{ workspace_id: WS }]);
    const check = createMemberCheck(() => db.client, { ttlMs: 60_000, recheckAfterMs: 0 });
    expect(await check(USER, WS)).toBe(true);
    expect(await check(USER, WS)).toBe(true);
    expect(db.select).toHaveBeenCalledTimes(1);
    db.rows.push({ workspace_id: OTHER_WS });
    expect(await check(USER, OTHER_WS)).toBe(true);
    expect(db.select).toHaveBeenCalledTimes(2);
  });
  it("reads a fresh entry from cache even when the answer is no", async () => {
    const db = admin([{ workspace_id: WS }]);
    const check = createMemberCheck(() => db.client, { recheckAfterMs: 60_000 });
    expect(await check(USER, OTHER_WS)).toBe(false);
    expect(await check(USER, OTHER_WS)).toBe(false);
    expect(db.select).toHaveBeenCalledTimes(1);
  });
});

describe("readCookie", () => {
  it("finds one cookie among several", () => {
    expect(readCookie("a=1; xy_media=v1.x; b=2", "xy_media")).toBe("v1.x");
    expect(readCookie("xy_media_exp=5", "xy_media")).toBeUndefined();
    expect(readCookie(undefined, "xy_media")).toBeUndefined();
  });
});

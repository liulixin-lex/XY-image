import { createHmac, timingSafeEqual } from "node:crypto";
import type { AdminSupabaseClient } from "../../supabase/admin.js";

/**
 * Who may read a generated or uploaded image (FINDINGS S2).
 *
 * project-assets is a public Storage bucket and its URLs are stored in
 * canvases, chat history and job results, so they stay as they are. What
 * changes is who the edge lets through: with LOOMIC_MEDIA_ACCESS=cookie,
 * Caddy (forward_auth) / nginx (auth_request) ask GET /api/media/authorize
 * before serving `/storage/v1/object/public/project-assets/<workspace>/…`,
 * and only a member of <workspace> holding a valid media cookie gets it.
 * A link that leaks (forwarded, pasted by the assistant, in a browser
 * history) no longer opens for anyone else, and signing out revokes it.
 *
 * The browser cannot send the Supabase access token with an <img>, so the
 * page trades it for an HttpOnly cookie (POST /api/media/session) that
 * <img>, canvas fetches and downloads carry by themselves. The server reads
 * images through the internal Supabase URL, never through the edge, so
 * workers and the assistant are not affected.
 *
 * TODO: a private bucket with short signed URLs would also cover a copy of
 * the cookie; it needs every stored URL re-signed on read.
 */
export const MEDIA_COOKIE = "xy_media";
/** Readable by the page: the expiry only, so it knows when to renew. */
export const MEDIA_EXPIRY_COOKIE = "xy_media_exp";
export const MEDIA_TOKEN_TTL_S = 24 * 60 * 60;

const PUBLIC_PREFIX = "/object/public/project-assets/";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function macKey(secret: string): Buffer {
  // Domain-separated from the secret box, which uses the same secret.
  return createHmac("sha256", secret).update("xy-media-cookie:v1").digest();
}

function mac(secret: string, body: string): string {
  return createHmac("sha256", macKey(secret)).update(body).digest("base64url");
}

/** `v1.<user>.<expiry seconds>.<hmac>` */
export function mintMediaToken(
  secret: string,
  userId: string,
  now = Date.now(),
): { token: string; expiresAt: number } {
  if (!UUID.test(userId)) throw new Error("media token needs a user id");
  const expiresAt = Math.floor(now / 1000) + MEDIA_TOKEN_TTL_S;
  const body = `v1.${userId}.${expiresAt}`;
  return { token: `${body}.${mac(secret, body)}`, expiresAt };
}

/** The user the token was minted for, or null when forged or expired. */
export function verifyMediaToken(
  secret: string,
  token: string,
  now = Date.now(),
): string | null {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  const [, userId, expiry, signature] = parts as [string, string, string, string];
  if (!UUID.test(userId) || !/^\d{1,12}$/.test(expiry)) return null;
  if (Number(expiry) * 1000 <= now) return null;
  const expected = Buffer.from(mac(secret, `v1.${userId}.${expiry}`));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    return null;
  return userId;
}

export function readCookie(
  header: string | undefined,
  name: string,
): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name)
      return part.slice(at + 1).trim();
  }
  return undefined;
}

/**
 * The workspace of a project-assets public object URI, or null when the URI
 * is not one or tries to leave its folder (`..`, encoded slashes).
 */
export function mediaWorkspace(uri: string): string | null {
  const path = uri.split(/[?#]/, 1)[0] ?? "";
  const at = path.indexOf(PUBLIC_PREFIX);
  if (at < 0) return null;
  const segments = path.slice(at + PUBLIC_PREFIX.length).split("/");
  if (segments.length < 2) return null;
  for (const raw of segments) {
    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (!segment || segment === "." || segment === "..") return null;
    if (/[/\\]/.test(segment)) return null;
  }
  const workspace = segments[0] ?? "";
  return UUID.test(workspace) ? workspace.toLowerCase() : null;
}

export type MemberCheck = (
  userId: string,
  workspaceId: string,
) => Promise<boolean>;

/**
 * Workspace membership, cached per user for `ttlMs`: every image on a page
 * asks, and membership changes rarely. A miss on a stale-ish entry reloads
 * once, so a user who just joined a team is not refused for a minute.
 */
export function createMemberCheck(
  getAdmin: () => AdminSupabaseClient,
  { ttlMs = 60_000, recheckAfterMs = 5_000, maxUsers = 5_000 } = {},
): MemberCheck {
  const cache = new Map<string, { at: number; workspaces: Set<string> }>();
  async function load(userId: string) {
    const { data, error } = await getAdmin()
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", userId);
    if (error) throw new Error(`workspace_members read failed: ${error.message}`);
    const entry = {
      at: Date.now(),
      workspaces: new Set(
        (data ?? []).map((row) => String(row.workspace_id).toLowerCase()),
      ),
    };
    if (cache.size >= maxUsers) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
    cache.set(userId, entry);
    return entry;
  }
  return async (userId, workspaceId) => {
    let entry = cache.get(userId);
    const age = entry ? Date.now() - entry.at : Infinity;
    if (!entry || age > ttlMs) entry = await load(userId);
    else if (!entry.workspaces.has(workspaceId) && age >= recheckAfterMs)
      entry = await load(userId);
    return entry.workspaces.has(workspaceId);
  };
}

export type MediaDecision =
  | { allowed: true; userId: string; workspaceId: string }
  | { allowed: false; status: 401 | 403; reason: string };

export async function authorizeMedia(input: {
  uri: string;
  cookieHeader: string | undefined;
  secret: string;
  isMember: MemberCheck;
  now?: number;
}): Promise<MediaDecision> {
  const workspaceId = mediaWorkspace(input.uri);
  if (!workspaceId) return { allowed: false, status: 403, reason: "bad_path" };
  const token = readCookie(input.cookieHeader, MEDIA_COOKIE);
  if (!token) return { allowed: false, status: 401, reason: "no_cookie" };
  const userId = verifyMediaToken(input.secret, token, input.now);
  if (!userId) return { allowed: false, status: 401, reason: "bad_cookie" };
  if (!(await input.isMember(userId, workspaceId)))
    return { allowed: false, status: 403, reason: "not_member" };
  return { allowed: true, userId, workspaceId };
}

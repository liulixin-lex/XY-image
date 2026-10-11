import { getServerBaseUrl } from "./env";

/**
 * The media cookie lets <img>, canvas fetches and downloads read this
 * workspace's images once the edge checks who is asking (server:
 * features/media/media-access.ts, FINDINGS S2). The page trades its access
 * token for it on sign-in and token refresh, and drops it on sign-out.
 *
 * `xy_media_exp` (set next to the HttpOnly cookie) holds only the expiry,
 * so the page knows whether it must wait for a new one before showing
 * images. A server with media access open sets neither; the page then asks
 * once per session change, which is cheap.
 */
const EXPIRY_COOKIE = "xy_media_exp";
/** Renew when less than this is left; the cookie lasts 24 h. */
const RENEW_BEFORE_MS = 12 * 60 * 60 * 1000;
const TIMEOUT_MS = 4000;

let inFlight: { token: string; promise: Promise<void> } | null = null;

function cookieExpiry(): number | null {
  const match = document.cookie.match(/(?:^|;\s*)xy_media_exp=(\d+)/);
  return match ? Number(match[1]) * 1000 : null;
}

/** True while the current cookie is good for a while yet. */
export function hasFreshMediaCookie(now = Date.now()): boolean {
  const expiry = cookieExpiry();
  return expiry !== null && expiry - now > RENEW_BEFORE_MS;
}

/**
 * Makes sure this browser holds a media cookie for `accessToken`'s user.
 * Never throws: a failure only means images may not load until the next try.
 */
export function ensureMediaSession(
  accessToken: string,
  { force = false } = {},
): Promise<void> {
  if (!force && hasFreshMediaCookie()) return Promise.resolve();
  if (inFlight?.token === accessToken) return inFlight.promise;
  const promise = (async () => {
    try {
      const response = await fetch(`${getServerBaseUrl()}/api/media/session`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok && response.status !== 204)
        console.warn(`[media] session refused: ${response.status}`);
    } catch (error) {
      console.warn("[media] session request failed; images may not load", error);
    } finally {
      inFlight = null;
    }
  })();
  inFlight = { token: accessToken, promise };
  return promise;
}

/** Sign-out: the server clears the cookies (best effort, never throws). */
export async function clearMediaSession(): Promise<void> {
  if (typeof document !== "undefined")
    document.cookie = `${EXPIRY_COOKIE}=; Max-Age=0; Path=/`;
  try {
    await fetch(`${getServerBaseUrl()}/api/media/session`, {
      method: "DELETE",
      keepalive: true,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    console.warn("[media] clearing the media cookie failed", error);
  }
}

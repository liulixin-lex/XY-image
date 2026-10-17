/**
 * A picture's bytes from its URL, without a network request when the
 * picture is already in the page. Canvas pictures not yet stored are data:
 * URLs; `fetch()` of one is a request as far as the Content-Security-Policy
 * goes, and the site's `connect-src 'self'` (report-only so far, FINDINGS
 * W2; /etc/caddy/xy-image2.caddy) does not allow data:. Production reported
 * exactly that on /canvas; once the policy is enforced, those fetches fail:
 * a generator's reference from an unsaved picture and the picture downloads
 * would break. Decoding here needs no policy change.
 *
 * blob: URLs are not handled: no caller passes one (previews of attachments
 * are never downloaded). If one ever does, keep the Blob instead of its URL.
 */

const DATA_URL = /^data:([^,]*?),([\s\S]*)$/;

/** Decodes a data: URL. Throws on anything else. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const match = DATA_URL.exec(dataUrl);
  if (!match) throw new Error("not a data: URL");
  const meta = match[1] ?? "";
  const payload = match[2] ?? "";
  const params = meta.split(";");
  const base64 = params.at(-1)?.toLowerCase() === "base64";
  const type =
    (base64 ? params.slice(0, -1) : params).join(";") ||
    "text/plain;charset=US-ASCII";
  if (!base64) return new Blob([decodeURIComponent(payload)], { type });
  const binary = atob(payload.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

/**
 * The bytes behind an image URL: decoded locally for data:, fetched
 * otherwise (stored pictures are same-origin under /supabase/storage).
 */
export async function readImageBlob(
  url: string,
  init?: RequestInit,
): Promise<Blob> {
  if (url.startsWith("data:")) return dataUrlToBlob(url);
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.blob();
}

import { readImageBlob } from "./image-blob";

/**
 * Download a cross-origin image (Supabase Storage) with a proper file name.
 * `<a download>` is ignored cross-origin, so fetch it as a blob first; fall
 * back to opening the URL when CORS or memory prevents that. A canvas
 * picture not yet stored is a data: URL, decoded without a request
 * (lib/image-blob.ts).
 */
export async function downloadImage(url: string, filename: string) {
  try {
    const blob = await readImageBlob(url, { mode: "cors" });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
  } catch (error) {
    console.warn("[download] blob download failed, opening instead", error);
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

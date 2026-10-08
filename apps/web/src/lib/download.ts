/**
 * Download a cross-origin image (Supabase Storage) with a proper file name.
 * `<a download>` is ignored cross-origin, so fetch it as a blob first; fall
 * back to opening the URL when CORS or memory prevents that.
 */
export async function downloadImage(url: string, filename: string) {
  try {
    const response = await fetch(url, { mode: "cors" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
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

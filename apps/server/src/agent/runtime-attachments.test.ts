import { describe, expect, it } from "vitest";
import { buildAttachmentRefMap } from "./runtime.js";

describe("buildAttachmentRefMap", () => {
  it("keeps the Storage URL for the job and inlines only inline attachments", () => {
    const url =
      "https://site.example.test/supabase/storage/v1/object/public/project-assets/u/poster.png";
    const map = buildAttachmentRefMap([
      { assetId: "el-1", url, mimeType: "image/png", base64: "iVBORw0K" },
      {
        assetId: "el-2",
        url: "data:image/png;base64,iVBORw0K",
        mimeType: "image/png",
        base64: "iVBORw0K",
      },
    ]);
    // The worker fetches the URL when the job runs; the payload stays small.
    expect(map["el-1"]).toBe(url);
    expect(map["el-2"]).toBe("data:image/png;base64,iVBORw0K");
  });
});

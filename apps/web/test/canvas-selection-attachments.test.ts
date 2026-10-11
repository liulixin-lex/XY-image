import { describe, expect, it } from "vitest";

import { canvasSelectionAttachments } from "../src/hooks/use-image-attachments";

const url = "https://site.example.test/supabase/storage/v1/object/public/project-assets/u/poster.png";

describe("canvasSelectionAttachments", () => {
  it("names each selected image by its canvas caption, in Chinese otherwise", () => {
    const attachments = canvasSelectionAttachments(
      [
        { id: "a", type: "image", fileId: "f1", storageUrl: url, title: "清爽日系精品咖啡店开业海报" },
        { id: "b", type: "image", fileId: "f2", dataUrl: "data:image/png;base64,iVBORw0K" },
        { id: "c", type: "text" },
        { id: "d", type: "image", fileId: "f4" },
      ],
      new Set(),
    );
    expect(attachments).toEqual([
      { assetId: "a", url, mimeType: "image/png", source: "canvas-ref", name: "清爽日系精品咖啡店开业海报" },
      {
        assetId: "b",
        url: "data:image/png;base64,iVBORw0K",
        mimeType: "image/png",
        source: "canvas-ref",
        name: "画布图片 2",
      },
    ]);
  });

  it("skips images that are already attached", () => {
    expect(
      canvasSelectionAttachments([{ id: "a", type: "image", fileId: "f1", storageUrl: url }], new Set(["a"])),
    ).toEqual([]);
  });
});

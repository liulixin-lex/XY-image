import { describe, expect, it } from "vitest";

import { mergeLatest } from "../src/hooks/use-studio-jobs";
import type { ImageJobView } from "../src/lib/image-jobs";
import {
  defaultModel,
  findModel,
  imageModelOptions,
  modelLabel,
  modelRef,
  modelRequest,
  parseModelRef,
  spansSeveralKeys,
} from "../src/lib/image-model-ref";
import type { ImageModelInfo } from "../src/lib/server-api";

const model = (id: string, keyId: number | undefined, keyName = `K${keyId}`) =>
  ({
    id,
    displayName: id.toUpperCase(),
    description: "d",
    keyId,
    keyName,
    groupName: "g",
  }) as ImageModelInfo;

const models = [model("gpt-image-2", 3, "主力"), model("nano", 3, "主力"), model("gpt-image-2", 9, "备用")];

describe("image models across keys (第 56 条)", () => {
  it("refs name a model on a key; older servers have none", () => {
    expect(modelRef(models[2] as ImageModelInfo)).toBe("9:gpt-image-2");
    expect(modelRef(model("x", undefined))).toBe(":x");
    expect(parseModelRef("9:gpt-image-2")).toEqual({ id: "gpt-image-2", keyId: 9 });
    expect(parseModelRef(":x")).toEqual({ id: "x", keyId: null });
    expect(parseModelRef("bare")).toEqual({ id: "bare", keyId: null });
  });

  it("finds the model on its key, else the same model on another key", () => {
    expect(findModel(models, "9:gpt-image-2")?.keyId).toBe(9);
    expect(findModel(models, "44:gpt-image-2")?.keyId).toBe(3);
    expect(findModel(models, { id: "nano", keyId: 9 })?.keyId).toBe(3);
    expect(findModel(models, "3:missing")).toBeNull();
  });

  it("the default: saved model on the default key, else anywhere, else the first", () => {
    expect(defaultModel(models, { image_key_id: 9, default_image_model: "gpt-image-2" })?.keyId).toBe(9);
    expect(defaultModel(models, { image_key_id: 9, default_image_model: "nano" })?.keyId).toBe(3);
    expect(defaultModel(models, null)).toBe(models[0]);
  });

  it("labels twins with their key and groups the picker by key", () => {
    expect(spansSeveralKeys(models)).toBe(true);
    expect(modelLabel(models[0] as ImageModelInfo, models)).toBe("GPT-IMAGE-2（主力）");
    expect(modelLabel(models[1] as ImageModelInfo, models)).toBe("NANO");
    const options = imageModelOptions(models, { unavailable: (m) => (m.id === "nano" ? "不支持参考图" : null) });
    expect(options.map((o) => o.group?.key)).toEqual(["3", "3", "9"]);
    expect(options[1]).toMatchObject({ disabled: true, description: "不支持参考图" });
    expect(imageModelOptions([models[0] as ImageModelInfo])[0]?.group).toBeUndefined();
  });

  it("requests carry the key when known", () => {
    expect(modelRequest(models[2] as ImageModelInfo)).toEqual({ model: "gpt-image-2", key_id: 9 });
    expect(modelRequest(model("x", undefined))).toEqual({ model: "x" });
  });
});

describe("studio pages", () => {
  const job = (id: string, createdAt: string) => ({ id, createdAt }) as ImageJobView;

  it("keeps pictures that slid off the latest page, drops ones gone from inside it", () => {
    const prev = [job("gone", "2026-10-12T03:30:00Z"), job("c", "2026-10-12T03:00:00Z"), job("b", "2026-10-12T02:00:00Z"), job("a", "2026-10-12T01:00:00Z")];
    const fresh = [job("d", "2026-10-12T04:00:00Z"), job("c", "2026-10-12T03:00:00Z")];
    expect(mergeLatest(fresh, prev, true).map((j) => j.id)).toEqual(["d", "c", "b", "a"]);
    // Not a full page: everything there is, is in it.
    expect(mergeLatest(fresh, prev, false).map((j) => j.id)).toEqual(["d", "c"]);
  });
});

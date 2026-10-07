import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSecretBox } from "./secret-box.js";

describe("secret box", () => {
  const box = createSecretBox(randomBytes(32).toString("base64"));
  it("round trips with fresh IVs", () => {
    const sealed = box.sealSecret("synthetic credential 中文");
    expect(box.openSecret(sealed)).toBe("synthetic credential 中文");
    expect(box.sealSecret("synthetic credential 中文")).not.toBe(sealed);
  });
  it.each([0, 1, 2, 3])("rejects tampering with segment %i", (index) => {
    const parts = box.sealSecret("synthetic credential").split(".");
    const original = parts[index] ?? "";
    const replacement = original.startsWith("x") ? "y" : "x";
    parts[index] = `${replacement}${original.slice(1)}`;
    expect(parts[index]).not.toBe(original);
    expect(() => box.openSecret(parts.join("."))).toThrow();
  });
  it("rejects a different key", () => {
    const other = createSecretBox(randomBytes(32).toString("base64"));
    expect(() => other.openSecret(box.sealSecret("synthetic"))).toThrow();
  });
});

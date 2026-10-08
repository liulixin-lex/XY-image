import { describe, expect, it } from "vitest";

import {
  buildCreateBody,
  buildEditPlan,
  formErrorFor,
  initialFormValues,
  normalizeBaseUrl,
  parseModelList,
  validateProviderForm,
} from "../src/lib/chat-provider-form";
import type { ChatProvider } from "../src/lib/chat-providers-api";

const saved: ChatProvider = {
  id: "p-1",
  name: "我的服务商",
  protocol: "openai_compatible",
  baseUrl: "https://api.example.com/v1",
  keyHint: "3f9a",
  models: ["model-a", "model-b"],
  modelsSource: "fetched",
  enabled: true,
  lastCheckedAt: null,
  lastError: null,
};

describe("normalizeBaseUrl", () => {
  it("keeps https and drops trailing slashes", () => {
    expect(normalizeBaseUrl("  https://api.example.com/v1//  ")).toEqual({
      url: "https://api.example.com/v1",
    });
    expect(normalizeBaseUrl("https://api.example.com/")).toEqual({ url: "https://api.example.com" });
  });

  it("refuses a query string, which would break every request URL built on it", () => {
    expect(normalizeBaseUrl("https://api.example.com/v1?api-version=1")).toEqual({
      error: "地址里不要带 ? 后面的参数",
    });
  });

  it("refuses http, credentials, fragments and junk", () => {
    expect(normalizeBaseUrl("http://api.example.com/v1")).toEqual({ error: "只支持 https 地址" });
    expect("error" in normalizeBaseUrl("https://user:pw@api.example.com")).toBe(true);
    expect("error" in normalizeBaseUrl("https://api.example.com/v1#x")).toBe(true);
    expect("error" in normalizeBaseUrl("api.example.com")).toBe(true);
    expect("error" in normalizeBaseUrl(`https://a.com/${"x".repeat(300)}`)).toBe(true);
  });
});

describe("parseModelList", () => {
  it("accepts lines and commas, trims and de-duplicates, keeps ':' and '/'", () => {
    expect(parseModelList("a\n b ,c，a\n\nvendor/model:v2")).toEqual({
      models: ["a", "b", "c", "vendor/model:v2"],
    });
  });

  it("needs 1 to 200 models", () => {
    expect("error" in parseModelList(" \n ")).toBe(true);
    const many = Array.from({ length: 201 }, (_, i) => `m${i}`).join("\n");
    expect(parseModelList(many)).toEqual({ error: "最多 200 个模型" });
  });
});

describe("validateProviderForm", () => {
  it("requires every field when adding", () => {
    const result = validateProviderForm(initialFormValues(null));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(["apiKey", "baseUrl", "name"]);
  });

  it("keeps the saved key when only the name changes", () => {
    const values = { ...initialFormValues(saved), name: "新名字" };
    const result = validateProviderForm(values, saved);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(buildEditPlan(saved, result.value)).toEqual({
        patch: { name: "新名字" },
        refreshAfter: false,
      });
    }
  });

  it("asks for the key again when the address changes, so a saved key never goes to a new host", () => {
    const values = { ...initialFormValues(saved), baseUrl: "https://other.example.com/v1" };
    const result = validateProviderForm(values, saved);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.apiKey).toContain("重新填写");
  });

  it("does not treat a trailing slash as a new address", () => {
    const values = { ...initialFormValues(saved), baseUrl: "https://api.example.com/v1/" };
    expect(validateProviderForm(values, saved).ok).toBe(true);
  });

  it("rejects keys with whitespace inside", () => {
    const values = { ...initialFormValues(null), name: "a", baseUrl: "https://a.com/v1", apiKey: "sk-1 2" };
    const result = validateProviderForm(values);
    expect(result.ok).toBe(false);
  });
});

describe("request bodies", () => {
  const form = { name: "n", baseUrl: "https://a.com/v1", apiKey: "sk-123", models: null };

  it("sends models on create only for a manual list", () => {
    expect(buildCreateBody(form)).toEqual({
      name: "n",
      protocol: "openai_compatible",
      baseUrl: "https://a.com/v1",
      apiKey: "sk-123",
    });
    expect(buildCreateBody({ ...form, models: ["m"] }).models).toEqual(["m"]);
  });

  it("sends the manual list with new credentials so a provider without a list endpoint still saves", () => {
    const manual: ChatProvider = { ...saved, modelsSource: "manual" };
    const plan = buildEditPlan(manual, {
      name: manual.name,
      baseUrl: manual.baseUrl,
      apiKey: "sk-new",
      models: manual.models,
    });
    expect(plan.patch).toEqual({ apiKey: "sk-new", models: manual.models });
  });

  it("switches a manual list back to auto with a refresh, not a PATCH", () => {
    const manual: ChatProvider = { ...saved, modelsSource: "manual" };
    expect(
      buildEditPlan(manual, { name: manual.name, baseUrl: manual.baseUrl, apiKey: "", models: null }),
    ).toEqual({ patch: null, refreshAfter: true });
  });

  it("has nothing to send when nothing changed", () => {
    expect(
      buildEditPlan(saved, { name: saved.name, baseUrl: saved.baseUrl, apiKey: "", models: null }),
    ).toEqual({ patch: null, refreshAfter: false });
  });
});

describe("formErrorFor", () => {
  it("puts provider errors on the field the user can fix", () => {
    const ctx = { editingWithoutNewKey: false };
    expect(formErrorFor("provider_auth_failed", null, ctx).field).toBe("apiKey");
    expect(formErrorFor("provider_blocked_address", null, ctx).field).toBe("baseUrl");
    expect(formErrorFor("provider_unreachable", null, ctx).field).toBe("baseUrl");
    expect(formErrorFor("provider_models_unavailable", null, ctx)).toMatchObject({
      field: "models",
      switchToManual: true,
    });
  });

  it("does not blame the empty key field when the saved key was rejected", () => {
    const mapped = formErrorFor("provider_auth_failed", null, { editingWithoutNewKey: true });
    expect(mapped.field).toBeUndefined();
    expect(mapped.message).toContain("重新填写");
  });

  it("falls back to the server's sanitised message", () => {
    expect(formErrorFor("invalid_request", "名称太长", { editingWithoutNewKey: false })).toEqual({
      message: "名称太长",
    });
  });
});

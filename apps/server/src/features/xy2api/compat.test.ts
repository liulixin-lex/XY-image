import { afterEach, describe, expect, it, vi } from "vitest";
import {
  XY2API_VERIFIED_VERSIONS,
  classifyVersion,
  compareVersions,
  createCompatProbe,
  isMaskedKey,
  reportWireDrift,
  wireDriftSnapshot,
} from "./compat.js";

afterEach(() => vi.restoreAllMocks());

describe("xy2api compat helpers", () => {
  it("orders semver-ish versions", () => {
    expect(compareVersions("0.2.5", "0.2.10")).toBe(-1);
    expect(compareVersions("v0.3.0", "0.2.99")).toBe(1);
    expect(compareVersions("0.2.5", "0.2.5")).toBe(0);
  });

  it("classifies verified, unknown and newer versions", () => {
    const verified = XY2API_VERIFIED_VERSIONS[0];
    expect(classifyVersion(verified)).toMatchObject({
      verified: true,
      ahead: false,
    });
    expect(classifyVersion(`v${verified}`)).toMatchObject({ verified: true });
    expect(classifyVersion("99.0.0")).toMatchObject({
      verified: false,
      ahead: true,
    });
    expect(classifyVersion(`${verified}-rc1`)).toMatchObject({
      verified: false,
    });
    expect(classifyVersion(undefined)).toEqual({
      version: null,
      verified: false,
      ahead: false,
    });
  });

  it("detects masked keys", () => {
    expect(isMaskedKey("sk-abcd…wxyz")).toBe(true);
    expect(isMaskedKey("sk-****************wxyz")).toBe(true);
    expect(isMaskedKey("sk-abcd...wxyz")).toBe(true);
    expect(isMaskedKey(`sk-${"a".repeat(48)}`)).toBe(false);
  });

  it("rate-limits drift logs but keeps counting", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    reportWireDrift("test.scope", "detail");
    reportWireDrift("test.scope", "detail");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(wireDriftSnapshot()["test.scope:detail"]).toBe(2);
  });

  it("probe logs once per version change", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let version: string | null = XY2API_VERIFIED_VERSIONS[0];
    const probe = createCompatProbe({ getVersion: async () => version });
    await probe.check();
    await probe.check();
    expect(info).toHaveBeenCalledTimes(1);
    version = "99.0.0";
    expect(await probe.check()).toMatchObject({ verified: false, ahead: true });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("unverified");
  });
});

import { describe, expect, it } from "vitest";
import { describeErrorForLog } from "./error-sanitizer.js";

describe("describeErrorForLog", () => {
  it("keeps the reason but drops credentials", () => {
    const line = describeErrorForLog(
      new Error(
        `connect to postgresql://postgres:${"p".repeat(64)}@db:5432/postgres failed\n` +
          `token eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2ln key sk-${"k".repeat(40)}`,
      ),
    );
    expect(line).toMatch(
      /^Error: connect to postgresql:\/\/\*\*\*@db:5432\/postgres failed/,
    );
    expect(line).not.toMatch(/p{8}|eyJ|k{8}|\n/);
  });

  it("names the invalid setting without its value", () => {
    expect(
      describeErrorForLog(new Error("Invalid XY2API_BASE_URL in production")),
    ).toBe("Error: Invalid XY2API_BASE_URL in production");
  });

  it("handles non-Error throws and caps length", () => {
    expect(describeErrorForLog("boom")).toBe("string: boom");
    expect(
      describeErrorForLog(new Error("x ".repeat(400))).length,
    ).toBeLessThanOrEqual(307);
  });
});

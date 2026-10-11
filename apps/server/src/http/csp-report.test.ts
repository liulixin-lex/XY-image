import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { parseCspReports, registerCspReportRoute } from "./csp-report.js";

describe("CSP report-only endpoint", () => {
  it("reads both report formats and keeps only origins and paths", () => {
    expect(
      parseCspReports({
        "csp-report": {
          "document-uri": "https://image.example.com/studio?token=secret",
          "effective-directive": "script-src-elem",
          "blocked-uri": "https://evil.example.net/x.js?k=secret",
        },
      }),
    ).toEqual([
      {
        directive: "script-src-elem",
        blocked: "https://evil.example.net",
        page: "/studio",
      },
    ]);
    expect(
      parseCspReports([
        {
          type: "csp-violation",
          body: {
            documentURL: "https://image.example.com/canvas?id=1",
            effectiveDirective: "img-src",
            blockedURL: "data",
          },
        },
        { nothing: true },
      ]),
    ).toEqual([{ directive: "img-src", blocked: "data", page: "/canvas" }]);
  });
  it("answers 204 to browser report content types", async () => {
    const app = Fastify();
    await registerCspReportRoute(app);
    for (const type of ["application/csp-report", "application/reports+json"]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/csp-report",
        headers: { "content-type": type },
        payload: JSON.stringify({ "csp-report": { "effective-directive": "x" } }),
      });
      expect(res.statusCode).toBe(204);
    }
    await app.close();
  });
});

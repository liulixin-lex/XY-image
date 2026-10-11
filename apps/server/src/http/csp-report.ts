import type { FastifyInstance } from "fastify";

/**
 * Receives Content-Security-Policy-Report-Only violations (FINDINGS W2). The
 * edge (Caddyfile / nginx templates) sends a full policy as Report-Only with
 * `report-uri /api/csp-report`; this logs one line per distinct violation so
 * the policy can be enforced once a week of real traffic shows nothing it
 * would break. No auth: browsers send these without credentials.
 *
 * Logged: the directive, the blocked origin (never its path or query, which
 * may carry tokens) and the page path. At most LOG_PER_MINUTE lines a minute;
 * repeats of one violation are counted, not logged.
 * TODO(agent01): switch the edge header to the enforcing
 * Content-Security-Policy once the log stays quiet.
 */
const LOG_PER_MINUTE = 30;
const MAX_BODY = 16 * 1024;

type Violation = { directive: string; blocked: string; page: string };

export function parseCspReports(body: unknown): Violation[] {
  const items = Array.isArray(body) ? body : [body];
  const out: Violation[] = [];
  for (const item of items.slice(0, 20)) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    // report-uri: {"csp-report": {...}}; Reporting API: {type, body: {...}}
    const report = (record["csp-report"] ?? record.body ?? record) as Record<
      string,
      unknown
    >;
    if (!report || typeof report !== "object") continue;
    const directive = String(
      report["effective-directive"] ??
        report.effectiveDirective ??
        report["violated-directive"] ??
        "",
    ).slice(0, 60);
    if (!directive) continue;
    out.push({
      directive,
      blocked: originOf(report["blocked-uri"] ?? report.blockedURL),
      page: pathOf(report["document-uri"] ?? report.documentURL),
    });
  }
  return out;
}

function originOf(value: unknown): string {
  const text = typeof value === "string" ? value : "";
  // Keywords such as inline, eval, data, blob come through as-is.
  if (!text.includes(":") || /^(data|blob|inline|eval)\b/.test(text))
    return text.slice(0, 20) || "?";
  try {
    return new URL(text).origin;
  } catch {
    return "?";
  }
}

function pathOf(value: unknown): string {
  try {
    return new URL(String(value)).pathname.slice(0, 80);
  } catch {
    return "?";
  }
}

export async function registerCspReportRoute(app: FastifyInstance) {
  const seen = new Map<string, number>();
  let windowStart = Date.now();
  let logged = 0;
  for (const type of ["application/csp-report", "application/reports+json"])
    app.addContentTypeParser(
      type,
      { parseAs: "string", bodyLimit: MAX_BODY },
      (_request, body, done) => {
        try {
          done(null, JSON.parse(String(body)));
        } catch {
          done(null, undefined);
        }
      },
    );
  app.post(
    "/api/csp-report",
    { bodyLimit: MAX_BODY },
    async (request, reply) => {
      const now = Date.now();
      if (now - windowStart >= 60_000) {
        windowStart = now;
        logged = 0;
        if (seen.size > 500) seen.clear();
      }
      for (const v of parseCspReports(request.body)) {
        const key = `${v.directive} ${v.blocked} ${v.page}`;
        const count = (seen.get(key) ?? 0) + 1;
        seen.set(key, count);
        if (count === 1 && logged < LOG_PER_MINUTE) {
          logged += 1;
          request.log.warn(
            { csp: v },
            `[csp] report-only violation ${v.directive} blocked=${v.blocked} page=${v.page}`,
          );
        }
      }
      return reply.code(204).send();
    },
  );
}

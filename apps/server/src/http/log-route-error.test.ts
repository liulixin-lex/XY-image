import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ProjectServiceError } from "../features/projects/project-service.js";
import { logRouteError } from "./log-route-error.js";

function fakeRequest() {
  return { log: { error: vi.fn(), warn: vi.fn() } };
}

describe("logRouteError", () => {
  it("logs an expected 4xx at warn, with status and reason and no stack", () => {
    const request = fakeRequest();
    const error = new ProjectServiceError(
      "project_not_found",
      "Project not found.",
      404,
    );
    logRouteError(
      request as never,
      error,
      { projectId: "p-1" },
      "thumbnail upload error",
    );
    expect(request.log.error).not.toHaveBeenCalled();
    expect(request.log.warn).toHaveBeenCalledWith(
      { projectId: "p-1", status: 404, reason: "Project not found." },
      "thumbnail upload error",
    );
  });

  it("logs invalid input at warn without echoing it", () => {
    const request = fakeRequest();
    const parsed = z.object({ role: z.enum(["user"]) }).safeParse({
      role: "secret-looking-value",
    });
    if (parsed.success) throw new Error("expected a validation error");
    logRouteError(
      request as never,
      parsed.error,
      {},
      "chat.createMessage FAILED",
    );
    expect(request.log.warn).toHaveBeenCalledWith(
      { status: 400, reason: "invalid request" },
      "chat.createMessage FAILED",
    );
    expect(JSON.stringify(request.log.warn.mock.calls)).not.toContain(
      "secret-looking-value",
    );
  });

  it("keeps server faults at error with the error itself", () => {
    const request = fakeRequest();
    const failure = new Error("database unavailable");
    logRouteError(
      request as never,
      failure,
      { canvasId: "c-1" },
      "canvas.save FAILED",
    );
    expect(request.log.warn).not.toHaveBeenCalled();
    expect(request.log.error).toHaveBeenCalledWith(
      { canvasId: "c-1", err: failure },
      "canvas.save FAILED",
    );
    const upstream = new ProjectServiceError(
      "project_update_failed",
      "Thumbnail upload failed: Service Unavailable",
      500,
    );
    logRouteError(request as never, upstream, {}, "thumbnail upload error");
    expect(request.log.error).toHaveBeenLastCalledWith(
      { err: upstream },
      "thumbnail upload error",
    );
  });
});

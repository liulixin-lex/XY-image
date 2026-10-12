import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayError } from "./errors.js";
import {
  AsyncImageUnavailableError,
  ImageTaskParkedError,
  type ImageTaskMode,
  TASK_DEADLINE_MS,
  asyncImagesOff,
  imageTaskFetch,
  imageTaskOutcome,
  markAsyncImagesOff,
  pollDelayMs,
  resetAsyncImagesOff,
} from "./image-task.js";

afterEach(() => {
  resetAsyncImagesOff();
  vi.restoreAllMocks();
});

const BASE = "https://gateway.example.com";
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
const accepted = () =>
  json(
    202,
    {
      id: "imgtask_0123456789abcdef",
      task_id: "imgtask_0123456789abcdef",
      object: "image.generation.task",
      status: "processing",
      poll_url: "/v1/images/tasks/imgtask_0123456789abcdef",
    },
    { "x-client-request-id": "req-202", "retry-after": "3" },
  );
const task = (status: string, extra: Record<string, unknown> = {}) =>
  json(200, { id: "imgtask_0123456789abcdef", object: "image.generation.task", status, ...extra }, status === "processing" ? { "retry-after": "3" } : {});

/** A scripted main site: answers in order, records what was asked. */
function mainSite(...answers: (Response | Error)[]) {
  const calls: { url: string; method: string; auth?: string | null }[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      auth: new Headers(init?.headers).get("authorization"),
    });
    const next = answers.shift();
    if (!next) throw new Error("unexpected call");
    if (next instanceof Error) throw next;
    return next;
  });
  return { fetch, calls };
}

function setup(mode: ImageTaskMode, site: ReturnType<typeof mainSite>) {
  let clock = 1_000_000;
  const waits: number[] = [];
  const send = imageTaskFetch(mode, {
    apiKey: "sk-test",
    baseUrl: BASE,
    fetch: site.fetch,
    now: () => clock,
    sleep: async (ms) => {
      waits.push(ms);
      clock += ms;
    },
  });
  return {
    waits,
    advance: (ms: number) => {
      clock += ms;
    },
    generate: () =>
      send(`${BASE}/v1/images/generations`, {
        method: "POST",
        headers: { Authorization: "Bearer sk-test", "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-image-2", prompt: "x" }),
      }),
  };
}

describe("async image tasks", () => {
  it("submits, stores the handle, polls and answers like the synchronous call", async () => {
    const site = mainSite(
      accepted(),
      task("processing"),
      task("completed", { http_status: 200, result: { created: 1, data: [{ url: "https://bucket.example.com/a.png?sig" }] } }),
    );
    const onAccepted = vi.fn(async () => {});
    const onPoll = vi.fn(async () => {});
    const mode: ImageTaskMode = { onAccepted, onPoll };
    const { generate, waits } = setup(mode, site);
    const response = await generate();
    expect(response.status).toBe(200);
    expect(response.headers.get("x-client-request-id")).toBe("req-202");
    expect(await response.json()).toEqual({ created: 1, data: [{ url: "https://bucket.example.com/a.png?sig" }] });
    expect(site.calls.map((call) => [call.method, call.url])).toEqual([
      ["POST", `${BASE}/v1/images/generations/async`],
      ["GET", `${BASE}/v1/images/tasks/imgtask_0123456789abcdef`],
      ["GET", `${BASE}/v1/images/tasks/imgtask_0123456789abcdef`],
    ]);
    expect(site.calls[1]?.auth).toBe("Bearer sk-test");
    expect(onAccepted).toHaveBeenCalledWith({
      taskId: "imgtask_0123456789abcdef",
      requestId: "req-202",
      submittedAt: 1_000_000,
    });
    expect(mode.handle?.requestId).toBe("req-202");
    expect(onPoll).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([3000, 3000]);
  });

  it("falls back when the main site has no async tasks for this key", async () => {
    const site = mainSite(
      json(404, { error: { type: "not_found_error", message: "async image tasks are not enabled" } }),
    );
    const { generate } = setup({}, site);
    const error = await generate().catch((caught) => caught);
    expect(error).toBeInstanceOf(AsyncImageUnavailableError);
    expect(error.detail).toBe("async image tasks are not enabled");
    expect(site.calls).toHaveLength(1);
  });

  it("hands back a refused submit as the main site's own answer", async () => {
    const refusal = json(403, { code: "INSUFFICIENT_BALANCE", message: "Insufficient account balance" }, { "x-client-request-id": "req-403" });
    const site = mainSite(refusal);
    const mode: ImageTaskMode = {};
    const { generate } = setup(mode, site);
    const response = await generate();
    expect(response.status).toBe(403);
    expect(mode.handle).toBeUndefined();
  });

  it("answers a failed task with the error the synchronous call would have given", async () => {
    const site = mainSite(
      accepted(),
      task("failed", { http_status: 400, error: { type: "invalid_request_error", message: "Your request was rejected by the safety system" } }),
    );
    const { generate } = setup({}, site);
    const response = await generate();
    expect(response.status).toBe(400);
    expect(response.headers.get("x-client-request-id")).toBe("req-202");
    expect(await response.json()).toEqual({
      error: { type: "invalid_request_error", message: "Your request was rejected by the safety system" },
    });
  });

  it.each([
    ["a result it could not store", 502, { type: "api_error", message: "failed to store generated image to object storage" }],
    ["its 30-minute limit", 504, { type: "timeout_error", message: "image generation task timed out" }],
    ["a crash", 500, { type: "api_error", message: "image generation task panicked" }],
  ])("leaves a task that failed after generating (%s) to the usage list", async (_label, status, error) => {
    const site = mainSite(accepted(), task("failed", { http_status: status, error }));
    const { generate } = setup({}, site);
    const caught = await generate().catch((thrown) => thrown);
    expect(caught).toBeInstanceOf(GatewayError);
    expect(caught.failure).toMatchObject({ billing: "unknown", requestId: "req-202" });
  });

  it("keeps polling through failed reads and main-site errors", async () => {
    const site = mainSite(
      accepted(),
      new TypeError("fetch failed"),
      json(503, { error: { message: "busy" } }),
      json(524, "timeout"),
      task("completed", { result: { data: [{ b64_json: "aW1n" }] } }),
    );
    const { generate } = setup({}, site);
    const response = await generate();
    expect(response.status).toBe(200);
    expect(site.calls).toHaveLength(5);
  });

  it.each([404, 401, 403])("leaves a task it can no longer read (%i) to the usage list", async (status) => {
    const site = mainSite(accepted(), json(status, { error: { message: "image task not found" } }, { "x-client-request-id": "req-poll" }));
    const { generate } = setup({}, site);
    const caught = await generate().catch((thrown) => thrown);
    expect(caught).toBeInstanceOf(GatewayError);
    expect(caught.failure).toMatchObject({ billing: "unknown", requestId: "req-202" });
  });

  it("stops at the deadline and leaves the task to the usage list", async () => {
    const answers: Response[] = [accepted()];
    for (let i = 0; i < 400; i++) answers.push(task("processing"));
    const site = mainSite(...answers);
    const { generate, waits } = setup({}, site);
    const caught = await generate().catch((thrown) => thrown);
    expect(caught).toBeInstanceOf(GatewayError);
    expect(caught.failure).toMatchObject({ billing: "unknown", requestId: "req-202" });
    expect(waits.reduce((sum, ms) => sum + ms, 0)).toBe(TASK_DEADLINE_MS);
  });

  it("parks when the worker stops, without reading the task again", async () => {
    const park = new AbortController();
    const site = mainSite(accepted(), task("processing"));
    const mode: ImageTaskMode = {
      park: park.signal,
      onPoll: async () => park.abort(),
    };
    const { generate } = setup(mode, site);
    await expect(generate()).rejects.toBeInstanceOf(ImageTaskParkedError);
    expect(site.calls).toHaveLength(2);
  });

  it("polls a task it could not store to the end, even through a shutdown", async () => {
    const park = new AbortController();
    park.abort();
    const site = mainSite(accepted(), task("completed", { result: { data: [{ b64_json: "aW1n" }] } }));
    const mode: ImageTaskMode = {
      park: park.signal,
      onAccepted: async () => {
        throw new Error("database unavailable");
      },
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { generate } = setup(mode, site);
    const response = await generate();
    expect(response.status).toBe(200);
    expect(response.headers.get("x-client-request-id")).toBe("req-202");
  });

  it("resumes a stored task without sending anything", async () => {
    const site = mainSite(task("completed", { result: { data: [{ url: "https://bucket.example.com/b.png" }] } }));
    const mode: ImageTaskMode = {
      resume: { taskId: "imgtask_0123456789abcdef", requestId: "req-old", submittedAt: 1_000_000 - 120_000 },
    };
    const { generate, waits } = setup(mode, site);
    const response = await generate();
    expect(response.headers.get("x-client-request-id")).toBe("req-old");
    expect(site.calls.map((call) => call.method)).toEqual(["GET"]);
    expect(waits).toEqual([10_000]);
  });

  it("refuses a resumed task that is already past its deadline", async () => {
    const site = mainSite();
    const mode: ImageTaskMode = {
      resume: { taskId: "imgtask_0123456789abcdef", requestId: "req-old", submittedAt: 1_000_000 - TASK_DEADLINE_MS - 1 },
    };
    const { generate } = setup(mode, site);
    const caught = await generate().catch((thrown) => thrown);
    expect(caught.failure).toMatchObject({ billing: "unknown", requestId: "req-old" });
    expect(site.calls).toHaveLength(0);
  });

  it("passes other calls through untouched", async () => {
    const site = mainSite(json(200, { data: [] }));
    const send = imageTaskFetch({}, { apiKey: "k", baseUrl: BASE, fetch: site.fetch });
    await send(`${BASE}/v1/models`, { method: "GET" });
    expect(site.calls[0]?.url).toBe(`${BASE}/v1/models`);
  });
});

describe("async image helpers", () => {
  it("polls every 3 s, then 5 s, then 10 s, never faster than asked", () => {
    expect(pollDelayMs(0)).toBe(3000);
    expect(pollDelayMs(29_000, 3)).toBe(3000);
    expect(pollDelayMs(30_000)).toBe(5000);
    expect(pollDelayMs(120_000)).toBe(10_000);
    expect(pollDelayMs(0, 8)).toBe(8000);
    expect(pollDelayMs(0, 600)).toBe(30_000);
  });

  it("finds the async outcome inside a client library's wrapper", () => {
    const parked = new ImageTaskParkedError();
    const unavailable = new AsyncImageUnavailableError("off");
    const wrap = (cause: unknown) => Object.assign(new Error("Connection error."), { cause });
    expect(imageTaskOutcome(wrap(parked))).toBe(parked);
    expect(imageTaskOutcome(wrap(unavailable))).toBe(unavailable);
    expect(imageTaskOutcome(unavailable)).toBe(unavailable);
    expect(imageTaskOutcome(new Error("other"))).toBeUndefined();
  });

  it("remembers for ten minutes that a kind of key has no async tasks", () => {
    expect(asyncImagesOff("openai", 0)).toBe(false);
    markAsyncImagesOff("openai", 0);
    expect(asyncImagesOff("openai", 599_999)).toBe(true);
    expect(asyncImagesOff("grok", 1)).toBe(false);
    expect(asyncImagesOff("openai", 600_000)).toBe(false);
  });
});

import { XY2API_USER_AGENT } from "../../utils/user-agent.js";
import { describeErrorForLog } from "../../utils/error-sanitizer.js";
import {
  GatewayError,
  type GatewayDiagnostics,
  gatewayDiagnostics,
  mapGatewayError,
  record,
} from "./errors.js";

// Asynchronous image calls to the main site (FINDINGS G7 step 2, user
// requests 53/54; plan: xy-ops/agent01/prod/G7-ASYNC-PLAN.md).
//
// xy2api (0.2.2 and later, docs/ASYNC_IMAGE_TASKS.md there) accepts the same
// image request on `POST /v1/images/{generations,edits}/async`, answers 202
// with a task id at once and generates in the background; the result is read
// from `GET /v1/images/tasks/{id}` with the same key. No call is longer than
// a few seconds, so neither Cloudflare's 125 s cut nor this server's own
// restarts lose a paid picture any more:
//   - the task keeps the submit's X-Client-Request-ID, and xy2api writes its
//     usage row as "client:<that id>", so from the 202 on every outcome can be
//     settled exactly (billing-reconciler.ts);
//   - the runner stores the task id before polling; a restarted worker polls
//     the same task instead of sending again (image-runner.ts).
// Only the main site's OpenAI and Grok groups have it, and only when its
// operator configured object storage; otherwise the submit answers 404 before
// creating anything and the call goes the old synchronous way.
//
// The providers build their requests exactly as before and hand this fetch
// in place of the global one: it submits, polls, and returns the finished
// task as if it were the synchronous answer (the same JSON, the same status,
// xy2api's request id in the header), so result parsing and error mapping
// stay in one place.

// xy2api 0.3.0 (async image tasks v2, docs/ASYNC_IMAGE_TASKS.md "Version 2
// additions") is used when GET /v1/images/async/capabilities says so
// (第 67 条); a 0.2.x main site answers it 404 and gets the calls above:
//   - Idempotency-Key on the submit (`xyimg.<job>.<send>`): a submit whose
//     202 was lost (reset, timeout) is sent again and returns the same task
//     instead of being 待核对; 409 idempotency_in_progress waits and repeats.
//   - Long polling (`?wait=25`): one poll per 25 s that returns the moment
//     the task ends, instead of one every 3–10 s.
//   - `billing.status` on a failed task (the main site's own ledger):
//     not_charged failures are plain refusals (an interrupted task is sent
//     again by the worker, features/jobs/auto-retry.ts); pending is polled
//     a little longer; only charged / still pending stays 待核对.
//   - 429 too_many_tasks on the submit (the key's running-task limit): no
//     task, nothing sent; the job waits Retry-After and goes again.
//   - DELETE after the picture is stored (deleteImageTask): the main site's
//     copy is removed instead of waiting for the bucket's lifecycle.

/** Longest a task is polled, from its submit (xy2api runs one ≤ 30 minutes). */
export const TASK_DEADLINE_MS = 35 * 60 * 1000;
/** A submit uploads the references; it is answered before generating. */
const SUBMIT_TIMEOUT_MS = 60_000;
/** Waits before sending a submit again that got no answer (with a key). */
const SUBMIT_RESENDS = [2_000, 5_000];
/** `?wait=` for long polls (xy2api caps it, default 30). */
const LONG_POLL_SECONDS = 25;
/** Polls (5 s apart) a failed task's billing may take to settle. */
const BILLING_SETTLE_POLLS = 6;
const POLL_TIMEOUT_MS = 15_000;
/** How long a 404 on submit turns async off for that kind of key. */
export const ASYNC_OFF_MS = 10 * 60 * 1000;

export type ImageTaskHandle = {
  taskId: string;
  /** xy2api's X-Client-Request-ID of the submit; usage row "client:<id>". */
  requestId?: string;
  /** ms epoch; polling stops TASK_DEADLINE_MS after it. */
  submittedAt: number;
};

/** What the main site's async API offers (xy2api 0.3.0+), cached per site. */
export type AsyncCapabilities = {
  version: number;
  idempotency: boolean;
  /** Longest `?wait=` it holds a poll, 0 = no long polling. */
  longPollSeconds: number;
  deleteTasks: boolean;
  billingInTask: boolean;
};
export const ASYNC_V1: AsyncCapabilities = {
  version: 1,
  idempotency: false,
  longPollSeconds: 0,
  deleteTasks: false,
  billingInTask: false,
};
const CAPABILITIES_TTL_MS = 10 * 60 * 1000;
const capabilitiesCache = new Map<string, { value: AsyncCapabilities; until: number }>();

/** Test hook. */
export function resetAsyncCapabilities(): void {
  capabilitiesCache.clear();
}

/**
 * GET /v1/images/async/capabilities once per site per 10 minutes. 404 (a
 * 0.2.x main site) or anything unreadable means version 1: the calls work
 * as before, only without the version 2 additions.
 */
export async function asyncCapabilities(options: {
  apiKey: string;
  baseUrl: string;
  fetch?: FetchLike;
  now?: () => number;
}): Promise<AsyncCapabilities> {
  const now = options.now ?? Date.now;
  const cached = capabilitiesCache.get(options.baseUrl);
  if (cached && cached.until > now()) return cached.value;
  const send = options.fetch ?? ((input, init) => fetch(input, init));
  let value = ASYNC_V1;
  let ttl = CAPABILITIES_TTL_MS;
  try {
    const response = await send(`${options.baseUrl}/v1/images/async/capabilities`, {
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        Accept: "application/json",
        "User-Agent": XY2API_USER_AGENT,
      },
      signal: AbortSignal.timeout(5_000),
      redirect: "error",
    });
    if (response.status === 200) {
      const c = record(await response.json().catch(() => ({})));
      value = {
        version: Number(c.version) || 1,
        idempotency: c.idempotency === true,
        longPollSeconds: Math.max(0, Math.min(60, Number(c.long_poll_max_seconds) || 0)),
        deleteTasks: c.delete === true,
        billingInTask: c.billing_in_task === true,
      };
    } else if (response.status !== 404) ttl = 60_000;
    await response.body?.cancel().catch(() => {});
  } catch {
    ttl = 60_000;
  }
  capabilitiesCache.set(options.baseUrl, { value, until: now() + ttl });
  console.log(
    `[image-task] main site async version ${value.version}${value.version > 1 ? ` (idempotency ${value.idempotency ? "on" : "off"}, long poll ${value.longPollSeconds}s, delete ${value.deleteTasks ? "on" : "off"}, billing ${value.billingInTask ? "on" : "off"})` : ""}`,
  );
  return value;
}

/** Passed to a provider (ImageCallContext.imageTask) to make its call async. */
export type ImageTaskMode = {
  /**
   * Idempotency-Key for the submit (xy2api 0.3.0+): the same for every
   * resend of one send of one job, new for the next send (auto-retry).
   */
  idempotencyKey?: string;
  /** Set by the call: what the main site offered (for deleteImageTask). */
  capabilities?: AsyncCapabilities;
  /** Already submitted (a redelivered or resumed job): poll this, send nothing. */
  resume?: ImageTaskHandle;
  /** Store the handle before polling. A failure is logged; polling goes on. */
  onAccepted?: (handle: ImageTaskHandle) => Promise<void>;
  /** After each answered poll; the runner renews its lease there. */
  onPoll?: () => Promise<void>;
  /** Aborted when the worker shuts down: stop polling, the task runs on. */
  park?: AbortSignal;
  /** Set once the main site accepted the task (or from `resume`). */
  handle?: ImageTaskHandle;
  /** Tests only: replaces the wait between polls. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

/**
 * The submit was answered 404: async tasks are off at the main site (no
 * object storage) or this key's group has no Images API. Nothing was created
 * or charged; the caller sends the same request synchronously.
 */
export class AsyncImageUnavailableError extends Error {
  constructor(readonly detail: string) {
    super(`async image tasks unavailable: ${detail}`);
    this.name = "AsyncImageUnavailableError";
  }
}

/**
 * Polling stopped because the worker is shutting down. The task goes on at
 * the main site and its id is on the job; the next worker resumes it.
 */
export class ImageTaskParkedError extends Error {
  constructor(readonly retryInSeconds = 5) {
    super("image task parked for another worker");
    this.name = "ImageTaskParkedError";
  }
}

const asyncOffUntil = new Map<string, number>();

/** Whether a 404 on submit recently said async is off for this kind of key. */
export function asyncImagesOff(scope: string, now = Date.now()): boolean {
  const until = asyncOffUntil.get(scope);
  if (until === undefined) return false;
  if (until > now) return true;
  asyncOffUntil.delete(scope);
  return false;
}

export function markAsyncImagesOff(scope: string, now = Date.now()): void {
  asyncOffUntil.set(scope, now + ASYNC_OFF_MS);
}

/** Test hook. */
export function resetAsyncImagesOff(): void {
  asyncOffUntil.clear();
}

/**
 * Seconds between polls: 3 for the first half minute (most pictures take
 * 20–40 s), 5 up to two minutes, then 10. Never faster than the main site
 * asks with Retry-After (it says 3).
 */
export function pollDelayMs(elapsedMs: number, retryAfterSeconds?: number) {
  const base = elapsedMs < 30_000 ? 3000 : elapsedMs < 120_000 ? 5000 : 10_000;
  const asked =
    retryAfterSeconds && retryAfterSeconds > 0
      ? Math.min(retryAfterSeconds, 30) * 1000
      : 0;
  return Math.max(base, asked);
}

const IMAGE_PATH = /\/v1\/images\/(generations|edits)$/;

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type ImageTaskFetchOptions = {
  apiKey: string;
  baseUrl: string;
  /** Tests inject these. */
  fetch?: FetchLike;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
};

/**
 * A fetch for one image call: POSTs to /v1/images/{generations,edits} become
 * a task (submit, then poll); anything else passes through unchanged.
 */
export function imageTaskFetch(
  mode: ImageTaskMode,
  options: ImageTaskFetchOptions,
): FetchLike {
  const send = options.fetch ?? ((input, init) => fetch(input, init));
  const sleep = options.sleep ?? mode.sleep ?? abortableSleep;
  const now = options.now ?? Date.now;
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const kind = IMAGE_PATH.exec(url.pathname)?.[1];
    if (
      input instanceof Request ||
      !kind ||
      (init?.method ?? "GET").toUpperCase() !== "POST"
    )
      return send(input, init);
    let handle = mode.resume;
    const caps = await asyncCapabilities({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      fetch: send,
      now,
    });
    mode.capabilities = caps;
    if (!handle) {
      const submitUrl = new URL(url);
      submitUrl.pathname = `${url.pathname}/async`;
      const headers = new Headers(init?.headers);
      const idempotent = caps.idempotency && Boolean(mode.idempotencyKey);
      if (idempotent) headers.set("Idempotency-Key", mode.idempotencyKey ?? "");
      // A body that can be sent twice (JSON text, a form the client rebuilds):
      // with an Idempotency-Key a lost 202 is safe to ask for again.
      const resendable = idempotent && isResendable(init?.body);
      let response: Response | undefined;
      for (let attempt = 0; ; attempt++) {
        const timeout = AbortSignal.timeout(SUBMIT_TIMEOUT_MS);
        try {
          response = await send(submitUrl, {
            ...init,
            headers,
            signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
            redirect: "error",
          });
        } catch (error) {
          if (init?.signal?.aborted || !resendable || attempt >= SUBMIT_RESENDS.length)
            throw error;
          console.warn(
            `[image-task] ${kind} submit got no answer (${describeErrorForLog(error)}); sending it again with the same Idempotency-Key in ${SUBMIT_RESENDS[attempt]}ms`,
          );
          await sleep(SUBMIT_RESENDS[attempt] ?? 2000);
          continue;
        }
        // The first submission with this key is still being accepted.
        if (response.status === 409 && resendable && attempt < 5) {
          const wait = (Number(response.headers.get("retry-after")) || 1) * 1000;
          await response.body?.cancel().catch(() => {});
          await sleep(Math.min(wait, 5000));
          continue;
        }
        break;
      }
      if (response.status === 429) {
        // The key's running-task limit (too_many_tasks): no task was made.
        const text = await response.clone().text().catch(() => "");
        let code = "";
        try {
          const e = record(record(JSON.parse(text)).error);
          code = String(e.code ?? e.type ?? "");
        } catch {}
        if (code === "too_many_tasks") {
          const wait = Math.max(5, Math.min(120, Number(response.headers.get("retry-after")) || 5));
          console.warn(`[image-task] ${kind} submit: too many running tasks on this key; nothing sent, try again in ${wait}s`);
          throw new GatewayError({
            ...mapGatewayError({ status: 429, body: JSON.parse(text || "{}"), responseReceived: true, answeredByXy2api: true }),
            throttleSeconds: wait,
          });
        }
      }
      if (response.status === 404) {
        // Before any task exists (see AsyncImageUnavailableError).
        const text = await response.text().catch(() => "");
        let message = text;
        try {
          message = String(record(record(JSON.parse(text)).error).message ?? text);
        } catch {}
        throw new AsyncImageUnavailableError(message.slice(0, 120));
      }
      // A resend that found the first submission's task (xy2api 0.3.0).
      const replayed =
        response.status === 200 &&
        response.headers.get("idempotent-replayed") === "true";
      // Anything but 202 is the main site (or what stands in front of it)
      // refusing the submit: no task was created. The provider maps it like
      // a synchronous answer.
      if (response.status !== 202 && !replayed) return response;
      if (replayed) console.log(`[image-task] ${kind} submit replayed: the first one had been accepted`);
      const accepted = record(await response.json().catch(() => ({})));
      const taskId = String(accepted.task_id ?? accepted.id ?? "");
      // The header; xy2api 0.3.0 also puts it in the body as "client:<id>".
      const requestId =
        response.headers.get("x-client-request-id") ??
        (typeof accepted.request_id === "string" && accepted.request_id
          ? accepted.request_id.replace(/^client:/, "")
          : undefined);
      if (!/^[\w-]{8,128}$/.test(taskId))
        // Accepted, but no usable id: it runs, and only its request id tells.
        throw overdue(requestId, "202 without a task id");
      handle = { taskId, ...(requestId ? { requestId } : {}), submittedAt: now() };
      mode.handle = handle;
      console.log(
        `[image-task] ${kind} accepted: task ${taskId} request ${requestId ?? "none"}`,
      );
      const stored = await (mode.onAccepted?.(handle) ?? Promise.resolve()).then(
        () => true,
        (error) => {
          console.error(
            `[image-task] task ${taskId} not stored on the job, polling it to the end: ${describeErrorForLog(error)}`,
          );
          return false;
        },
      );
      // Not on the job, no other worker could resume it: never park it.
      if (!stored) {
        const { park: _unused, ...unparked } = mode;
        return poll(handle, unparked, { ...options, send, sleep, now });
      }
    } else {
      mode.handle = handle;
      console.log(
        `[image-task] resuming task ${handle.taskId} request ${handle.requestId ?? "none"}, submitted ${Math.round((now() - handle.submittedAt) / 1000)}s ago`,
      );
    }
    return poll(handle, mode, { ...options, send, sleep, now });
  };
}

async function poll(
  handle: ImageTaskHandle,
  mode: ImageTaskMode,
  options: ImageTaskFetchOptions & {
    send: FetchLike;
    sleep: NonNullable<ImageTaskFetchOptions["sleep"]>;
    now: () => number;
  },
): Promise<Response> {
  const { send, sleep, now } = options;
  const caps = mode.capabilities ?? ASYNC_V1;
  // Long polling (xy2api 0.3.0): the main site holds the poll until the task
  // ends or `wait` seconds pass, well under any proxy's timeout.
  const wait = Math.min(LONG_POLL_SECONDS, caps.longPollSeconds);
  const taskUrl = `${options.baseUrl}/v1/images/tasks/${encodeURIComponent(handle.taskId)}${wait >= 5 ? `?wait=${wait}` : ""}`;
  const deadline = handle.submittedAt + TASK_DEADLINE_MS;
  let retryAfter: number | undefined;
  let failures = 0;
  let held = false;
  let settleWaits = 0;
  for (let polls = 1; ; polls++) {
    const elapsed = now() - handle.submittedAt;
    // After a poll the main site held for its full wait, ask again at once.
    const pause = held ? 0 : wait >= 5 && polls === 1 ? 1000 : pollDelayMs(elapsed, retryAfter);
    await sleep(Math.min(pause, Math.max(0, deadline - now())), mode.park).catch(() => {
      throw new ImageTaskParkedError();
    });
    if (mode.park?.aborted) throw new ImageTaskParkedError();
    if (now() >= deadline)
      throw overdue(
        handle.requestId,
        `task ${handle.taskId} still running after ${Math.round(TASK_DEADLINE_MS / 60000)} minutes`,
      );
    let response: Response;
    const pollStarted = now();
    held = false;
    try {
      const timeout = AbortSignal.timeout(POLL_TIMEOUT_MS + wait * 1000);
      response = await send(taskUrl, {
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          Accept: "application/json",
          "User-Agent": XY2API_USER_AGENT,
        },
        signal: mode.park ? AbortSignal.any([mode.park, timeout]) : timeout,
        redirect: "error",
      });
    } catch (error) {
      if (mode.park?.aborted) throw new ImageTaskParkedError();
      // The task runs on at the main site; a failed read costs nothing.
      failures++;
      if (failures === 1 || failures % 10 === 0)
        console.warn(
          `[image-task] task ${handle.taskId} poll ${polls} failed (${failures} in a row): ${describeErrorForLog(error)}`,
        );
      retryAfter = undefined;
      continue;
    }
    retryAfter = Number(response.headers.get("retry-after")) || undefined;
    await mode.onPoll?.().catch(() => {});
    if (response.status !== 200) {
      const text = await response.text().catch(() => "");
      if ([401, 403, 404].includes(response.status)) {
        // Expired, another key's, or the key is no longer allowed in. The
        // task may still finish and bill: settle it from the usage list.
        throw overdue(
          handle.requestId,
          `task ${handle.taskId} unreadable: ${response.status}`,
          { status: response.status, headers: response.headers, text, startedAt: handle.submittedAt },
        );
      }
      failures++;
      if (failures === 1 || failures % 10 === 0)
        console.warn(
          `[image-task] task ${handle.taskId} poll ${polls} answered ${response.status} (${failures} in a row)`,
        );
      continue;
    }
    failures = 0;
    held = wait >= 5 && now() - pollStarted >= (wait - 2) * 1000;
    const task = record(await response.json().catch(() => ({})));
    const status = String(task.status ?? "");
    const billing = String(record(task.billing).status ?? "");
    const seconds = Math.round((now() - handle.submittedAt) / 1000);
    if (status === "completed") {
      if (!task.result || typeof task.result !== "object")
        throw overdue(handle.requestId, `task ${handle.taskId} completed without a result`);
      console.log(
        `[image-task] task ${handle.taskId} completed after ${seconds}s (${polls} polls)`,
      );
      return answer(Number(task.http_status) || 200, task.result, handle);
    }
    if (status === "failed") {
      const error = record(task.error);
      const httpStatus = Number(task.http_status) || 502;
      console.warn(
        `[image-task] task ${handle.taskId} failed after ${seconds}s: ${httpStatus} ${String(error.type ?? "")}`,
      );
      // xy2api 0.3.0 says from its own ledger whether the task was billed.
      if (billing === "not_charged") {
        console.log(`[image-task] task ${handle.taskId} not charged (main site ledger): ${String(error.code ?? error.type ?? "")}`);
        // An interrupted task is a refusal like any other: the worker may
        // send the job again (auto-retry), it was never billed.
        return answer(
          httpStatus,
          { error: { ...error, type: error.type ?? error.code } },
          handle,
        );
      }
      if (billing === "pending" && settleWaits < BILLING_SETTLE_POLLS) {
        // Not settled yet; polling refreshes it.
        settleWaits++;
        retryAfter = 5;
        held = false;
        continue;
      }
      if (billing === "charged" || billing === "pending" || maybeCharged(httpStatus, error))
        throw overdue(
          handle.requestId,
          billing === "charged"
            ? `task ${handle.taskId} failed after it was billed (${String(error.code ?? error.type ?? "")})`
            : `task ${handle.taskId} failed after generating`,
          { status: httpStatus, body: { error }, startedAt: handle.submittedAt },
        );
      // The same error the synchronous call would have answered.
      return answer(httpStatus, { error }, handle);
    }
    // processing (or a state added later): keep going.
  }
}

/**
 * Task failures that come after the generation itself, when xy2api may have
 * written the usage row already: its 30-minute limit, a result it could not
 * store or read, a crash. They are 待核对, settled by request id.
 */
function maybeCharged(status: number, error: Record<string, unknown>) {
  const message = String(error.message ?? "");
  return (
    error.type === "timeout_error" ||
    status === 504 ||
    /object storage|invalid image response|non-JSON image response|panicked/i.test(
      message,
    )
  );
}

/** Bodies fetch can send a second time (not a one-shot stream). */
function isResendable(body: unknown): boolean {
  return (
    body === undefined ||
    body === null ||
    typeof body === "string" ||
    body instanceof Uint8Array ||
    body instanceof ArrayBuffer ||
    body instanceof URLSearchParams ||
    body instanceof Blob ||
    body instanceof FormData
  );
}

/**
 * Removes a finished task and its stored pictures at the main site (xy2api
 * 0.3.0 DELETE /v1/images/tasks/{id}) once the picture is safely ours.
 * Best effort: a failure leaves it to the bucket's lifecycle rule.
 */
export async function deleteImageTask(
  taskId: string,
  options: { apiKey: string; baseUrl: string; fetch?: FetchLike },
): Promise<boolean> {
  const send = options.fetch ?? ((input, init) => fetch(input, init));
  try {
    const caps = await asyncCapabilities(options);
    if (!caps.deleteTasks) return false;
    const response = await send(
      `${options.baseUrl}/v1/images/tasks/${encodeURIComponent(taskId)}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "User-Agent": XY2API_USER_AGENT,
        },
        signal: AbortSignal.timeout(10_000),
        redirect: "error",
      },
    );
    await response.body?.cancel().catch(() => {});
    if (response.ok) console.log(`[image-task] task ${taskId} deleted at the main site`);
    else console.warn(`[image-task] task ${taskId} not deleted: ${response.status}`);
    return response.ok;
  } catch (error) {
    console.warn(`[image-task] task ${taskId} not deleted: ${describeErrorForLog(error)}`);
    return false;
  }
}

function answer(status: number, body: unknown, handle: ImageTaskHandle) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...(handle.requestId ? { "x-client-request-id": handle.requestId } : {}),
    },
  });
}

/** 待核对 with the task's request id: the reconciler settles it exactly. */
function overdue(
  requestId: string | undefined,
  why: string,
  seen?: Parameters<typeof gatewayDiagnostics>[0],
): GatewayError {
  const diagnostics: GatewayDiagnostics = seen
    ? gatewayDiagnostics({ ...seen, requestId })
    : { message: why };
  console.warn(`[image-task] ${why}; outcome left to the usage list`);
  return new GatewayError({
    ...mapGatewayError({}),
    ...(requestId ? { requestId } : {}),
    diagnostics,
  });
}

/**
 * What an async call ended with when a client library wrapped it (the OpenAI
 * SDK turns anything its fetch throws into APIConnectionError, keeping it as
 * `cause`): the fallback signal, a park, or a 待核对 with the task's request
 * id. Undefined for every other error.
 */
export function imageTaskOutcome(
  error: unknown,
): AsyncImageUnavailableError | ImageTaskParkedError | GatewayError | undefined {
  let current = error;
  for (let depth = 0; depth < 8 && current; depth++) {
    if (
      current instanceof AsyncImageUnavailableError ||
      current instanceof ImageTaskParkedError
    )
      return current;
    // Only ours: a GatewayError raised by this module while polling.
    if (current instanceof GatewayError && depth > 0) return current;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

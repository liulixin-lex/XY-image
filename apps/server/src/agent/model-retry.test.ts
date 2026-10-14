import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { createDeepAgent } from "deepagents";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatProviderError } from "../features/chat-providers/errors.js";
import { chatRunError } from "../features/chat-providers/run-error.js";
import {
  GatewayError,
  gatewayMessages,
  mapGatewayError,
} from "../features/xy2api/errors.js";
import { createGluedToolCallMiddleware } from "./glued-tool-calls.js";
import {
  ChatConnectError,
  createModelRetryMiddleware,
  retryableModelFailure,
} from "./model-retry.js";
import { createToolErrorMiddleware } from "./tool-errors.js";

afterEach(() => vi.restoreAllMocks());

// What the OpenAI client throws around our transport's error.
const wrapped = (cause: Error) =>
  Object.assign(new Error("Connection error."), { cause });
const gateway = (status: number, message = "busy") =>
  wrapped(
    new GatewayError(
      mapGatewayError({
        status,
        body: { error: { message } },
        responseReceived: true,
      }),
    ),
  );

describe("retryableModelFailure", () => {
  it("retries what the main site turned away as busy, and lost connections", () => {
    expect(retryableModelFailure(gateway(503))).toBe("upstream_busy");
    expect(retryableModelFailure(gateway(429))).toBe("rate_limited");
    expect(
      retryableModelFailure(wrapped(new ChatConnectError("ECONNRESET"))),
    ).toMatch(/^connect/);
    expect(
      retryableModelFailure(
        wrapped(new ChatProviderError("provider_unavailable")),
      ),
    ).toBe("provider_unavailable");
  });
  it("leaves refusals and unknown errors alone", () => {
    expect(retryableModelFailure(gateway(400, "bad"))).toBeUndefined();
    expect(
      retryableModelFailure(gateway(403, "Insufficient account balance")),
    ).toBeUndefined();
    // A 5xx not answered by xy2api (cut in between) is upstream_unknown.
    expect(
      retryableModelFailure(
        wrapped(
          new GatewayError(
            mapGatewayError({
              status: 502,
              body: {},
              responseReceived: true,
              answeredByXy2api: false,
            }),
          ),
        ),
      ),
    ).toBeUndefined();
    expect(
      retryableModelFailure(
        wrapped(new ChatProviderError("provider_auth_failed")),
      ),
    ).toBeUndefined();
    // A failure in the middle of a stream (the page already shows text).
    expect(retryableModelFailure(new Error("terminated"))).toBeUndefined();
  });
});

describe("model retry in the real agent stack", () => {
  function agentWith(failures: Error[], waits: number[]) {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    let calls = 0;
    class Flaky extends FakeListChatModel {
      override async _generate(
        ...args: Parameters<FakeListChatModel["_generate"]>
      ) {
        const failure = failures[calls++];
        if (failure) throw failure;
        return super._generate(...args);
      }
      override bindTools() {
        return this as never;
      }
    }
    const agent = createDeepAgent({
      model: new Flaky({ responses: ["好的"] }) as never,
      middleware: [
        createGluedToolCallMiddleware(),
        createToolErrorMiddleware(),
        createModelRetryMiddleware({
          wait: async (ms) => {
            waits.push(ms);
          },
        }),
      ],
    });
    return {
      calls: () => calls,
      run: () =>
        agent.invoke({ messages: [new HumanMessage("你好")] }).then(
          (state) => ({ state, error: undefined as unknown }),
          (error: unknown) => ({ state: undefined, error }),
        ),
    };
  }

  it("answers after two busy refusals", async () => {
    const waits: number[] = [];
    const a = agentWith([gateway(503), gateway(429)], waits);
    const { state, error } = await a.run();
    expect(error).toBeUndefined();
    const last = state?.messages.at(-1);
    expect(last).toBeInstanceOf(AIMessage);
    expect(last?.content).toBe("好的");
    expect(a.calls()).toBe(3);
    expect(waits).toEqual([2_000, 6_000]);
  });

  it("gives up after four tries with the main site's own message", async () => {
    const waits: number[] = [];
    const a = agentWith(
      [gateway(503), gateway(503), gateway(503), gateway(503)],
      waits,
    );
    const { error } = await a.run();
    expect(a.calls()).toBe(4);
    expect(waits).toEqual([2_000, 6_000, 15_000]);
    expect(chatRunError(error)).toMatchObject({
      message: gatewayMessages.upstream_busy,
    });
  });

  it("does not resend a refusal", async () => {
    const waits: number[] = [];
    const a = agentWith(
      [gateway(403, "内容审计命中风险规则")],
      waits,
    );
    const { error } = await a.run();
    expect(a.calls()).toBe(1);
    expect(waits).toEqual([]);
    expect(chatRunError(error)).toMatchObject({
      message: gatewayMessages.safety_filter,
    });
  });
});

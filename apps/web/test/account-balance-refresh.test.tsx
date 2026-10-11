// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { fetchAccountMock } = vi.hoisted(() => ({
  fetchAccountMock: vi.fn(async () => ({
    user: { xy2apiUserId: 1, email: "u@example.com", username: "" },
    balance: { amount: 4.27, unit: "USD", source: "wallet", planName: "" },
    preferences: null,
    links: { recharge: "", keys: "", usage: "" },
  })),
}));

vi.mock("../src/lib/auth-context", () => ({
  useAuth: () => ({ session: { access_token: "tok", user: { id: "u1" } } }),
}));
vi.mock("../src/lib/xy2api-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/xy2api-api")>()),
  fetchAccount: fetchAccountMock,
  fetchAccountKeys: vi.fn(async () => ({ keys: [] })),
  fetchAuthConfig: vi.fn(async () => ({})),
}));
vi.mock("../src/lib/server-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/server-api")>()),
  fetchImageModels: vi.fn(async () => ({ models: [] })),
  fetchModels: vi.fn(async () => ({ models: [] })),
}));

import { AccountProvider, useAccount } from "../src/lib/account-context";

describe("balance after a picture settles", () => {
  afterEach(() => cleanup());

  it("asks the server to skip its balance cache", async () => {
    // Pre-launch site: the refresh after a batch's second picture hit the
    // server's 15 s cache, so the header stayed one charge behind.
    let notify: (() => void) | null = null;
    function Probe() {
      notify = useAccount().notifyGenerationSettled;
      return null;
    }
    render(
      <AccountProvider>
        <Probe />
      </AccountProvider>,
    );
    await waitFor(() => expect(fetchAccountMock).toHaveBeenCalled());
    expect(fetchAccountMock.mock.calls[0]).toEqual(["tok", undefined]);
    act(() => notify?.());
    await waitFor(() =>
      expect(fetchAccountMock).toHaveBeenLastCalledWith("tok", { fresh: true }),
    );
  });
});

import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../../supabase/user.js";
import type { AccountService } from "./account-service.js";
import { createLinkedAuthenticator } from "./linked-authenticator.js";

describe("linked request authentication", () => {
  it("rejects ordinary Supabase accounts before querying mappings", async () => {
    const getAccount = vi.fn();
    const accounts = {
      getAccount,
      onInvalidate: () => {},
    } as unknown as AccountService;
    const auth = createLinkedAuthenticator(
      {
        authenticate: async () => ({
          id: "user-1",
          email: "user@example.com",
          accessToken: "synthetic",
          userMetadata: {},
        }),
      },
      accounts,
    );
    expect(await auth.authenticate({ headers: {} })).toBeNull();
    expect(getAccount).not.toHaveBeenCalled();
  });
  it("invalidates cached mappings immediately after revocation", async () => {
    const user: AuthenticatedUser = {
      id: "user-1",
      email: "shadow@sso.example.com",
      accessToken: "synthetic",
      userMetadata: {},
      // What GoTrue actually signs after the first magic-link login.
      appMetadata: {
        provider: "email",
        providers: ["email"],
        xy2api_user_id: 7,
      },
    };
    const getAccount = vi.fn().mockResolvedValue({
      xy2api_user_id: 7,
      session_state: "active",
      email: "real@example.com",
      username: "真实用户",
      last_validated_at: new Date().toISOString(),
    });
    const accounts = {
      getAccount,
      onInvalidate: (_id: string) => {},
      validateSession: vi.fn(),
    } as unknown as AccountService;
    const auth = createLinkedAuthenticator(
      { authenticate: async () => user },
      accounts,
    );
    expect(await auth.authenticate({ headers: {} })).toMatchObject({
      email: "real@example.com",
    });
    getAccount.mockResolvedValue({
      xy2api_user_id: 7,
      session_state: "reauth_required",
    });
    accounts.onInvalidate("user-1");
    expect(await auth.authenticate({ headers: {} })).toBeNull();
  });
  it.each([
    ["no xy2api id", { provider: "xy2api" }],
    ["another xy2api user's account row", { xy2api_user_id: 8 }],
    ["a malformed id", { xy2api_user_id: "7" }],
  ])("rejects a session with %s", async (_label, appMetadata) => {
    const accounts = {
      getAccount: vi.fn().mockResolvedValue({
        xy2api_user_id: 7,
        session_state: "active",
        email: "real@example.com",
        last_validated_at: new Date().toISOString(),
      }),
      onInvalidate: () => {},
      validateSession: vi.fn(),
    } as unknown as AccountService;
    const auth = createLinkedAuthenticator(
      {
        authenticate: async () => ({
          id: "user-1",
          email: "u7@sso.example.com",
          accessToken: "synthetic",
          userMetadata: {},
          appMetadata,
        }),
      },
      accounts,
    );
    expect(await auth.authenticate({ headers: {} })).toBeNull();
  });
});

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
      appMetadata: { provider: "xy2api" },
    };
    const getAccount = vi.fn().mockResolvedValue({
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
    getAccount.mockResolvedValue({ session_state: "reauth_required" });
    accounts.onInvalidate("user-1");
    expect(await auth.authenticate({ headers: {} })).toBeNull();
  });
});

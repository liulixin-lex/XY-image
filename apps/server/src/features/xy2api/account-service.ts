import type { ServerEnv } from "../../config/env.js";
import type { LoginResult, Xy2apiClient, Xy2apiTokens } from "./client.js";
import { BillingGuardError, Xy2apiError } from "./errors.js";
import type { SecretBox } from "./secret-box.js";
import type { AccountRow, AccountStore } from "./store.js";

// xy2api error ids that mean "this main-site session is gone"; replayed against
// recorded fixtures per xy2api version in contract.replay.test.ts.
export const REVOKED_SESSION_IDS: ReadonlySet<string> = new Set([
  "TOKEN_REVOKED",
  "USER_INACTIVE",
  "USER_NOT_ACTIVE",
  "USER_NOT_FOUND",
  "INVALID_TOKEN",
  "SESSION_BINDING_MISMATCH",
  "REFRESH_TOKEN_INVALID",
  "REFRESH_TOKEN_EXPIRED",
]);

export class AccountService {
  private refreshes = new Map<string, Promise<string>>();
  private validations = new Map<string, Promise<void>>();
  private logins = new Map<number, Promise<string>>();
  syncKeys: (userId: string) => Promise<void> = async () => {};
  onInvalidate: (userId: string) => void = () => {};
  constructor(
    private readonly store: AccountStore,
    private readonly client: Xy2apiClient,
    private readonly box: SecretBox,
    private readonly env: Pick<ServerEnv, "ssoEmailDomain">,
  ) {}

  getAccount(userId: string) {
    return this.store.get(userId);
  }
  completeLogin(result: Extract<LoginResult, { kind: "ok" }>): Promise<string> {
    const pending = this.logins.get(result.user.id);
    // Serialize concurrent logins so the last completed login owns the token pair.
    const work = (pending?.catch(() => {}) ?? Promise.resolve()).then(() =>
      this.finishLogin(result),
    );
    this.logins.set(result.user.id, work);
    void work
      .finally(() => {
        if (this.logins.get(result.user.id) === work)
          this.logins.delete(result.user.id);
      })
      .catch(() => {});
    return work;
  }
  private async finishLogin({
    user,
    tokens,
  }: Extract<LoginResult, { kind: "ok" }>): Promise<string> {
    if (user.status !== "active") throw new Xy2apiError(403, "USER_NOT_ACTIVE");
    const email = `u${user.id}@${this.env.ssoEmailDomain}`;
    const previous = await this.store.find(user.id);
    const userId =
      previous?.user_id ??
      (await this.store.createShadow(
        email,
        user.id,
        user.username || user.email,
      ));
    const now = new Date().toISOString();
    await this.store.save({
      user_id: userId,
      xy2api_user_id: user.id,
      email: user.email,
      username: user.username ?? null,
      role: user.role ?? null,
      status: user.status,
      session_state: "active",
      last_login_at: now,
      last_validated_at: now,
      ...this.encryptTokens(tokens),
    });
    this.onInvalidate(userId);
    try {
      await this.syncKeys(userId);
    } catch {
      console.warn("[xy2api] Key sync deferred after login");
    }
    return (await this.store.loginLink(email, user.id)).tokenHash;
  }
  private encryptTokens(
    tokens: Xy2apiTokens,
    previousRefreshEnc: string | null = null,
  ) {
    return {
      access_token_enc: this.box.sealSecret(tokens.access_token),
      // Without a (rotated) refresh token keep the previous one; with none at
      // all the session simply requires a new login once the access token ends.
      refresh_token_enc: tokens.refresh_token
        ? this.box.sealSecret(tokens.refresh_token)
        : previousRefreshEnc,
      access_token_expires_at: new Date(
        Date.now() + tokens.expires_in * 1000,
      ).toISOString(),
    };
  }
  private async openAccountSecret(
    userId: string,
    sealed: string,
  ): Promise<string> {
    try {
      return this.box.openSecret(sealed);
    } catch {
      await this.markReauth(userId);
      throw new BillingGuardError("xy2api_reauth_required", 401);
    }
  }
  async requireAccount(userId: string): Promise<AccountRow> {
    const account = await this.store.get(userId);
    if (
      !account ||
      account.session_state !== "active" ||
      !account.access_token_enc
    )
      throw new BillingGuardError("xy2api_reauth_required", 401);
    return account;
  }
  async getAccessToken(userId: string, forceRefresh = false): Promise<string> {
    const existing = this.refreshes.get(userId);
    if (existing) return existing;
    const account = await this.requireAccount(userId);
    if (
      !forceRefresh &&
      Date.parse(account.access_token_expires_at ?? "") > Date.now() + 300000
    )
      return await this.openAccountSecret(
        account.user_id,
        account.access_token_enc ?? "",
      );
    // Recheck after the asynchronous read; another caller may now own refresh.
    const pending = this.refreshes.get(userId);
    if (pending) return pending;
    const work = this.refreshAccount(account);
    this.refreshes.set(userId, work);
    try {
      return await work;
    } finally {
      this.refreshes.delete(userId);
    }
  }
  private async refreshAccount(account: AccountRow): Promise<string> {
    try {
      if (!account.refresh_token_enc)
        throw new Xy2apiError(401, "REFRESH_TOKEN_INVALID");
      const tokens = await this.client.refresh(
        await this.openAccountSecret(
          account.user_id,
          account.refresh_token_enc,
        ),
      );
      const current = await this.requireAccount(account.user_id);
      if (current.refresh_token_enc !== account.refresh_token_enc)
        return await this.openAccountSecret(
          current.user_id,
          current.access_token_enc ?? "",
        );
      await this.store.save({
        user_id: account.user_id,
        ...this.encryptTokens(tokens, account.refresh_token_enc),
      });
      return tokens.access_token;
    } catch (error) {
      if (
        error instanceof Xy2apiError &&
        error.id === "REFRESH_TOKEN_INVALID"
      ) {
        const current = await this.store.get(account.user_id);
        if (
          current?.session_state === "active" &&
          current.refresh_token_enc &&
          current.refresh_token_enc !== account.refresh_token_enc &&
          current.access_token_enc
        )
          return await this.openAccountSecret(
            current.user_id,
            current.access_token_enc,
          );
      }
      if (
        error instanceof Xy2apiError &&
        (error.status === 401 || error.status === 403)
      )
        await this.markReauth(account.user_id);
      throw error;
    }
  }
  async withAccess<T>(
    userId: string,
    fn: (token: string) => Promise<T>,
  ): Promise<T> {
    try {
      try {
        return await fn(await this.getAccessToken(userId));
      } catch (error) {
        if (error instanceof Xy2apiError && error.id === "TOKEN_EXPIRED")
          return await fn(await this.getAccessToken(userId, true));
        throw error;
      }
    } catch (error) {
      if (error instanceof Xy2apiError && REVOKED_SESSION_IDS.has(error.id)) {
        await this.markReauth(userId);
        throw new BillingGuardError("xy2api_reauth_required", 401);
      }
      throw error;
    }
  }
  validateSession(userId: string): Promise<void> {
    const pending = this.validations.get(userId);
    if (pending) return pending;
    const work = this.validate(userId);
    this.validations.set(userId, work);
    void work.finally(() => this.validations.delete(userId)).catch(() => {});
    return work;
  }
  private async validate(userId: string): Promise<void> {
    try {
      const user = await this.withAccess(userId, (token) =>
        this.client.me(token),
      );
      if (user.status !== "active") {
        await this.markReauth(userId);
        return;
      }
      const account = await this.requireAccount(userId);
      if (account.xy2api_user_id !== user.id) {
        await this.markReauth(userId);
        return;
      }
      await this.store.save({
        user_id: userId,
        email: user.email,
        username: user.username ?? null,
        status: user.status,
        role: user.role ?? null,
        last_validated_at: new Date().toISOString(),
      });
      this.onInvalidate(userId);
    } catch (error) {
      if (error instanceof Xy2apiError && REVOKED_SESSION_IDS.has(error.id))
        await this.markReauth(userId);
      // Transient outages do not revoke valid sessions.
    }
  }
  async markReauth(userId: string): Promise<void> {
    await this.store.save({
      user_id: userId,
      session_state: "reauth_required",
      access_token_enc: null,
      refresh_token_enc: null,
    });
    this.onInvalidate(userId);
  }
  async logout(userId: string): Promise<void> {
    const account = await this.store.get(userId);
    await this.markReauth(userId);
    if (account?.refresh_token_enc) {
      try {
        await this.client.logout(
          await this.openAccountSecret(
            account.user_id,
            account.refresh_token_enc,
          ),
        );
      } catch {
        /* Best effort upstream logout. */
      }
    }
  }
}

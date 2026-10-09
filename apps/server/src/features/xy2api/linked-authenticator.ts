import type { RequestAuthenticator } from "../../supabase/user.js";
import type { AccountService } from "./account-service.js";
import { type AccountRow, shadowXy2apiUserId } from "./store.js";

export function createLinkedAuthenticator(
  base: RequestAuthenticator,
  accounts: AccountService,
  revalidateMinutes = 30,
): RequestAuthenticator {
  const cache = new Map<string, { row: AccountRow | null; until: number }>();
  accounts.onInvalidate = (userId) => {
    cache.delete(userId);
  };
  return {
    async authenticate(request) {
      const user = await base.authenticate(request);
      const xy2apiUserId = user ? shadowXy2apiUserId(user.appMetadata) : null;
      if (!user || xy2apiUserId === null) return null;
      let cached = cache.get(user.id);
      if (!cached || cached.until <= Date.now()) {
        const row = await accounts.getAccount(user.id);
        cached = { row, until: Date.now() + 60000 };
        if (cache.size > 10000) cache.clear();
        cache.set(user.id, cached);
      }
      if (
        !cached.row ||
        cached.row.session_state !== "active" ||
        cached.row.xy2api_user_id !== xy2apiUserId
      )
        return null;
      if (
        Date.now() - Date.parse(cached.row.last_validated_at ?? "1970-01-01") >=
        Math.max(1000, revalidateMinutes * 60000 - 30000)
      ) {
        await accounts.validateSession(user.id);
        const refreshed = await accounts.getAccount(user.id);
        if (!refreshed || refreshed.session_state !== "active") return null;
        cached = { row: refreshed, until: Date.now() + 60000 };
        cache.set(user.id, cached);
      }
      const row = cached.row;
      if (!row) return null;
      return {
        ...user,
        email: row.email,
        userMetadata: {
          ...user.userMetadata,
          display_name: row.username || row.email,
        },
      };
    },
  };
}

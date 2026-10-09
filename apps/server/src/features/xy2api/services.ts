import type { ServerEnv } from "../../config/env.js";
import type { AdminSupabaseClient } from "../../supabase/admin.js";
import { createProviderNetwork } from "../chat-providers/network.js";
import { ChatProviderService } from "../chat-providers/service.js";
import { createChatProviderStore } from "../chat-providers/store.js";
import { AccountService } from "./account-service.js";
import { BillingGuard } from "./billing-guard.js";
import { loadImageCatalog } from "./catalog.js";
import { Xy2apiClient } from "./client.js";
import { createCompatProbe } from "./compat.js";
import { KeyService } from "./key-service.js";
import { createSecretBox } from "./secret-box.js";
import { createAccountStore } from "./store.js";

export function createXy2apiServices(
  env: ServerEnv,
  getAdmin: () => AdminSupabaseClient,
) {
  const client = new Xy2apiClient(env.xy2apiBaseUrl);
  const box = createSecretBox(env.secretKey);
  const providers = new ChatProviderService(
    createChatProviderStore(getAdmin),
    box,
    createProviderNetwork({
      allowHttp: env.chatProviderAllowHttp,
      allowedHosts: env.chatProviderAllowedHosts,
      forbiddenUrls: [
        env.xy2apiBaseUrl,
        env.xy2apiWebUrl,
        env.webOrigin,
        env.supabaseUrl ?? "",
        env.supabaseInternalUrl ?? "",
      ],
    }),
  );
  const accounts = new AccountService(
    createAccountStore(getAdmin),
    client,
    box,
    env,
  );
  const keys = new KeyService(
    getAdmin,
    accounts,
    client,
    box,
    loadImageCatalog(env.imageModelsJson),
    env,
    providers,
  );
  accounts.syncKeys = (userId) => keys.syncKeys(userId);
  const billing = new BillingGuard(keys, client, getAdmin, env);
  const compat = createCompatProbe(client);
  return { client, box, accounts, keys, billing, providers, compat };
}
export type Xy2apiServices = ReturnType<typeof createXy2apiServices>;

import type { ServerEnv } from "../../config/env.js";
import type { AdminSupabaseClient } from "../../supabase/admin.js";
import { AccountService } from "./account-service.js";
import { BillingGuard } from "./billing-guard.js";
import { loadImageCatalog } from "./catalog.js";
import { Xy2apiClient } from "./client.js";
import { KeyService } from "./key-service.js";
import { createSecretBox } from "./secret-box.js";
import { createAccountStore } from "./store.js";

export function createXy2apiServices(
  env: ServerEnv,
  getAdmin: () => AdminSupabaseClient,
) {
  const client = new Xy2apiClient(env.xy2apiBaseUrl);
  const box = createSecretBox(env.secretKey);
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
  );
  accounts.syncKeys = (userId) => keys.syncKeys(userId);
  const billing = new BillingGuard(keys, client, getAdmin, env);
  return { client, box, accounts, keys, billing };
}
export type Xy2apiServices = ReturnType<typeof createXy2apiServices>;

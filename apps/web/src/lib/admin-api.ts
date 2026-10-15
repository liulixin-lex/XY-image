/**
 * 管理 › 存储与告警 (第 59 条): main-site admins only. 403 for everyone else;
 * the page and banner only call these when /api/account says isAdmin.
 */
import type {
  AdminAlertsResponse,
  AdminSearchResponse,
  AdminStorageResponse,
} from "@loomic/shared";

import { getServerBaseUrl } from "./env";
import { toApiError } from "./server-api";

async function get<T>(accessToken: string, path: string): Promise<T> {
  const response = await fetch(`${getServerBaseUrl()}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw await toApiError(response, { source: "admin" });
  return (await response.json()) as T;
}

export function fetchAdminStorage(accessToken: string) {
  return get<AdminStorageResponse>(accessToken, "/api/admin/ops/storage");
}

export function fetchAdminAlerts(accessToken: string) {
  return get<AdminAlertsResponse>(accessToken, "/api/admin/ops/alerts");
}

/** 管理 › 联网搜索 (第 70 条): the free web search's sources. */
export function fetchAdminSearch(accessToken: string) {
  return get<AdminSearchResponse>(accessToken, "/api/admin/ops/search");
}

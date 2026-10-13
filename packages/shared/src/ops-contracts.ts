import { z } from "zod";

// 管理 › 存储与告警 (第 59 条): disk samples and alerts the worker records
// (apps/server/src/features/ops/disk-monitor.ts). Admins only (main-site
// role admin).

export const opsAlertLevelSchema = z.enum(["warning", "critical"]);
export type OpsAlertLevel = z.infer<typeof opsAlertLevelSchema>;

export const opsAlertSchema = z.object({
  id: z.string(),
  kind: z.string(),
  level: opsAlertLevelSchema,
  message: z.string(),
  value: z.number().nullable(),
  threshold: z.number().nullable(),
  openedAt: z.string(),
  lastSeenAt: z.string(),
  resolvedAt: z.string().nullable(),
});
export type OpsAlert = z.infer<typeof opsAlertSchema>;

export const diskSampleSchema = z.object({
  sampledAt: z.string(),
  totalBytes: z.number(),
  usedBytes: z.number(),
  availBytes: z.number(),
  /** used / (used + available), as df reports it. */
  percent: z.number(),
  dbBytes: z.number().nullable(),
  storageBytes: z.number().nullable(),
  /** generated / uploads / canvas / brand / other */
  storageByKind: z.record(z.string(), z.number()),
  /** local: Storage files on this disk; s3: in R2 / S3. */
  objectStorage: z.enum(["local", "s3"]),
});
export type DiskSample = z.infer<typeof diskSampleSchema>;

export const adminStorageResponseSchema = z.object({
  latest: diskSampleSchema.nullable(),
  /** Hourly peaks of the last 7 days, oldest first. */
  series: z.array(z.object({ at: z.string(), percent: z.number() })),
  alerts: z.object({
    open: z.array(opsAlertSchema),
    recent: z.array(opsAlertSchema),
  }),
  thresholds: z.object({
    warnPercent: z.number(),
    criticalPercent: z.number(),
  }),
  /** An alert webhook is configured (its address is not shown). */
  webhook: z.boolean(),
});
export type AdminStorageResponse = z.infer<typeof adminStorageResponseSchema>;

export const adminAlertsResponseSchema = z.object({
  open: z.array(opsAlertSchema),
});
export type AdminAlertsResponse = z.infer<typeof adminAlertsResponseSchema>;

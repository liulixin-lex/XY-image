"use client";

/**
 * 管理 › 存储与告警 (第 59 条), for main-site admins: how full the disk is,
 * what fills it, the last week, and the disk alerts the worker opened
 * (features/ops/disk-monitor.ts). Everyone else sees a short note; the
 * server refuses them anyway (403).
 */
import type {
  AdminStorageResponse,
  DiskSample,
  OpsAlert,
} from "@loomic/shared";
import { RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { useAccount } from "@/lib/account-context";
import { fetchAdminStorage } from "@/lib/admin-api";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<string, string> = {
  generated: "生成的图",
  uploads: "上传的参考图",
  canvas: "画布图片",
  brand: "品牌套件",
  other: "缩略图等",
};

function bytes(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function ago(iso: string) {
  const minutes = Math.max(
    0,
    Math.round((Date.now() - Date.parse(iso)) / 60000),
  );
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} 小时前` : `${Math.round(hours / 24)} 天前`;
}

function when(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminPage() {
  const { session } = useAuth();
  const { account } = useAccount();
  const isAdmin = account.data?.user.isAdmin === true;
  const [data, setData] = useState<AdminStorageResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const tokenRef = useRef(session?.access_token);
  tokenRef.current = session?.access_token;

  const load = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) return;
    setLoading(true);
    try {
      setData(await fetchAdminStorage(token));
      setFailed(false);
    } catch (error) {
      console.warn("[admin] storage unavailable", error);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  return (
    <div className="pb-16">
      <PageHeader
        title="管理"
        description="存储与告警：磁盘还剩多少、被什么占着，告警什么时候发生。"
      />
      <div className="mx-auto max-w-[1600px] gutter-x">
        {account.loading && !account.data ? null : !isAdmin ? (
          <p className="glass rounded-[18px] px-6 py-6 text-[14px] text-fg-soft">
            只有管理员可以查看这个页面。
          </p>
        ) : failed && !data ? (
          <div className="glass flex items-center justify-between gap-4 rounded-[18px] px-6 py-6">
            <p className="text-[14px] text-fg-soft">存储数据暂时读不到。</p>
            <Button variant="outline" onClick={() => void load()}>
              重试
            </Button>
          </div>
        ) : !data ? (
          <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
            <div className="h-64 animate-breathe rounded-[18px]" />
            <div className="h-64 animate-breathe rounded-[18px]" />
          </div>
        ) : (
          <Storage
            data={data}
            loading={loading}
            onRefresh={() => void load()}
          />
        )}
      </div>
    </div>
  );
}

function Storage({
  data,
  loading,
  onRefresh,
}: { data: AdminStorageResponse; loading: boolean; onRefresh: () => void }) {
  const { latest, thresholds } = data;
  if (!latest)
    return (
      <p className="glass rounded-[18px] px-6 py-6 text-[14px] text-fg-soft">
        还没有采样记录。Worker 启动后一分钟内会记下第一次，之后每 10 分钟一次。
      </p>
    );
  const level =
    latest.percent >= thresholds.criticalPercent
      ? "critical"
      : latest.percent >= thresholds.warnPercent
        ? "warning"
        : "ok";
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <section
          className="glass rounded-[18px] p-6"
          aria-labelledby="disk-title"
        >
          <div className="flex items-start justify-between gap-3">
            <h2 id="disk-title" className="poster-label text-[17px] text-fg">
              磁盘
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={onRefresh}
              disabled={loading}
            >
              <RefreshCwIcon
                className={cn(loading && "animate-spin")}
                strokeWidth={1.75}
              />
              刷新
            </Button>
          </div>
          <p className="mt-2 flex items-baseline gap-2">
            <span
              className={cn(
                "numeral text-[64px] leading-none tabular",
                level === "critical"
                  ? "text-alert"
                  : level === "warning"
                    ? "text-warn"
                    : "text-fg",
              )}
            >
              {latest.percent.toFixed(1)}
            </span>
            <span className="text-[15px] text-fg-soft">% 已用</span>
          </p>
          <Gauge
            percent={latest.percent}
            warn={thresholds.warnPercent}
            critical={thresholds.criticalPercent}
          />
          <dl className="mt-4 grid grid-cols-3 gap-3 text-[13px]">
            <Stat label="已用" value={bytes(latest.usedBytes)} />
            <Stat label="可用" value={bytes(latest.availBytes)} />
            <Stat
              label="容量"
              value={bytes(latest.usedBytes + latest.availBytes)}
            />
          </dl>
          <p className="mt-4 text-[12.5px] text-fg-muted">
            {ago(latest.sampledAt)}采样 · 超过 {thresholds.warnPercent}%
            提醒，超过 {thresholds.criticalPercent}% 为严重 ·{" "}
            {data.webhook
              ? "告警会推送到已配置的 webhook"
              : "没有配置告警推送，告警只在这里和顶部提示"}
          </p>
        </section>

        <section
          className="glass rounded-[18px] p-6"
          aria-labelledby="usage-title"
        >
          <h2 id="usage-title" className="poster-label text-[17px] text-fg">
            占用构成
          </h2>
          <Breakdown sample={latest} />
          <p className="mt-4 text-[12.5px] leading-relaxed text-fg-muted">
            {latest.objectStorage === "s3"
              ? "图片文件存在 R2 对象存储，不占这台机器的磁盘；上面的图片大小是对象存储里的用量。"
              : "图片文件存在这台机器的磁盘上。改用 R2 对象存储后，它们不再占本机磁盘（见自建手册「对象存储」）。"}
          </p>
        </section>
      </div>

      <section
        className="glass rounded-[18px] p-6"
        aria-labelledby="trend-title"
      >
        <h2 id="trend-title" className="poster-label text-[17px] text-fg">
          最近 7 天
        </h2>
        <Trend
          series={data.series}
          warn={thresholds.warnPercent}
          critical={thresholds.criticalPercent}
        />
      </section>

      <section
        className="glass rounded-[18px] p-6"
        aria-labelledby="alerts-title"
      >
        <h2 id="alerts-title" className="poster-label text-[17px] text-fg">
          告警
        </h2>
        {data.alerts.open.length === 0 && data.alerts.recent.length === 0 ? (
          <p className="mt-3 text-[13.5px] text-fg-soft">还没有过磁盘告警。</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {[...data.alerts.open, ...data.alerts.recent].map((alert) => (
              <AlertRow key={alert.id} alert={alert} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-fg-muted">{label}</dt>
      <dd className="mt-0.5 font-semibold text-fg tabular">{value}</dd>
    </div>
  );
}

function Gauge({
  percent,
  warn,
  critical,
}: { percent: number; warn: number; critical: number }) {
  const tone =
    percent >= critical ? "bg-alert" : percent >= warn ? "bg-warn" : "bg-ok";
  return (
    <div
      className="relative mt-4 h-3 overflow-hidden rounded-full bg-tint/[0.08]"
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Number(percent.toFixed(1))}
      aria-label="磁盘已用"
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-700",
          tone,
        )}
        style={{ width: `${Math.min(100, percent)}%` }}
      />
      {[warn, critical].map((line) => (
        <span
          key={line}
          aria-hidden
          className="absolute top-0 h-full w-0.5 bg-fg/40"
          style={{ left: `${line}%` }}
        />
      ))}
    </div>
  );
}

function Breakdown({ sample }: { sample: DiskSample }) {
  const rows = [
    { label: "数据库", value: sample.dbBytes ?? 0 },
    ...Object.entries(sample.storageByKind)
      .map(([kind, value]) => ({ label: KIND_LABEL[kind] ?? kind, value }))
      .sort((a, b) => b.value - a.value),
  ];
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <ul className="mt-4 flex flex-col gap-3">
      {rows.map((row) => (
        <li
          key={row.label}
          className="grid grid-cols-[7.5em_1fr_auto] items-center gap-3 text-[13px]"
        >
          <span className="text-fg-soft">{row.label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-tint/[0.06]">
            <span
              className="block h-full rounded-full bg-acc/70"
              style={{ width: `${(row.value / max) * 100}%` }}
            />
          </span>
          <span className="font-semibold text-fg tabular">
            {bytes(row.value)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Trend({
  series,
  warn,
  critical,
}: {
  series: Array<{ at: string; percent: number }>;
  warn: number;
  critical: number;
}) {
  if (series.length < 2)
    return (
      <p className="mt-3 text-[13.5px] text-fg-soft">
        数据还不够画走势，过几个小时再来看。
      </p>
    );
  const width = 1000;
  const height = 160;
  const first = Date.parse(series[0]!.at);
  const span = Math.max(1, Date.parse(series.at(-1)!.at) - first);
  const x = (at: string) => ((Date.parse(at) - first) / span) * width;
  const y = (percent: number) =>
    height - (Math.min(100, percent) / 100) * height;
  const points = series
    .map((point) => `${x(point.at).toFixed(1)},${y(point.percent).toFixed(1)}`)
    .join(" ");
  const last = series.at(-1)!;
  return (
    <figure className="mt-4">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-40 w-full overflow-visible"
        role="img"
        aria-label={`最近 7 天磁盘用量，最新 ${last.percent.toFixed(1)}%`}
      >
        {[warn, critical].map((line) => (
          <line
            key={line}
            x1={0}
            x2={width}
            y1={y(line)}
            y2={y(line)}
            className={line === critical ? "stroke-alert/50" : "stroke-warn/50"}
            strokeDasharray="6 6"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <polyline
          points={points}
          fill="none"
          className="stroke-acc"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
      </svg>
      <figcaption className="mt-2 flex justify-between text-[12px] text-fg-muted tabular">
        <span>{when(series[0]!.at)}</span>
        <span>
          虚线：{warn}% 提醒、{critical}% 严重
        </span>
        <span>{when(last.at)}</span>
      </figcaption>
    </figure>
  );
}

function AlertRow({ alert }: { alert: OpsAlert }) {
  const open = !alert.resolvedAt;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-[13px]">
      <span
        className={cn(
          "shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-semibold whitespace-nowrap",
          !open
            ? "bg-tint/[0.07] text-fg-soft"
            : alert.level === "critical"
              ? "bg-alert-wash text-alert"
              : "bg-warn-wash text-warn",
        )}
      >
        {!open ? "已恢复" : alert.level === "critical" ? "严重" : "提醒"}
      </span>
      <span className="min-w-0 flex-1 text-fg">{alert.message}</span>
      <span className="shrink-0 text-fg-muted tabular">
        {when(alert.openedAt)}
        {alert.resolvedAt ? ` – ${when(alert.resolvedAt)}` : " 起"}
      </span>
    </li>
  );
}

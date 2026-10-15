"use client";

/**
 * 管理 › 存储与告警 (第 59 条), for main-site admins: how full the disk is,
 * what fills it, the last week, and the disk alerts the worker opened
 * (features/ops/disk-monitor.ts). Everyone else sees a short note; the
 * server refuses them anyway (403).
 */
import type {
  AdminSearchResponse,
  AdminStorageResponse,
  DiskSample,
  OpsAlert,
} from "@loomic/shared";
import { RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { useCountUp } from "@/hooks/use-count-up";
import { useAccount } from "@/lib/account-context";
import { fetchAdminSearch, fetchAdminStorage } from "@/lib/admin-api";
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
        description="磁盘、存储占用、告警和联网搜索。"
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
        {isAdmin ? <SearchSources token={session?.access_token ?? null} /> : null}
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
              <CountUp value={latest.percent} />
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
            {ago(latest.sampledAt)}采样 · {thresholds.warnPercent}% 提醒 · {thresholds.criticalPercent}% 严重 ·{" "}
            {data.webhook ? "会推送到 webhook" : "未配置推送"}
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
              ? "图片在 R2 对象存储，不占本机磁盘。"
              : "图片在本机磁盘；改用 R2 对象存储后不再占用（见自建手册「对象存储」）。"}
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

const SOURCE_NAME: Record<string, string> = {
  anysearch: "AnySearch",
  searxng: "SearXNG",
  tavily: "Tavily",
  brave: "Brave",
  "yahoo-jp": "Yahoo! JAPAN",
  duckduckgo: "DuckDuckGo",
  wikipedia: "维基百科",
};

const REFUSAL: Record<string, string> = {
  rate: "限流",
  quota: "额度用完",
  auth: "密钥无效",
  blocked: "被拦截",
  error: "连接失败",
};

function clock(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * 管理 › 联网搜索 (第 70 条): the free web search's sources as the API sees
 * them, so a used-up AnySearch quota or a refused key is visible. Loads on
 * its own: a failure here never hides the storage card.
 */
function SearchSources({ token }: { token: string | null }) {
  const [data, setData] = useState<AdminSearchResponse | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetchAdminSearch(token)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((error) => {
        console.warn("[admin] search sources unavailable", error);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);
  return (
    <section className="glass mt-4 rounded-[18px] p-6" aria-labelledby="search-title">
      <h2 id="search-title" className="poster-label text-[17px] text-fg">
        联网搜索
      </h2>
      <p className="mt-1 text-[12.5px] leading-relaxed text-fg-muted">
        没有自带搜索的模型用这些来源，按顺序试，前一个没结果或用不了就换下一个。
        {data?.geminiFallback ? "全都没有结果时，改用用户主站 Key 上 Gemini 的 Google 搜索。" : ""}
      </p>
      {failed ? (
        <p className="mt-3 text-[13.5px] text-fg-soft">搜索来源的状态暂时读不到。</p>
      ) : !data ? (
        <div className="mt-3 h-24 animate-breathe rounded-[12px]" />
      ) : data.sources.length === 0 ? (
        <p className="mt-3 text-[13.5px] text-fg-soft">没有配置搜索来源。</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {data.sources.map((src) => (
            <li key={src.name} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5 text-[13px]">
              <span className="w-32 shrink-0 font-medium text-fg">{SOURCE_NAME[src.name] ?? src.name}</span>
              <span
                className={
                  src.state === "ok"
                    ? "text-fg-soft"
                    : src.lastRefusal?.kind === "auth" || src.lastRefusal?.kind === "quota" || src.state === "budget"
                      ? "text-alert"
                      : "text-warn"
                }
              >
                {src.state === "ok"
                  ? "可用"
                  : src.state === "budget"
                    ? "今天的额度已用完，0 点（UTC）恢复"
                    : `暂停到 ${src.restUntil ? clock(src.restUntil) : "稍后"}（${REFUSAL[src.lastRefusal?.kind ?? "error"] ?? "出错"}）`}
              </span>
              {src.today ? (
                <span className="tabular-nums text-fg-muted">
                  今天 {src.today.used} / {src.today.budget} 次
                </span>
              ) : null}
              {src.lastOkAt ? <span className="ml-auto text-[12px] text-fg-muted">最近成功 {clock(src.lastOkAt)}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The big percentage, counting up once when the page opens. */
function CountUp({ value }: { value: number }) {
  return <>{useCountUp(value).toFixed(1)}</>;
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
        className={cn("grow-x h-full rounded-full", tone)}
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
      {rows.map((row, index) => (
        <li
          key={row.label}
          className="grid grid-cols-[7.5em_1fr_auto] items-center gap-3 text-[13px]"
        >
          <span className="text-fg-soft">{row.label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-tint/[0.06]">
            <span
              className="grow-x block h-full rounded-full bg-acc/70"
              style={{ width: `${(row.value / max) * 100}%`, "--stagger": index } as React.CSSProperties}
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
        <defs>
          <linearGradient id="trend-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--acc)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--acc)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon
          points={`0,${height} ${points} ${width},${height}`}
          fill="url(#trend-fill)"
          className="draw-line"
        />
        <polyline
          points={points}
          fill="none"
          className="draw-line stroke-acc"
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

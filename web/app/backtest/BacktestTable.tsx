"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLivePrices, fmtLiveTime } from "../lib/useLivePrices";

export type BacktestRow = {
  ticker: string;
  company: string;
  market: string;
  first_detected: string;
  days_tracked: number;
  detection_price: number;
  current_price: number;
  return_pct: number;
  detection_score: number;
  current_score: number | null;
  still_active: boolean;
  exited?: boolean;
  exit_date?: string;
  exit_price?: number;
  exit_reasons?: string[];
  // New peak-tracking + profit-taking signal fields (no auto-exit on profit signals)
  max_return_pct?: number;
  peak_price?: number;
  profit_signal_partial?: boolean;  // +20% reached
  profit_signal_full?: boolean;     // +25% reached
};

function fmtNum(v: number | null | undefined, digits = 2, suffix = ""): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "\u2014";
  return `${v.toFixed(digits)}${suffix}`;
}

type TabFilter = "all" | "active" | "exited";

export default function BacktestTable({ rows }: { rows: BacktestRow[] }) {
  const [tab, setTab] = useState<TabFilter>("all");
  const tickers = useMemo(() => rows.map((r) => r.ticker), [rows]);
  const { quotes, asOf, loading } = useLivePrices(tickers);

  // Recompute with live prices where available
  const live = useMemo(() => {
    return rows.map((r) => {
      const q = quotes[r.ticker];
      const livePrice =
        q && q.price !== null && q.price !== undefined
          ? q.price
          : r.current_price;
      const ret =
        ((livePrice - r.detection_price) / r.detection_price) * 100;
      return {
        ...r,
        live_price: livePrice,
        is_live: !!(q && q.price !== null && q.price !== undefined),
        return_pct: ret,
      };
    });
  }, [rows, quotes]);

  const filtered = useMemo(() => {
    if (tab === "active") return live.filter((r) => !r.exited);
    if (tab === "exited") return live.filter((r) => r.exited);
    return live;
  }, [live, tab]);

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => b.return_pct - a.return_pct),
    [filtered],
  );

  const exitedCount = live.filter((r) => r.exited).length;
  const activeCount = live.filter((r) => !r.exited).length;

  const total = sorted.length;
  const winners = sorted.filter((r) => r.return_pct > 0).length;
  const hitRate = total > 0 ? ((winners / total) * 100).toFixed(1) : "\u2014";
  const avgReturn =
    total > 0
      ? (sorted.reduce((s, r) => s + r.return_pct, 0) / total).toFixed(2)
      : "\u2014";
  const bestReturn = total > 0 ? Math.max(...sorted.map((r) => r.return_pct)) : 0;
  const worstReturn = total > 0 ? Math.min(...sorted.map((r) => r.return_pct)) : 0;
  const active = sorted.filter((r) => r.still_active).length;

  return (
    <>
      {/* Summary stats */}
      <section className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-3">
        <div className="card p-3">
          <div className="text-xs text-muted">Tracked</div>
          <div className="text-2xl font-bold num">{total}</div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-muted">Active Now</div>
          <div className="text-2xl font-bold num text-accent">{active}</div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-muted">Hit Rate</div>
          <div className="text-2xl font-bold num">{hitRate}%</div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-muted">Avg Return</div>
          <div
            className={`text-2xl font-bold num ${Number(avgReturn) >= 0 ? "text-emerald-400" : "text-red-400"}`}
          >
            {avgReturn}%
          </div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-muted">Best</div>
          <div className="text-2xl font-bold num text-emerald-400">
            +{bestReturn.toFixed(1)}%
          </div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-muted">Worst</div>
          <div className="text-2xl font-bold num text-red-400">
            {worstReturn.toFixed(1)}%
          </div>
        </div>
      </section>

      {/* Filter tabs */}
      <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-1 bg-border/30 rounded p-1 w-fit">
          {(
            [
              { key: "all", label: `All (${live.length})` },
              { key: "active", label: `Active (${activeCount})` },
              { key: "exited", label: `Exited (${exitedCount})` },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 text-sm rounded transition ${
                tab === t.key
                  ? "bg-accent text-black font-semibold"
                  : "hover:bg-border/50 text-muted"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Live indicator */}
      <div className="mb-3 flex items-center justify-end text-[11px] text-muted gap-2">
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full ${loading ? "bg-yellow-400 animate-pulse" : "bg-emerald-400"}`}
        />
        <span>
          {loading ? "Refreshing" : "Live"} · Price as of {fmtLiveTime(asOf)}
        </span>
      </div>

      {sorted.length === 0 ? (
        <div className="card p-8 text-center text-muted">
          <p>
            No detection history yet. Run the screener at least once to start
            tracking.
          </p>
        </div>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="md:hidden space-y-3 mb-8">
            {sorted.map((r) => (
              <div key={r.ticker} className="card p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <Link
                      href={`/screener/${encodeURIComponent(r.ticker)}`}
                      className="font-bold text-lg hover:text-accent"
                    >
                      {r.ticker}
                    </Link>
                    <div className="text-xs text-muted">{r.company}</div>
                  </div>
                  <div className="text-right">
                    <div
                      className={`text-lg font-bold num ${r.return_pct >= 0 ? "text-emerald-400" : "text-red-400"}`}
                    >
                      {r.return_pct >= 0 ? "+" : ""}
                      {r.return_pct.toFixed(1)}%
                    </div>
                    <div className="text-xs text-muted">{r.days_tracked}d</div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <div className="text-muted">Detected</div>
                    <div className="num">{r.first_detected}</div>
                  </div>
                  <div>
                    <div className="text-muted">Entry</div>
                    <div className="num">${r.detection_price.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-muted">
                      {r.is_live ? "Live" : "Close"}
                    </div>
                    <div className={`num ${r.is_live ? "" : "text-muted"}`}>
                      ${r.live_price.toFixed(2)}
                    </div>
                  </div>
                </div>
                {(r.profit_signal_full || r.profit_signal_partial) && !r.exited && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {r.profit_signal_partial && (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400 font-semibold"
                        title="피크 +20% 도달 — 절반 부분 매도 검토 (자동 exit 안 됨)"
                      >
                        ⚡ +20%
                      </span>
                    )}
                    {r.profit_signal_full && (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-semibold"
                        title="피크 +25% 도달 — 매도 검토 (자동 exit 안 됨, 10x 종목 보유 가능)"
                      >
                        ⚡ +25%
                      </span>
                    )}
                    {r.max_return_pct !== undefined && r.max_return_pct > r.return_pct && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-border/40 text-muted font-mono">
                        peak +{r.max_return_pct.toFixed(0)}%
                      </span>
                    )}
                  </div>
                )}
                {r.exited && (
                  <div className="mt-2 text-xs text-red-400 bg-red-500/10 rounded px-2 py-1">
                    ✗ Exited {r.exit_date} — {r.exit_reasons?.join(", ")}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-border/30 text-muted text-xs uppercase">
                <tr>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2">Mkt</th>
                  <th className="text-left px-3 py-2">Ticker</th>
                  <th className="text-left px-3 py-2">Company</th>
                  <th className="text-right px-3 py-2">Detected</th>
                  <th className="text-right px-3 py-2">Days</th>
                  <th className="text-right px-3 py-2">Entry $</th>
                  <th className="text-right px-3 py-2">Current $</th>
                  <th className="text-right px-3 py-2">Return</th>
                  <th className="text-right px-3 py-2">Score @Det</th>
                  <th className="text-left px-3 py-2">Exit</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr
                    key={r.ticker}
                    className="border-t border-border hover:bg-border/20"
                  >
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block w-2 h-2 rounded-full ${r.still_active ? "bg-emerald-400" : "bg-border"}`}
                        title={
                          r.still_active
                            ? "Currently detected"
                            : "No longer detected"
                        }
                      />
                    </td>
                    <td className="px-3 py-2 text-xs text-muted">{r.market}</td>
                    <td className="px-3 py-2 font-bold">
                      <Link
                        href={`/screener/${encodeURIComponent(r.ticker)}`}
                        className="hover:text-accent"
                      >
                        {r.ticker}
                      </Link>
                    </td>
                    <td className="px-3 py-2 truncate max-w-[160px]">
                      {r.company}
                    </td>
                    <td className="px-3 py-2 text-right num text-muted text-xs">
                      {r.first_detected}
                    </td>
                    <td className="px-3 py-2 text-right num">{r.days_tracked}</td>
                    <td className="px-3 py-2 text-right num">
                      {fmtNum(r.detection_price, 2)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right num ${r.is_live ? "" : "text-muted"}`}
                    >
                      {fmtNum(r.live_price, 2)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right num font-semibold ${r.return_pct >= 0 ? "text-emerald-400" : "text-red-400"}`}
                    >
                      {r.return_pct >= 0 ? "+" : ""}
                      {r.return_pct.toFixed(1)}%
                    </td>
                    <td className="px-3 py-2 text-right num text-muted">
                      {fmtNum(r.detection_score, 0)}
                    </td>
                    <td className="px-3 py-2 text-left text-xs">
                      {r.exited ? (
                        <span
                          className="text-red-400 cursor-help"
                          title={`Exit ${r.exit_date ?? ""}${r.exit_reasons?.length ? ": " + r.exit_reasons.join("; ") : ""}`}
                        >
                          ✗ {r.exit_date ?? "exited"}
                          <span className="block text-[10px] text-muted max-w-[180px] truncate">
                            {r.exit_reasons?.join(", ")}
                          </span>
                        </span>
                      ) : (
                        <span className="text-emerald-400">Active</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

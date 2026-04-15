"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Candidate, Meta } from "../types";

const MARKET_COLORS: Record<string, string> = {
  US: "bg-blue-500/20 text-blue-400",
  HK: "bg-red-500/20 text-red-400",
  KR: "bg-emerald-500/20 text-emerald-400",
};

// Keep these in sync with RuleScorecard.tsx
const PRIMARY_IDS = [
  "T1_sma50_gt_sma150",
  "T2_sma150_gt_sma200",
  "T4_sma200_rising_21d",
  "M1_near_52w_high",
  "R1_rs_70",
  "V1_52w_span",
  "V2_liquidity",
];
const SECONDARY_IDS = [
  "T3_sma20_gt_sma50",
  "M2_quarter_positive",
  "R2_rs_90",
  "P1_tightening",
  "P2_last_contraction",
  "P3_vol_dryup",
  "F1_eps_growth",
  "F2_rev_growth",
  "F3_inst_ownership",
];

function countByCategory(
  rules: Record<string, { passed: boolean }> | undefined,
  ids: string[],
): { passed: number; total: number } {
  if (!rules) return { passed: 0, total: 0 };
  let passed = 0;
  let total = 0;
  for (const id of ids) {
    if (rules[id]) {
      total += 1;
      if (rules[id].passed) passed += 1;
    }
  }
  return { passed, total };
}

// Default min-rules slider per market, tuned from observed distributions.
// Adjust if future runs show different spread.
const DEFAULT_MIN_BY_MARKET: Record<string, number> = {
  All: 12,
  US: 12,
  HK: 9,
  KR: 10,
};

function fmtNum(v: number | null | undefined, digits = 2, suffix = ""): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "\u2014";
  return `${v.toFixed(digits)}${suffix}`;
}

function MarketBadge({ market }: { market: string }) {
  const cls = MARKET_COLORS[market] ?? "bg-border text-muted";
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${cls}`}>
      {market}
    </span>
  );
}

function ScoreBar({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score));
  return (
    <div className="w-full h-1.5 bg-border rounded">
      <div className="h-1.5 rounded bg-accent" style={{ width: `${pct}%` }} />
    </div>
  );
}

function RulesBadge({
  passed,
  total,
  compact = false,
}: {
  passed: number;
  total: number;
  compact?: boolean;
}) {
  const pct = total > 0 ? (passed / total) * 100 : 0;
  const color =
    pct >= 80 ? "text-emerald-400" : pct >= 60 ? "text-yellow-400" : "text-muted";
  const barColor =
    pct >= 80 ? "bg-emerald-400" : pct >= 60 ? "bg-yellow-400" : "bg-border";
  return (
    <div className="flex items-center gap-1.5 justify-end">
      <span className={`num font-semibold text-xs ${color} tabular-nums`}>
        {passed}/{total}
      </span>
      <div className={`${compact ? "w-10" : "w-14"} h-1.5 bg-border rounded overflow-hidden`}>
        <div className={`h-1.5 rounded ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function MarketDirectionBanner({ meta }: { meta: Meta | null }) {
  if (!meta?.market_direction) return null;
  const entries = Object.entries(meta.market_direction);
  if (!entries.length) return null;
  return (
    <section className="mb-5">
      <div className="text-xs text-muted mb-2">Market Direction</div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {entries.map(([mkt, md]) => {
          const pass = md.direction_passed;
          const total = md.direction_total;
          const state =
            pass === total ? "up" : pass === 0 ? "down" : "mixed";
          const stateColor =
            state === "up"
              ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
              : state === "down"
              ? "bg-red-500/15 text-red-400 border-red-500/30"
              : "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
          const label =
            state === "up" ? "Uptrend" : state === "down" ? "Weak" : "Mixed";
          return (
            <div
              key={mkt}
              className={`card p-3 border ${stateColor}`}
              title={Object.values(md.direction_rules)
                .map((r) => `${r.passed ? "✓" : "✗"} ${r.name}`)
                .join("\n")}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MarketBadge market={mkt} />
                  <span className="text-sm font-semibold">{label}</span>
                </div>
                <div className="num text-xs tabular-nums">
                  {pass}/{total}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function ScreenerTable({
  rows,
  meta,
}: {
  rows: Candidate[];
  meta: Meta | null;
}) {
  const availableMarkets = useMemo(
    () => [...new Set(rows.map((r) => r.market || "US"))].sort(),
    [rows],
  );
  const [selectedMarket, setSelectedMarket] = useState<string>("All");
  const [minRules, setMinRules] = useState<number>(DEFAULT_MIN_BY_MARKET.All);

  const handleMarketChange = (m: string) => {
    setSelectedMarket(m);
    setMinRules(DEFAULT_MIN_BY_MARKET[m] ?? 10);
  };

  const filtered = useMemo(() => {
    const byMarket =
      selectedMarket === "All"
        ? rows
        : rows.filter((r) => (r.market || "US") === selectedMarket);
    return byMarket
      .filter((r) => (r.rules_passed ?? 0) >= minRules)
      .sort((a, b) => {
        const pa = a.rules_passed ?? 0;
        const pb = b.rules_passed ?? 0;
        if (pa !== pb) return pb - pa;
        return (b.score ?? 0) - (a.score ?? 0);
      });
  }, [rows, selectedMarket, minRules]);

  // Max total rules observed (varies per market: US=16, HK/KR=13)
  const maxRulesTotal = useMemo(() => {
    const m =
      selectedMarket === "All"
        ? rows
        : rows.filter((r) => (r.market || "US") === selectedMarket);
    return Math.max(0, ...m.map((r) => r.rules_total ?? 0));
  }, [rows, selectedMarket]);

  return (
    <>
      <MarketDirectionBanner meta={meta} />

      {/* Controls */}
      <section className="mb-4 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
        {/* Market tabs */}
        <div className="flex gap-1 bg-border/30 rounded p-1 w-fit">
          {["All", ...availableMarkets].map((m) => (
            <button
              key={m}
              onClick={() => handleMarketChange(m)}
              className={`px-3 py-1.5 text-sm rounded transition ${
                selectedMarket === m
                  ? "bg-accent text-black font-semibold"
                  : "hover:bg-border/50 text-muted"
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        {/* Min rules slider */}
        <div className="flex items-center gap-3">
          <label className="text-xs text-muted whitespace-nowrap">
            Min rules passed
          </label>
          <input
            type="range"
            min={0}
            max={maxRulesTotal || 16}
            value={minRules}
            onChange={(e) => setMinRules(parseInt(e.target.value))}
            className="w-32 md:w-40 accent-[color:var(--accent)]"
          />
          <span className="num font-semibold text-sm tabular-nums w-14 text-right">
            ≥ {minRules}/{maxRulesTotal || "?"}
          </span>
        </div>
      </section>

      {/* Count */}
      <div className="mb-3 text-sm text-muted">
        <span className="text-text font-semibold">{filtered.length}</span>{" "}
        candidate{filtered.length !== 1 ? "s" : ""} matching{" "}
        {selectedMarket === "All" ? "all markets" : selectedMarket} with ≥{" "}
        {minRules} rules passed
      </div>

      {/* Mobile: stacked cards */}
      <div className="md:hidden space-y-3">
        {filtered.map((r) => (
          <Link
            key={r.ticker}
            href={`/screener/${encodeURIComponent(r.ticker)}`}
            className="card p-4 block active:bg-border/50"
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-lg">{r.ticker}</span>
                  <MarketBadge market={r.market || "US"} />
                  {r.detected && (
                    <span className="px-1.5 py-0.5 bg-accent/20 text-accent text-[10px] rounded uppercase font-semibold">
                      VCP
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted line-clamp-1">
                  {r.company}
                </div>
              </div>
              <div className="flex flex-col gap-1 items-end">
                {(() => {
                  const p = countByCategory(r.rules, PRIMARY_IDS);
                  const s = countByCategory(r.rules, SECONDARY_IDS);
                  return (
                    <>
                      <div className="flex items-center gap-2 text-[10px] text-muted">
                        <span>P</span>
                        <RulesBadge passed={p.passed} total={p.total} compact />
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-muted">
                        <span>S</span>
                        <RulesBadge passed={s.passed} total={s.total} compact />
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
            <ScoreBar score={r.score} />
            <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
              <div>
                <div className="text-muted">Score</div>
                <div className="num font-semibold">{r.score.toFixed(0)}</div>
              </div>
              <div>
                <div className="text-muted">RS</div>
                <div className="num font-semibold">{r.rs_rating}</div>
              </div>
              <div>
                <div className="text-muted">&rarr; Pivot</div>
                <div className="num font-semibold">
                  {fmtNum(r.pct_to_pivot, 1, "%")}
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Desktop: table */}
      <div className="hidden md:block card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-border/30 text-muted text-xs uppercase">
            <tr>
              <th className="text-left px-3 py-2 w-12">Mkt</th>
              <th className="text-left px-3 py-2">Ticker</th>
              <th className="text-left px-3 py-2">Company</th>
              <th className="text-right px-3 py-2 w-24">Primary</th>
              <th className="text-right px-3 py-2 w-24">Secondary</th>
              <th className="text-right px-3 py-2 w-32">Composite</th>
              <th className="text-right px-3 py-2">RS</th>
              <th className="text-right px-3 py-2">VCP</th>
              <th className="text-right px-3 py-2">Price</th>
              <th className="text-right px-3 py-2">&rarr; Pivot</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr
                key={r.ticker}
                className="border-t border-border hover:bg-border/20"
              >
                <td className="px-3 py-2">
                  <MarketBadge market={r.market || "US"} />
                </td>
                <td className="px-3 py-2 font-bold">
                  <Link
                    href={`/screener/${encodeURIComponent(r.ticker)}`}
                    className="hover:text-accent"
                  >
                    {r.ticker}
                  </Link>
                  {r.detected && (
                    <span className="ml-1.5 px-1 py-0.5 bg-accent/20 text-accent text-[9px] rounded uppercase font-semibold align-middle">
                      VCP
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 truncate max-w-[180px]">
                  {r.company}
                </td>
                <td className="px-3 py-2">
                  {(() => {
                    const p = countByCategory(r.rules, PRIMARY_IDS);
                    return <RulesBadge passed={p.passed} total={p.total} compact />;
                  })()}
                </td>
                <td className="px-3 py-2">
                  {(() => {
                    const s = countByCategory(r.rules, SECONDARY_IDS);
                    return <RulesBadge passed={s.passed} total={s.total} compact />;
                  })()}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2 justify-end">
                    <span className="num text-accent font-semibold w-8 text-right">
                      {r.score.toFixed(0)}
                    </span>
                    <div className="w-16">
                      <ScoreBar score={r.score} />
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2 text-right num">{r.rs_rating}</td>
                <td className="px-3 py-2 text-right num text-muted">
                  {fmtNum(r.vcp_quality, 0)}/20
                </td>
                <td className="px-3 py-2 text-right num">
                  {fmtNum(r.current_price, 2)}
                </td>
                <td className="px-3 py-2 text-right num">
                  {fmtNum(r.pct_to_pivot, 1, "%")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="p-8 text-center text-muted text-sm">
            No candidates match the current filter. Lower the slider or switch
            market.
          </div>
        )}
      </div>
    </>
  );
}

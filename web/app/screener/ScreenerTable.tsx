"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Candidate, Meta, RuleResult } from "../types";
import { useLivePrices, fmtLiveTime } from "../lib/useLivePrices";

const MARKET_COLORS: Record<string, string> = {
  US: "bg-blue-500/20 text-blue-400",
  HK: "bg-red-500/20 text-red-400",
  KR: "bg-emerald-500/20 text-emerald-400",
};

// Keep these in sync with RuleScorecard.tsx
const PRIMARY_IDS = [
  "A1_ud_vol_ratio",
  "B1_price_above_150_200",
  "B2_sma150_gt_sma200",
  "B3_sma50_gt_150_200",
  "B4_price_above_sma50",
  "B5_sma200_rising_5mo",
  "B6_30pct_above_52w_low",
  "B7_within_25pct_high",
  "R1_rs_70",
  "L1_liquidity_gate",
  "E7_roe",
  "F1_outperform_1y",
  "H4_ni_cagr_3y",
];
const SECONDARY_IDS = [
  "B8_within_10pct_high",
  "B9_stage2",
  "B10_higher_highs_lows",
  "R2_rs_80",
  "R3_rs_90",
  "V1_atr_contraction",
  "V2_short_term_tightening",
  "L2_liquidity_50m",
  "L3_share_volume",
  "L4_price_floor",
  "P1_tightening",
  "P2_last_contraction",
  "P3_vol_dryup",
  "P4_base_count",
  "P6_monotonic_decreasing",
  "E1_eps_growth",
  "E2_eps_yoy_accel",
  "E3_rev_growth",
  "E4_rev_yoy_accel",
  "E5_op_inc_growing",
  "E6_op_inc_yoy_accel",
  "E8_annual_eps_growth",
  "E9_eps_breakout",
  "E10_inst_ownership",
  "F2_outperform_6m",
  "F3_outperform_1m",
  "H1_short_float",
  "H2_cfps_to_eps",
  "H3_net_margin_high",
];

// Short display names for filter panel (fallback if rule.name unavailable)
const SHORT_NAMES: Record<string, string> = {
  A1_ud_vol_ratio: "U/D Vol Ratio ≥ 1.0 (50d)",
  B1_price_above_150_200: "Price > SMA150 & 200",
  B2_sma150_gt_sma200: "SMA150 > SMA200",
  B3_sma50_gt_150_200: "SMA50 > SMA150 & 200",
  B4_price_above_sma50: "Price > SMA50",
  B5_sma200_rising_5mo: "200SMA rising 4-5mo",
  B6_30pct_above_52w_low: "≥30% above 52W low",
  B7_within_25pct_high: "Within 25% of 52W high",
  B8_within_10pct_high: "Within 10% of 52W high",
  B9_stage2: "Stage 2 (Weinstein)",
  B10_higher_highs_lows: "HH / HL (3+ pairs)",
  R1_rs_70: "RS ≥ 70 (Minervini)",
  R2_rs_80: "RS ≥ 80 (CANSLIM Leader)",
  R3_rs_90: "RS ≥ 90 (Strong)",
  V1_atr_contraction: "ATR Contraction (50/250)",
  V2_short_term_tightening: "Near-term tightening (30/60)",
  L1_liquidity_gate: "Liquidity gate ($ volume)",
  L2_liquidity_50m: "Liquidity ≥ 2.5× threshold",
  L3_share_volume: "Avg shares ≥ 400K",
  L4_price_floor: "Price ≥ $12",
  P1_tightening: "Tightening (n≥3)",
  P2_last_contraction: "Last contr. < 6.5%",
  P3_vol_dryup: "Vol dry-up < 0.6",
  P4_base_count: "Base count ≤ 2",
  P6_monotonic_decreasing: "Contractions ≤0.75× prior",
  E1_eps_growth: "EPS YoY > 18%",
  E2_eps_yoy_accel: "EPS YoY 4Q accel",
  E3_rev_growth: "Sales YoY > 25%",
  E4_rev_yoy_accel: "Sales YoY 4Q accel",
  E5_op_inc_growing: "Op Income 4Q growing",
  E6_op_inc_yoy_accel: "Op Income YoY 4Q accel",
  E7_roe: "ROE ≥ 17%",
  E8_annual_eps_growth: "Annual EPS YoY ≥ 25%",
  E9_eps_breakout: "EPS breakout (>8Q max)",
  E10_inst_ownership: "Inst. own. ≥ 5%",
  F1_outperform_1y: "1Y > NASDAQ",
  F2_outperform_6m: "6M > NASDAQ",
  F3_outperform_1m: "1M > NASDAQ",
  H1_short_float: "Short Float ≤ 5%",
  H2_cfps_to_eps: "CFPS / EPS ≥ 1.20",
  H3_net_margin_high: "Net Margin 5Y high",
  H4_ni_cagr_3y: "3Y NI CAGR ≥ 25%",
};

function countByCategory(
  rules: Record<string, RuleResult> | undefined,
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

// Primary-only thresholds. With 11 Primary rules total (8 cross-market + 3 US-only fundamentals),
// the slider's max equals each row's Primary count and defaults below favor higher-quality candidates.
const DEFAULT_MIN_PRIMARY_BY_MARKET: Record<string, number> = {
  All: 9,
  US: 9,
  HK: 7,
  KR: 7,
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

const INDEX_TICKERS: { symbol: string; label: string; market: string }[] = [
  { symbol: "SPY", label: "S&P 500", market: "US" },
  { symbol: "QQQ", label: "Nasdaq 100", market: "US" },
  { symbol: "^HSI", label: "Hang Seng", market: "HK" },
  { symbol: "^KS11", label: "KOSPI", market: "KR" },
];

function LiveIndexTape() {
  const symbols = useMemo(() => INDEX_TICKERS.map((i) => i.symbol), []);
  const { quotes, asOf, loading } = useLivePrices(symbols);
  return (
    <section className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-muted">Market Tape</div>
        <div className="text-[11px] text-muted flex items-center gap-2">
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full ${loading ? "bg-yellow-400 animate-pulse" : "bg-emerald-400"}`}
          />
          <span>{loading ? "Refreshing" : "Live"} · {fmtLiveTime(asOf)}</span>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {INDEX_TICKERS.map((idx) => {
          const q = quotes[idx.symbol];
          const pct = q?.percentChange ?? null;
          const up = pct !== null && pct >= 0;
          const color =
            pct === null
              ? "text-muted"
              : up
              ? "text-emerald-400"
              : "text-red-400";
          return (
            <div
              key={idx.symbol}
              className="card p-2.5 flex items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <MarketBadge market={idx.market} />
                  <span className="text-xs font-semibold truncate">
                    {idx.label}
                  </span>
                </div>
                <div className="text-[10px] text-muted">{idx.symbol}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="num text-sm font-semibold tabular-nums">
                  {q?.price != null ? q.price.toFixed(2) : "—"}
                </div>
                <div className={`num text-xs tabular-nums ${color}`}>
                  {pct === null
                    ? "—"
                    : `${up ? "+" : ""}${pct.toFixed(2)}%`}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
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

// --- Sorting ---

type SortKey =
  | "primary"
  | "secondary"
  | "score"
  | "rs_rating"
  | "vcp_quality"
  | "current_price"
  | "pct_to_pivot"
  | "ticker";

type SortDir = "asc" | "desc";

function livePrice(
  r: Candidate,
  quotes: Record<string, { price: number | null }>,
): number | null {
  const q = quotes[r.ticker];
  if (q && q.price !== null && q.price !== undefined) return q.price;
  return r.current_price ?? null;
}

function livePctToPivot(
  r: Candidate,
  quotes: Record<string, { price: number | null }>,
): number | null {
  const p = livePrice(r, quotes);
  if (p === null || !r.pivot_price) return r.pct_to_pivot ?? null;
  return (p / r.pivot_price - 1) * 100;
}

function sortValue(
  r: Candidate,
  key: SortKey,
  quotes: Record<string, { price: number | null }>,
): number | string {
  switch (key) {
    case "primary":
      return countByCategory(r.rules, PRIMARY_IDS).passed;
    case "secondary":
      return countByCategory(r.rules, SECONDARY_IDS).passed;
    case "score":
      return r.score ?? 0;
    case "rs_rating":
      return r.rs_rating ?? 0;
    case "vcp_quality":
      return r.vcp_quality ?? 0;
    case "current_price":
      return livePrice(r, quotes) ?? 0;
    case "pct_to_pivot":
      return livePctToPivot(r, quotes) ?? -999;
    case "ticker":
      return r.ticker;
  }
}

function SortHeader({
  label,
  col,
  activeKey,
  activeDir,
  onClick,
  align = "right",
  className = "",
}: {
  label: string;
  col: SortKey;
  activeKey: SortKey;
  activeDir: SortDir;
  onClick: (col: SortKey) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const isActive = activeKey === col;
  const arrow = isActive ? (activeDir === "desc" ? "↓" : "↑") : "";
  return (
    <th
      className={`text-${align} px-3 py-2 cursor-pointer select-none hover:text-accent ${isActive ? "text-accent" : ""} ${className}`}
      onClick={() => onClick(col)}
      title="Click to sort"
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span className="text-[10px] w-2 inline-block">{arrow}</span>
      </span>
    </th>
  );
}

// --- Per-rule 3-state filter panel ---

type FilterState = "any" | "pass" | "fail";

function RuleFilterPanel({
  filters,
  onChange,
  onReset,
  ruleNames,
}: {
  filters: Record<string, FilterState>;
  onChange: (id: string, state: FilterState) => void;
  onReset: () => void;
  ruleNames: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const activeCount = Object.values(filters).filter((v) => v !== "any").length;

  const renderGroup = (title: string, ids: string[]) => (
    <div>
      <div className="text-[11px] text-muted uppercase tracking-wide mb-1.5 mt-2">
        {title}
      </div>
      <div className="space-y-1.5">
        {ids.map((id) => {
          const state = filters[id] ?? "any";
          const label = ruleNames[id] ?? SHORT_NAMES[id] ?? id;
          return (
            <div
              key={id}
              className="flex items-center justify-between gap-2 text-xs"
            >
              <span className="truncate text-text/90">{label}</span>
              <div className="flex gap-1 bg-border/40 rounded p-0.5 shrink-0">
                {(["any", "pass", "fail"] as FilterState[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => onChange(id, s)}
                    className={`px-2 py-0.5 text-[10px] uppercase rounded transition ${
                      state === s
                        ? s === "pass"
                          ? "bg-emerald-400/30 text-emerald-300 font-semibold"
                          : s === "fail"
                          ? "bg-red-400/30 text-red-300 font-semibold"
                          : "bg-accent/30 text-accent font-semibold"
                        : "text-muted hover:text-text"
                    }`}
                  >
                    {s === "any" ? "any" : s === "pass" ? "✓" : "✗"}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <section className="mb-4">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setOpen((o) => !o)}
          className="text-xs px-3 py-1.5 rounded bg-border/40 hover:bg-border/60 font-medium"
        >
          {open ? "▾" : "▸"} Rule Filters
          {activeCount > 0 && (
            <span className="ml-2 px-1.5 py-0.5 rounded bg-accent/30 text-accent text-[10px] font-semibold">
              {activeCount}
            </span>
          )}
        </button>
        {activeCount > 0 && (
          <button
            onClick={onReset}
            className="text-xs text-muted hover:text-red-400"
          >
            Reset
          </button>
        )}
      </div>
      {open && (
        <div className="card p-4 mt-2 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
          {renderGroup("Primary", PRIMARY_IDS)}
          {renderGroup("Secondary", SECONDARY_IDS)}
        </div>
      )}
    </section>
  );
}

// --- Main table ---

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
  const [minRules, setMinRules] = useState<number>(DEFAULT_MIN_PRIMARY_BY_MARKET.All);
  const [sortKey, setSortKey] = useState<SortKey>("primary");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [ruleFilters, setRuleFilters] = useState<Record<string, FilterState>>({});

  // Live prices — pulled on mount and auto-refreshed every 30s
  const allTickers = useMemo(() => rows.map((r) => r.ticker), [rows]);
  const { quotes, asOf, loading: liveLoading } = useLivePrices(allTickers);

  // Build display-name dict from observed rule data (falls back to SHORT_NAMES)
  const ruleNames = useMemo(() => {
    const d: Record<string, string> = {};
    for (const r of rows) {
      if (!r.rules) continue;
      for (const [id, rr] of Object.entries(r.rules)) {
        if (!d[id] && rr.name) d[id] = rr.name;
      }
    }
    return d;
  }, [rows]);

  const handleMarketChange = (m: string) => {
    setSelectedMarket(m);
    setMinRules(DEFAULT_MIN_PRIMARY_BY_MARKET[m] ?? 9);
  };

  const handleSort = (col: SortKey) => {
    if (sortKey === col) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(col);
      setSortDir(col === "ticker" ? "asc" : "desc");
    }
  };

  const setFilter = (id: string, state: FilterState) =>
    setRuleFilters((prev) => ({ ...prev, [id]: state }));

  const resetFilters = () => setRuleFilters({});

  const filtered = useMemo(() => {
    const byMarket =
      selectedMarket === "All"
        ? rows
        : rows.filter((r) => (r.market || "US") === selectedMarket);

    // Filter by Primary rules passed only (Secondary excluded).
    const byMinRules = byMarket.filter((r) => {
      const p = countByCategory(r.rules, PRIMARY_IDS);
      return p.passed >= minRules;
    });

    // Apply per-rule filters
    const activeEntries = Object.entries(ruleFilters).filter(
      ([, v]) => v !== "any",
    );
    const byRuleFilters =
      activeEntries.length === 0
        ? byMinRules
        : byMinRules.filter((r) => {
            if (!r.rules) return false;
            for (const [id, state] of activeEntries) {
              const rr = r.rules[id];
              if (!rr) return false; // rule not evaluated → exclude from filtered results
              if (state === "pass" && !rr.passed) return false;
              if (state === "fail" && rr.passed) return false;
            }
            return true;
          });

    // Sort (live price/pivot values respected)
    const sorted = [...byRuleFilters].sort((a, b) => {
      const va = sortValue(a, sortKey, quotes);
      const vb = sortValue(b, sortKey, quotes);
      let cmp: number;
      if (typeof va === "string" && typeof vb === "string") {
        cmp = va.localeCompare(vb);
      } else {
        cmp = (va as number) - (vb as number);
      }
      return sortDir === "desc" ? -cmp : cmp;
    });

    return sorted;
  }, [rows, selectedMarket, minRules, ruleFilters, sortKey, sortDir, quotes]);

  // Slider max = Primary rule count for the selected market (Secondary excluded by user request).
  const maxPrimary = useMemo(() => {
    const m =
      selectedMarket === "All"
        ? rows
        : rows.filter((r) => (r.market || "US") === selectedMarket);
    return Math.max(
      0,
      ...m.map((r) => countByCategory(r.rules, PRIMARY_IDS).total),
    );
  }, [rows, selectedMarket]);

  const activeFilterCount = Object.values(ruleFilters).filter(
    (v) => v !== "any",
  ).length;

  return (
    <>
      <LiveIndexTape />
      <MarketDirectionBanner meta={meta} />

      {/* Controls */}
      <section className="mb-4 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
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

        <div className="flex items-center gap-3">
          <label className="text-xs text-muted whitespace-nowrap">
            Min Primary passed
          </label>
          <input
            type="range"
            min={0}
            max={maxPrimary || 14}
            value={minRules}
            onChange={(e) => setMinRules(parseInt(e.target.value))}
            className="w-32 md:w-40 accent-[color:var(--accent)]"
          />
          <span className="num font-semibold text-sm tabular-nums w-14 text-right">
            ≥ {minRules}/{maxPrimary || "?"}
          </span>
        </div>
      </section>

      {/* Rule filter panel */}
      <RuleFilterPanel
        filters={ruleFilters}
        onChange={setFilter}
        onReset={resetFilters}
        ruleNames={ruleNames}
      />

      {/* Count + live indicator */}
      <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm text-muted">
          <span className="text-text font-semibold">{filtered.length}</span>{" "}
          candidate{filtered.length !== 1 ? "s" : ""} ·{" "}
          {selectedMarket === "All" ? "all markets" : selectedMarket} · ≥{minRules} rules
          {activeFilterCount > 0 && (
            <> · {activeFilterCount} rule filter{activeFilterCount > 1 ? "s" : ""}</>
          )}
        </div>
        <div className="text-[11px] text-muted flex items-center gap-2">
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full ${liveLoading ? "bg-yellow-400 animate-pulse" : "bg-emerald-400"}`}
          />
          <span>
            {liveLoading ? "Refreshing" : "Live"} · Price as of {fmtLiveTime(asOf)}
          </span>
        </div>
      </div>

      {/* Mobile: stacked cards (sort/filters still apply) */}
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

      {/* Desktop: sortable table */}
      <div className="hidden md:block card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-border/30 text-muted text-xs uppercase">
            <tr>
              <th className="text-left px-3 py-2 w-12">Mkt</th>
              <SortHeader
                label="Ticker"
                col="ticker"
                activeKey={sortKey}
                activeDir={sortDir}
                onClick={handleSort}
                align="left"
              />
              <th className="text-left px-3 py-2">Company</th>
              <SortHeader
                label="Primary"
                col="primary"
                activeKey={sortKey}
                activeDir={sortDir}
                onClick={handleSort}
                className="w-24"
              />
              <SortHeader
                label="Secondary"
                col="secondary"
                activeKey={sortKey}
                activeDir={sortDir}
                onClick={handleSort}
                className="w-24"
              />
              <SortHeader
                label="Composite"
                col="score"
                activeKey={sortKey}
                activeDir={sortDir}
                onClick={handleSort}
                className="w-32"
              />
              <SortHeader
                label="RS"
                col="rs_rating"
                activeKey={sortKey}
                activeDir={sortDir}
                onClick={handleSort}
              />
              <SortHeader
                label="VCP"
                col="vcp_quality"
                activeKey={sortKey}
                activeDir={sortDir}
                onClick={handleSort}
              />
              <SortHeader
                label="Price"
                col="current_price"
                activeKey={sortKey}
                activeDir={sortDir}
                onClick={handleSort}
              />
              <SortHeader
                label="→ Pivot"
                col="pct_to_pivot"
                activeKey={sortKey}
                activeDir={sortDir}
                onClick={handleSort}
              />
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
                  {(() => {
                    const p = countByCategory(r.rules, PRIMARY_IDS);
                    return p.passed >= 12 ? (
                      <Link
                        href={`/research/${encodeURIComponent(r.ticker)}`}
                        className="ml-1.5 px-1 py-0.5 bg-emerald-500/20 text-emerald-400 text-[9px] rounded uppercase font-semibold align-middle hover:bg-emerald-500/30"
                        title={`Research card (${p.passed}/${p.total} Primary)`}
                      >
                        ✨ Research
                      </Link>
                    ) : null;
                  })()}
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
                  {(() => {
                    const p = livePrice(r, quotes);
                    const q = quotes[r.ticker];
                    const isLive = q && q.price !== null && q.price !== undefined;
                    return (
                      <span className={isLive ? "" : "text-muted"}>
                        {fmtNum(p, 2)}
                        {q?.percentChange != null && (
                          <span
                            className={`ml-1 text-[10px] ${q.percentChange >= 0 ? "text-emerald-400" : "text-red-400"}`}
                          >
                            {q.percentChange >= 0 ? "+" : ""}
                            {q.percentChange.toFixed(1)}%
                          </span>
                        )}
                      </span>
                    );
                  })()}
                </td>
                <td className="px-3 py-2 text-right num">
                  {fmtNum(livePctToPivot(r, quotes), 1, "%")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="p-8 text-center text-muted text-sm">
            No candidates match current filters. Adjust slider, market, or rule
            filters.
          </div>
        )}
      </div>
    </>
  );
}

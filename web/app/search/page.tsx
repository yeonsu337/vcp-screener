"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Candidate } from "../types";
import ChartClient from "../screener/[ticker]/ChartClient";
import RuleScorecard from "../screener/[ticker]/RuleScorecard";

const HISTORY_KEY = "vcp_search_history";
const HISTORY_MAX = 10;

const MARKET_COLORS: Record<string, string> = {
  US: "bg-blue-500/20 text-blue-400",
  HK: "bg-red-500/20 text-red-400",
  KR: "bg-emerald-500/20 text-emerald-400",
};

const SOURCE_META: Record<string, { label: string; cls: string; tooltip: string }> = {
  cached: {
    label: "Cached",
    cls: "bg-emerald-500/20 text-emerald-400",
    tooltip: "From daily scan — full 42-rule evaluation",
  },
  "computed+sec": {
    label: "Computed + SEC",
    cls: "bg-blue-500/20 text-blue-400",
    tooltip: "On-demand: chart + SEC EDGAR fundamentals",
  },
  computed: {
    label: "Computed",
    cls: "bg-yellow-500/20 text-yellow-400",
    tooltip: "On-demand: chart-only (no fundamentals)",
  },
};

function loadHistory(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((s) => typeof s === "string").slice(0, HISTORY_MAX) : [];
  } catch {
    return [];
  }
}

function saveHistory(list: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX)));
  } catch {
    /* quota or disabled — ignore */
  }
}

function fmtNum(v: number | null | undefined, digits = 2, suffix = ""): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${v.toFixed(digits)}${suffix}`;
}

function StageBadge({ stage, name }: { stage: number; name: string }) {
  const cls =
    stage === 2
      ? "bg-emerald-500/20 text-emerald-400"
      : stage === 1
        ? "bg-yellow-500/20 text-yellow-400"
        : stage === 4
          ? "bg-red-500/20 text-red-400"
          : "bg-border text-muted";
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase ${cls}`}>
      Stage {stage} · {name}
    </span>
  );
}

export default function SearchPage() {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolvedTicker, setResolvedTicker] = useState<string | null>(null);

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  const runSearch = useCallback(async (rawTicker: string) => {
    const ticker = rawTicker.trim().toUpperCase();
    if (!ticker) return;
    setLoading(true);
    setError(null);
    setCandidate(null);
    setResolvedTicker(ticker);
    try {
      const res = await fetch(`/api/search?ticker=${encodeURIComponent(ticker)}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setCandidate(data as Candidate);
      // Update history (most recent first, dedup)
      setHistory((prev) => {
        const next = [ticker, ...prev.filter((t) => t !== ticker)].slice(0, HISTORY_MAX);
        saveHistory(next);
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runSearch(input);
  };

  const onPickHistory = (t: string) => {
    setInput(t);
    runSearch(t);
  };

  const clearHistory = () => {
    setHistory([]);
    saveHistory([]);
  };

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
  const primaryEvaluable = candidate?.rules
    ? PRIMARY_IDS.filter((id) => candidate.rules?.[id]).length
    : 0;
  const primaryPassed = candidate?.rules
    ? PRIMARY_IDS.filter((id) => candidate.rules?.[id]?.passed).length
    : 0;

  const market = candidate?.market || "US";

  return (
    <main className="max-w-7xl mx-auto px-4 py-6 md:py-10">
      <nav className="mb-4">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted hover:text-accent transition">
          ← Home
        </Link>
      </nav>

      <header className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Search</h1>
        <p className="text-muted text-sm mt-1">
          Evaluate any ticker. Daily-scan cache → on-demand chart + SEC EDGAR (US). All free data.
        </p>
      </header>

      {/* Search form */}
      <form onSubmit={onSubmit} className="card p-4 mb-4">
        <div className="flex gap-2 items-stretch">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Enter ticker (e.g., AAPL, NVDA, 0700.HK, 005930.KS)"
            className="flex-1 bg-transparent border border-border rounded px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:border-accent transition"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="px-4 py-2 rounded bg-accent text-bg font-semibold text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent/90 transition"
          >
            {loading ? "..." : "Search"}
          </button>
        </div>

        {/* History */}
        {history.length > 0 && (
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-muted uppercase tracking-wide">Recent:</span>
            {history.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onPickHistory(t)}
                className="text-xs font-mono px-2 py-0.5 rounded bg-border/40 text-muted hover:text-accent hover:bg-border transition"
              >
                {t}
              </button>
            ))}
            <button
              type="button"
              onClick={clearHistory}
              className="text-[10px] text-muted hover:text-red-400 transition ml-1"
            >
              clear
            </button>
          </div>
        )}
      </form>

      {/* Loading / error */}
      {loading && (
        <div className="card p-6 text-center text-muted text-sm">
          <div className="inline-block w-3 h-3 rounded-full bg-accent animate-pulse mr-2" />
          Loading {resolvedTicker}…
        </div>
      )}

      {error && !loading && (
        <div className="card p-6 text-center">
          <div className="text-red-400 text-sm font-semibold mb-1">Error</div>
          <div className="text-muted text-xs">{error}</div>
        </div>
      )}

      {/* Result */}
      {candidate && !loading && (
        <>
          {/* Header card */}
          <section className="card p-5 mb-5">
            <div className="flex items-baseline gap-3 flex-wrap">
              <h2 className="text-3xl font-bold">{candidate.ticker}</h2>
              <span className="text-muted text-sm">{candidate.company}</span>
              <span
                className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase ${
                  MARKET_COLORS[market] ?? "bg-border text-muted"
                }`}
              >
                {market}
              </span>
              <StageBadge stage={candidate.stage} name={candidate.stage_name} />
              {candidate.source && SOURCE_META[candidate.source] && (
                <span
                  title={SOURCE_META[candidate.source].tooltip}
                  className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase ${SOURCE_META[candidate.source].cls}`}
                >
                  {SOURCE_META[candidate.source].label}
                </span>
              )}
            </div>
            <div className="text-xs text-muted mt-1">
              {candidate.sector || "—"}
              {candidate.sector && candidate.industry ? " · " : ""}
              {candidate.industry || ""}
            </div>

            {/* Stat row */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4">
              <Stat label="Price" value={fmtNum(candidate.current_price, 2)} />
              <Stat
                label="Primary"
                value={`${primaryPassed}/${primaryEvaluable}`}
                color={
                  primaryEvaluable > 0 && primaryPassed / primaryEvaluable >= 0.85
                    ? "text-emerald-400"
                    : primaryEvaluable > 0 && primaryPassed / primaryEvaluable >= 0.65
                      ? "text-yellow-400"
                      : "text-muted"
                }
              />
              <Stat
                label="Total Pass"
                value={`${candidate.rules_passed ?? 0}/${candidate.rules_total ?? 0}`}
              />
              <Stat
                label="RS Rating"
                value={`${candidate.rs_rating}`}
                color={candidate.rs_rating >= 80 ? "text-emerald-400" : candidate.rs_rating >= 70 ? "text-yellow-400" : "text-muted"}
              />
              <Stat
                label="VCP Quality"
                value={`${candidate.vcp_quality}`}
                color={candidate.vcp_quality >= 75 ? "text-emerald-400" : "text-muted"}
              />
            </div>

            {/* CTA links */}
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href={`/screener/${encodeURIComponent(candidate.ticker)}`}
                className="text-xs px-3 py-1.5 rounded border border-border text-muted hover:text-accent hover:border-accent/40 transition"
              >
                Open in Screener →
              </Link>
              {(() => {
                const ratio = primaryEvaluable > 0 ? primaryPassed / primaryEvaluable : 0;
                const eligible = ratio >= 0.85;
                return (
                  <Link
                    href={`/research/${encodeURIComponent(candidate.ticker)}`}
                    className={`text-xs px-3 py-1.5 rounded border transition ${
                      eligible
                        ? "border-accent/40 text-accent hover:bg-accent/10"
                        : "border-border text-muted/60 cursor-not-allowed pointer-events-none"
                    }`}
                  >
                    {eligible ? "Generate Full Research →" : "Research (need Primary ≥ 85%)"}
                  </Link>
                );
              })()}
            </div>
          </section>

          {/* Chart */}
          <section className="card p-4 mb-6 overflow-hidden">
            <ChartClient candidate={candidate} />
          </section>

          {/* Rule Scorecard */}
          <RuleScorecard candidate={candidate} />

          <div className="text-[11px] text-muted leading-relaxed mt-2">
            {candidate.source === "cached" ? (
              <>Data: Daily scan cache · {candidate.rules_total ?? 0}/42 rules evaluated.</>
            ) : candidate.source === "computed+sec" ? (
              <>Data: Yahoo Finance chart + SEC EDGAR XBRL fundamentals (US) ·{" "}
              {candidate.rules_total ?? 0}/42 rules evaluated · E10·H1 unavailable on free APIs.</>
            ) : (
              <>Data: Yahoo Finance chart only · {candidate.rules_total ?? 0}/42 rules evaluated ·
              fundamentals (E1-E9·H2-H4) require the daily screener or SEC fetch (US).</>
            )}
          </div>
        </>
      )}

      <footer className="mt-12 pt-6 border-t border-border text-xs text-muted">
        <p>
          Data: Yahoo Finance + SEC EDGAR (US) · Daily-scan cache when available · 5-min in-process memo · Not investment advice.
        </p>
      </footer>
    </main>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="card p-3">
      <div className="text-[10px] text-muted uppercase tracking-wide">{label}</div>
      <div className={`text-lg num font-bold mt-1 ${color ?? ""}`}>{value}</div>
    </div>
  );
}

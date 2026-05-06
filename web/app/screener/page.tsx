import fs from "fs";
import path from "path";
import Link from "next/link";
import type { Candidate, Meta } from "../types";
import ScreenerTable from "./ScreenerTable";

export const dynamic = "force-static";
export const revalidate = 3600;

function loadData(): { rows: Candidate[]; meta: Meta | null } {
  const dataDir = path.join(process.cwd(), "public", "data");
  const resultsPath = path.join(dataDir, "results.json");
  const metaPath = path.join(dataDir, "meta.json");
  let rows: Candidate[] = [];
  let meta: Meta | null = null;
  try {
    if (fs.existsSync(resultsPath)) {
      rows = JSON.parse(fs.readFileSync(resultsPath, "utf-8"));
    }
    if (fs.existsSync(metaPath)) {
      meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    }
  } catch (e) {
    console.error("data load error", e);
  }
  return { rows, meta };
}

function fmtDate(iso: string | undefined): string {
  if (!iso) return "\u2014";
  const d = new Date(iso);
  return d.toLocaleString("en-US", { timeZone: "UTC", hour12: false }) + " UTC";
}

// Mirror of PRIMARY_IDS from ScreenerTable / RuleScorecard for soft-gate count.
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
  "P6_monotonic_decreasing",
  "E7_roe",
  "F1_outperform_1y",
  "H4_ni_cagr_3y",
];

const SOFT_GATE_THRESHOLD = 12;

function countPrimaryPassed(rules: Candidate["rules"]): number {
  if (!rules) return 0;
  return PRIMARY_IDS.reduce(
    (acc, id) => acc + (rules[id]?.passed ? 1 : 0),
    0,
  );
}

export default function Home() {
  const { rows, meta } = loadData();
  const markets = [...new Set(rows.map((r) => r.market || "US"))].sort();

  // Detected = hard gate; Primary 12+ = soft gate. Sort each by composite score.
  const detected = rows
    .filter((r) => r.detected)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const softGate = rows
    .filter((r) => countPrimaryPassed(r.rules) >= SOFT_GATE_THRESHOLD)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  return (
    <main className="max-w-6xl mx-auto px-4 py-6 md:py-10">
      {/* Top nav */}
      <nav className="mb-4">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-accent transition"
        >
          ← Home
        </Link>
      </nav>

      {/* Header */}
      <header className="mb-6 md:mb-8">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
          VCP Screener
        </h1>
        <p className="text-muted text-sm mt-1">
          Minervini Trend Template + VCP + CANSLIM-style rule ranking
          {markets.length > 0 && <span> &middot; {markets.join(" / ")}</span>}
        </p>
      </header>

      {/* Meta stats */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <div className="card p-3">
          <div className="text-xs text-muted">Total Candidates</div>
          <div className="text-xl md:text-2xl font-bold num">
            {meta?.total_candidates ?? "\u2014"}
          </div>
          {meta?.markets && (
            <div className="text-[10px] text-muted mt-1 space-x-2">
              {Object.entries(meta.markets).map(([m, c]) => (
                <span key={m}>
                  {m}: {c.total}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="card p-3">
          <div className="text-xs text-muted">VCP Detected (hard gate)</div>
          <div className="text-xl md:text-2xl font-bold num text-accent">
            {meta?.vcp_detected ?? detected.length}
          </div>
          <div className="text-[10px] text-muted mt-0.5">
            Minervini VCP pattern + Stage 2
          </div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-muted">
            Soft Gate (Primary {SOFT_GATE_THRESHOLD}+/14)
          </div>
          <div className="text-xl md:text-2xl font-bold num text-emerald-400">
            {softGate.length}
          </div>
          <div className="text-[10px] text-muted mt-0.5">Research auto-generated</div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-muted">Updated</div>
          <div className="text-xs md:text-sm num text-text/80 mt-1">
            {fmtDate(meta?.updated_at)}
          </div>
        </div>
      </section>

      {/* Detected ticker chips \u2014 clickable, jump to chart */}
      {detected.length > 0 && (
        <section className="mb-3">
          <div className="text-[10px] font-semibold text-muted uppercase tracking-wide mb-1.5">
            Hard Gate (VCP Detected)
          </div>
          <div className="flex flex-wrap gap-2">
            {detected.map((r) => (
              <Link
                key={r.ticker}
                href={`/screener/${encodeURIComponent(r.ticker)}`}
                className="inline-flex items-baseline gap-2 px-2.5 py-1 rounded bg-accent/15 border border-accent/40 hover:bg-accent/25 transition text-sm"
                title={`${r.company || ""} \u00b7 Score ${r.score?.toFixed(0) ?? "\u2014"} \u00b7 RS ${r.rs_rating ?? "\u2014"}`}
              >
                <span className="font-bold text-accent">{r.ticker}</span>
                <span className="text-[10px] text-muted">{r.market || "US"}</span>
                <span className="text-xs text-text/80 num">
                  {r.score?.toFixed(0) ?? "\u2014"}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Soft gate ticker chips \u2014 Research-eligible candidates */}
      {softGate.length > 0 && (
        <section className="mb-6">
          <div className="text-[10px] font-semibold text-muted uppercase tracking-wide mb-1.5">
            Soft Gate (Primary {SOFT_GATE_THRESHOLD}+/14) \u2014 chart + research candidates
          </div>
          <div className="flex flex-wrap gap-1.5">
            {softGate.slice(0, 60).map((r) => {
              const passed = countPrimaryPassed(r.rules);
              return (
                <Link
                  key={r.ticker}
                  href={`/screener/${encodeURIComponent(r.ticker)}`}
                  className="inline-flex items-baseline gap-1.5 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 hover:bg-emerald-500/20 transition text-xs"
                  title={`${r.company || ""} \u00b7 Primary ${passed}/14 \u00b7 RS ${r.rs_rating ?? "\u2014"}`}
                >
                  <span className="font-semibold text-emerald-400">{r.ticker}</span>
                  <span className="text-[9px] text-muted num">{passed}/14</span>
                </Link>
              );
            })}
            {softGate.length > 60 && (
              <span className="text-[10px] text-muted self-center">
                +{softGate.length - 60} more
              </span>
            )}
          </div>
        </section>
      )}

      {/* Client-side filter + table */}
      <ScreenerTable rows={rows} meta={meta} />

      {/* Footer */}
      <footer className="mt-10 pt-6 border-t border-border text-xs text-muted">
        <p>
          Data: Finviz (US prefilter) + Yahoo Finance (OHLCV + fundamentals) +
          Wikipedia (HSI) + FDR (KRX) &middot; Updated daily via GitHub Actions
          &middot; Not investment advice.
        </p>
      </footer>
    </main>
  );
}

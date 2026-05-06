import fs from "fs";
import path from "path";
import Link from "next/link";
import type { Candidate } from "../types";

export const dynamic = "force-static";
export const revalidate = 3600;

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
const PRIMARY_THRESHOLD = 12;

type IndexEntry = {
  ticker: string;
  company: string;
  market: string;
  sector: string;
  primary_passed: number;
  primary_total: number;
  generated_at: string;
  llm_status: string;
};

function loadResearchIndex(): IndexEntry[] {
  const p = path.join(process.cwd(), "public", "data", "research", "index.json");
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as IndexEntry[];
  } catch {
    return [];
  }
}

function loadQualifyingCandidates(): Candidate[] {
  const p = path.join(process.cwd(), "public", "data", "results.json");
  if (!fs.existsSync(p)) return [];
  try {
    const rows: Candidate[] = JSON.parse(fs.readFileSync(p, "utf-8"));
    return rows.filter((r) => {
      if (!r.rules) return false;
      const passed = PRIMARY_IDS.reduce(
        (acc, id) => acc + (r.rules?.[id]?.passed ? 1 : 0),
        0,
      );
      return passed >= PRIMARY_THRESHOLD;
    });
  } catch {
    return [];
  }
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
}

export default function ResearchPage() {
  const generated = loadResearchIndex();
  const qualifying = loadQualifyingCandidates();

  const generatedByTicker = new Map(generated.map((g) => [g.ticker, g]));
  const pendingTickers = qualifying.filter((q) => !generatedByTicker.has(q.ticker));

  return (
    <main className="max-w-6xl mx-auto px-4 py-6 md:py-10">
      <nav className="mb-4">
        <Link href="/" className="text-sm text-muted hover:text-accent">
          ← Home
        </Link>
      </nav>

      <header className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
          Company Research
        </h1>
        <p className="text-muted text-sm mt-1">
          5-Tier auto-research for stocks passing {PRIMARY_THRESHOLD}+ of {PRIMARY_IDS.length} Primary
          rules. Data sources: SEC EDGAR (10-K), Yahoo Finance, Wikipedia, Gemini 2.0 Flash (free tier).
        </p>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <div className="card p-3">
          <div className="text-xs text-muted">Auto-Research Generated</div>
          <div className="text-2xl font-bold num text-accent">{generated.length}</div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-muted">Qualifying ({PRIMARY_THRESHOLD}+ Primary)</div>
          <div className="text-2xl font-bold num">{qualifying.length}</div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-muted">Pending Generation</div>
          <div className="text-2xl font-bold num">{pendingTickers.length}</div>
        </div>
      </section>

      {generated.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-3">
            Available Research Cards
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {generated.map((r) => {
              const llmOk = r.llm_status === "ok";
              return (
                <Link
                  key={r.ticker}
                  href={`/research/${encodeURIComponent(r.ticker)}`}
                  className="card p-4 hover:border-accent/40 transition-colors block"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="font-bold text-lg">{r.ticker}</div>
                      <div className="text-xs text-muted">{r.company}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-semibold num text-emerald-400">
                        {r.primary_passed}/{r.primary_total}
                      </div>
                      <div className="text-[10px] text-muted">{r.market}</div>
                    </div>
                  </div>
                  <div className="text-[10px] text-muted">{r.sector}</div>
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/40">
                    <span className="text-[10px] text-muted">{fmtDate(r.generated_at)}</span>
                    <span
                      className={`text-[10px] font-semibold ${
                        llmOk ? "text-emerald-400" : "text-yellow-400"
                      }`}
                    >
                      {llmOk ? "✓ Full" : "⚠ Quant only"}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {pendingTickers.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-3">
            Pending — Will Generate Next Daily Run
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {pendingTickers.map((r) => (
              <div
                key={r.ticker}
                className="card p-4 opacity-70"
              >
                <div className="font-bold">{r.ticker}</div>
                <div className="text-xs text-muted">{r.company}</div>
                <div className="text-[10px] text-muted mt-1">
                  {r.sector} · RS {r.rs_rating}
                </div>
                <div className="text-[10px] text-yellow-400 mt-2">⏳ Queued</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {generated.length === 0 && pendingTickers.length === 0 && (
        <div className="card p-8 text-center text-muted">
          No qualifying candidates yet. Stocks passing {PRIMARY_THRESHOLD}+ Primary rules will
          appear here automatically.
        </div>
      )}

      <footer className="mt-10 pt-6 border-t border-border text-xs text-muted">
        Auto-generated daily via GitHub Actions. Quant sections always populated; LLM sections
        require Gemini API key in repo Secrets. Not investment advice.
      </footer>
    </main>
  );
}

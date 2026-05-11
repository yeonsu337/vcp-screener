import fs from "fs";
import path from "path";
import Link from "next/link";
import { notFound } from "next/navigation";
import ChartClient from "./ChartClient";
import FinancialSummary from "./FinancialSummary";
import RuleScorecard from "./RuleScorecard";
import type { Candidate, TickerFinancials, ChartPayload } from "../../types";

export const dynamic = "force-static";
export const dynamicParams = true;

// Pre-render detected (hard gate) + Primary 12+ (soft gate) tickers.
// Other tickers fall back to dynamic rendering via dynamicParams = true.
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

export async function generateStaticParams() {
  const tickers = new Set<string>();

  // 1) Detected (hard gate) + Primary 12+ (soft gate) from latest scan.
  const p = path.join(process.cwd(), "public", "data", "results.json");
  if (fs.existsSync(p)) {
    try {
      const rows: Candidate[] = JSON.parse(fs.readFileSync(p, "utf-8"));
      for (const r of rows) {
        if (r.detected) {
          tickers.add(r.ticker);
          continue;
        }
        if (!r.rules) continue;
        const passed = PRIMARY_IDS.reduce(
          (acc, id) => acc + (r.rules?.[id]?.passed ? 1 : 0),
          0,
        );
        if (passed >= 12) tickers.add(r.ticker);
      }
    } catch {}
  }

  // 2) Backtest-history tickers — keeps /backtest click-throughs alive even
  // when a ticker has dropped out of the latest scan (e.g., HPE detected
  // 2026-04-28 but excluded today by drawdown filter).
  const hp = path.join(process.cwd(), "public", "data", "detection_history.json");
  if (fs.existsSync(hp)) {
    try {
      const hist: Record<string, unknown> = JSON.parse(fs.readFileSync(hp, "utf-8"));
      for (const t of Object.keys(hist)) tickers.add(t);
    } catch {}
  }

  return Array.from(tickers).map((ticker) => ({ ticker }));
}

function loadFinancials(ticker: string): TickerFinancials | null {
  const safeName = ticker.replace(/\./g, "_");
  const p = path.join(process.cwd(), "public", "data", "financials", `${safeName}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

function loadChartData(ticker: string): ChartPayload | null {
  const safeName = ticker.replace(/\./g, "_");
  const p = path.join(process.cwd(), "public", "data", "charts", `${safeName}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

function loadCandidate(ticker: string): Candidate | null {
  const p = path.join(process.cwd(), "public", "data", "results.json");
  if (!fs.existsSync(p)) return null;
  try {
    const rows: Candidate[] = JSON.parse(fs.readFileSync(p, "utf-8"));
    return rows.find((r) => r.ticker === ticker) ?? null;
  } catch {
    return null;
  }
}

type HistoryEntry = {
  first_detected: string;
  detection_price: number;
  detection_score: number;
  market?: string;
  company?: string;
  last_seen?: string;
  current_price?: number;
  current_score?: number;
  rs_rating?: number;
  exited?: boolean;
  exit_date?: string;
  exit_price?: number;
  exit_reasons?: string[];
  max_return_pct?: number;
};

function loadHistoryEntry(ticker: string): HistoryEntry | null {
  const p = path.join(process.cwd(), "public", "data", "detection_history.json");
  if (!fs.existsSync(p)) return null;
  try {
    const data: Record<string, HistoryEntry> = JSON.parse(fs.readFileSync(p, "utf-8"));
    return data[ticker] ?? null;
  } catch {
    return null;
  }
}

function candidateFromHistory(ticker: string, h: HistoryEntry): Candidate {
  return {
    ticker,
    company: h.company ?? "",
    sector: "",
    industry: "",
    market: h.market ?? "US",
    detected: false,
    stage: 0,
    stage_name: "—",
    score: h.current_score ?? h.detection_score ?? 0,
    vcp_quality: 0,
    rs_rating: h.rs_rating ?? 0,
    num_contractions: 0,
    contractions: [],
    last_contraction_pct: null,
    base_depth_pct: null,
    current_price: h.current_price ?? null,
    pivot_price: null,
    pct_to_pivot: null,
    volume_dryup_ratio: null,
    rs_line_pct_from_high: null,
    rules: {},
    rules_passed: 0,
    rules_total: 0,
    contraction_ranges: [],
    pivot_date: null,
    shakeout_dates: [],
    dryup_ranges: [],
  };
}

export default function TickerPage({ params }: { params: { ticker: string } }) {
  const { ticker } = params;
  const cached = loadCandidate(ticker);
  const history = !cached ? loadHistoryEntry(ticker) : null;
  const candidate = cached ?? (history ? candidateFromHistory(ticker, history) : null);
  const financials = loadFinancials(ticker);
  const chartPayload = loadChartData(ticker);

  if (!candidate) notFound();

  const market = candidate.market || "US";
  const fromHistory = !cached && !!history;

  return (
    <main className="max-w-7xl mx-auto px-4 py-6 md:py-10">
      <nav className="mb-4 flex items-center gap-3 text-sm">
        <Link href="/" className="text-muted hover:text-accent transition">
          ← 홈
        </Link>
        <span className="text-border">/</span>
        <Link href="/screener" className="text-muted hover:text-accent transition">
          스크리너
        </Link>
      </nav>

      <header className="mb-5">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="text-3xl font-bold">{candidate.ticker}</h1>
          <span className="text-muted text-sm">{candidate.company}</span>
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-border text-muted uppercase">
            {market} &middot; Stage {candidate.stage}
          </span>
        </div>
        <div className="text-xs text-muted mt-1">
          {candidate.sector} {candidate.sector && candidate.industry ? " \u00B7 " : ""} {candidate.industry}
        </div>
        {fromHistory && history && (
          <div className="mt-3 p-2.5 rounded border border-yellow-500/30 bg-yellow-500/10 text-xs text-yellow-300">
            <div className="font-semibold mb-1">
              \u26A0 \uD604\uC7AC \uD65C\uC131 VCP \uD6C4\uBCF4 \uC544\uB2D8 \u2014 Backtest \uAE30\uB85D \uAE30\uBC18 \uD45C\uC2DC
            </div>
            <div className="text-yellow-200/80 leading-relaxed">
              \uCD5C\uCD08 \uAC10\uC9C0 {history.first_detected} @ ${history.detection_price.toFixed(2)} \u00B7
              \uB9C8\uC9C0\uB9C9 \uAC10\uC9C0 {history.last_seen ?? "\u2014"} \u00B7
              \uAC10\uC9C0 \uC810\uC218 {history.detection_score.toFixed(1)}
              {history.exited && history.exit_date && (
                <>
                  {" "}\u00B7 <span className="text-red-400">Exit {history.exit_date}</span>
                  {history.exit_reasons?.length ? ` (${history.exit_reasons.join(", ")})` : ""}
                </>
              )}
              {history.max_return_pct !== undefined && (
                <> \u00B7 Peak +{history.max_return_pct.toFixed(1)}%</>
              )}
            </div>
            <div className="text-yellow-200/60 mt-1.5">
              VCP \uB8F0\u00B7Contraction \uD45C\uC2DC\uB294 \uBE44\uD65C\uC131. \uCC28\uD2B8\uB294 \uB77C\uC774\uBE0C OHLCV\uB85C \uC815\uC0C1 \uD45C\uC2DC\uB428.
            </div>
          </div>
        )}
      </header>

      {/* Chart (MarketSmith-style with live price + ratings) */}
      <section className="card p-4 mb-6 overflow-hidden">
        <ChartClient
          candidate={candidate}
          staticData={
            chartPayload
              ? { ohlcv: chartPayload.ohlcv, rs_line: chartPayload.rs_line }
              : null
          }
        />
      </section>

      {/* Rule Scorecard — Primary / Secondary breakdown */}
      <RuleScorecard candidate={candidate} />

      {/* Financials */}
      {financials ? (
        <FinancialSummary data={financials} />
      ) : (
        <div className="card p-6 text-center text-muted text-sm">
          Financial data not available for {ticker}.
        </div>
      )}
    </main>
  );
}

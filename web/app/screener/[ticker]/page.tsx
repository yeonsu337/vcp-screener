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

export async function generateStaticParams() {
  const p = path.join(process.cwd(), "public", "data", "results.json");
  if (!fs.existsSync(p)) return [];
  const rows: Candidate[] = JSON.parse(fs.readFileSync(p, "utf-8"));
  return rows.filter((r) => r.detected).map((r) => ({ ticker: r.ticker }));
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
  const rows: Candidate[] = JSON.parse(fs.readFileSync(p, "utf-8"));
  return rows.find((r) => r.ticker === ticker) ?? null;
}

export default function TickerPage({ params }: { params: { ticker: string } }) {
  const { ticker } = params;
  const candidate = loadCandidate(ticker);
  const financials = loadFinancials(ticker);
  const chartPayload = loadChartData(ticker);

  if (!candidate) notFound();

  const market = candidate.market || "US";

  return (
    <main className="max-w-7xl mx-auto px-4 py-6 md:py-10">
      <nav className="mb-4">
        <Link href="/screener" className="text-sm text-muted hover:text-accent">
          &larr; Back to screener
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

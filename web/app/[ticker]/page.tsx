import fs from "fs";
import path from "path";
import Link from "next/link";
import { notFound } from "next/navigation";
import ChartClient from "./ChartClient";
import type { Candidate, ChartPayload } from "../types";

export const dynamic = "force-static";
export const dynamicParams = true;

export async function generateStaticParams() {
  const dataDir = path.join(process.cwd(), "public", "data");
  const p = path.join(dataDir, "results.json");
  if (!fs.existsSync(p)) return [];
  const rows: Candidate[] = JSON.parse(fs.readFileSync(p, "utf-8"));
  return rows.filter((r) => r.detected).map((r) => ({ ticker: r.ticker }));
}

function loadCandidate(ticker: string): Candidate | null {
  const p = path.join(process.cwd(), "public", "data", "results.json");
  if (!fs.existsSync(p)) return null;
  const rows: Candidate[] = JSON.parse(fs.readFileSync(p, "utf-8"));
  return rows.find((r) => r.ticker === ticker) ?? null;
}

function loadChart(ticker: string): ChartPayload | null {
  // Chart filenames use _ instead of . (e.g. 0700_HK.json for 0700.HK)
  const safeFilename = ticker.replace(/\./g, "_");
  const p = path.join(process.cwd(), "public", "data", "charts", `${safeFilename}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function fmtNum(v: number | null | undefined, digits = 2, suffix = ""): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${v.toFixed(digits)}${suffix}`;
}

export default function TickerPage({ params }: { params: { ticker: string } }) {
  const { ticker } = params;
  const candidate = loadCandidate(ticker);
  const chart = loadChart(ticker);

  if (!candidate) notFound();

  return (
    <main className="max-w-5xl mx-auto px-4 py-6 md:py-10">
      <nav className="mb-4">
        <Link href="/" className="text-sm text-muted hover:text-accent">
          ← Back to screener
        </Link>
      </nav>

      <header className="mb-5">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="text-3xl font-bold">{candidate.ticker}</h1>
          <span className="text-muted text-sm">{candidate.company}</span>
        </div>
        <div className="text-xs text-muted mt-1">
          {candidate.sector} · {candidate.industry}
        </div>
      </header>

      {/* Metrics row */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className="card p-3">
          <div className="text-xs text-muted">VCP Score</div>
          <div className="text-2xl font-bold num text-accent">
            {candidate.score.toFixed(0)}
          </div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-muted">RS Rating</div>
          <div className="text-2xl font-bold num">{candidate.rs_rating}</div>
          <div className="text-xs text-muted num">
            RS Line {fmtNum(candidate.rs_line_pct_from_high, 1, "%")} from high
          </div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-muted">Contractions</div>
          <div className="text-2xl font-bold num">
            {candidate.num_contractions}
          </div>
          <div className="text-xs text-muted num">
            last {fmtNum(candidate.last_contraction_pct, 1, "%")}
          </div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-muted">Base Depth</div>
          <div className="text-2xl font-bold num">
            {fmtNum(candidate.base_depth_pct, 1, "%")}
          </div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-muted">Price / Pivot</div>
          <div className="text-lg font-bold num">
            {fmtNum(candidate.current_price, 2)}
          </div>
          <div className="text-xs text-muted num">
            pivot {fmtNum(candidate.pivot_price, 2)}
          </div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-muted">&rarr; Pivot</div>
          <div className="text-2xl font-bold num">
            {fmtNum(candidate.pct_to_pivot, 1, "%")}
          </div>
          <div className="text-xs text-muted num">
            vol ratio {fmtNum(candidate.volume_dryup_ratio, 2)}
          </div>
        </div>
      </section>

      {/* Contraction sequence */}
      {candidate.contractions.length > 0 && (
        <section className="card p-4 mb-5">
          <div className="text-xs text-muted mb-2">Contraction Sequence</div>
          <div className="flex items-center gap-2 flex-wrap">
            {candidate.contractions.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="px-3 py-1 bg-border/40 rounded num text-sm font-semibold">
                  {c.toFixed(1)}%
                </div>
                {i < candidate.contractions.length - 1 && (
                  <span className="text-muted">→</span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Chart */}
      <section className="card p-3 md:p-4">
        <div className="text-xs text-muted mb-2">Price (1y) — pivot dashed</div>
        {chart ? (
          <ChartClient data={chart.ohlcv} pivot={candidate.pivot_price} />
        ) : (
          <div className="text-muted text-sm p-6 text-center">
            Chart data unavailable for {ticker}.
          </div>
        )}
      </section>
    </main>
  );
}

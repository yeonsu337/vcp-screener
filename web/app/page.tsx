import fs from "fs";
import path from "path";
import Link from "next/link";
import type { Candidate, Meta } from "./types";

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

function fmtNum(v: number | null | undefined, digits = 2, suffix = ""): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "\u2014";
  return `${v.toFixed(digits)}${suffix}`;
}

function fmtDate(iso: string | undefined): string {
  if (!iso) return "\u2014";
  const d = new Date(iso);
  return d.toLocaleString("en-US", { timeZone: "UTC", hour12: false }) + " UTC";
}

function ScoreBar({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score));
  return (
    <div className="w-full h-1.5 bg-border rounded">
      <div
        className="h-1.5 rounded bg-accent"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

const MARKET_COLORS: Record<string, string> = {
  US: "bg-blue-500/20 text-blue-400",
  HK: "bg-red-500/20 text-red-400",
  KR: "bg-emerald-500/20 text-emerald-400",
};

function MarketBadge({ market }: { market: string }) {
  const cls = MARKET_COLORS[market] ?? "bg-border text-muted";
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${cls}`}>
      {market}
    </span>
  );
}

export default function Home() {
  const { rows, meta } = loadData();
  const detected = rows.filter((r) => r.detected);
  const markets = [...new Set(rows.map((r) => r.market || "US"))].sort();

  return (
    <main className="max-w-6xl mx-auto px-4 py-6 md:py-10">
      {/* Header */}
      <header className="mb-6 md:mb-8">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
          VCP Screener
        </h1>
        <p className="text-muted text-sm mt-1">
          Mark Minervini Trend Template + Volatility Contraction Pattern
          {markets.length > 0 && (
            <span> &middot; {markets.join(" / ")}</span>
          )}
        </p>
      </header>

      {/* Meta stats */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="card p-3">
          <div className="text-xs text-muted">VCP Detected</div>
          <div className="text-xl md:text-2xl font-bold num text-accent">
            {meta?.vcp_detected ?? "\u2014"}
          </div>
          {meta?.markets && (
            <div className="text-[10px] text-muted mt-1 space-x-2">
              {Object.entries(meta.markets).map(([m, c]) => (
                <span key={m}>{m}: {c.detected}</span>
              ))}
            </div>
          )}
        </div>
        <div className="card p-3">
          <div className="text-xs text-muted">Total Candidates</div>
          <div className="text-xl md:text-2xl font-bold num">
            {meta?.total_candidates ?? "\u2014"}
          </div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-muted">RS &ge; {meta?.min_rs ?? 70}</div>
          <div className="text-xl md:text-2xl font-bold num">
            {meta?.total_candidates ?? "\u2014"}
          </div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-muted">Updated</div>
          <div className="text-xs md:text-sm num text-text/80 mt-1">
            {fmtDate(meta?.updated_at)}
          </div>
        </div>
      </section>

      {/* Detected VCPs */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">
          VCP Candidates <span className="text-muted font-normal">({detected.length})</span>
        </h2>

        {detected.length === 0 ? (
          <div className="card p-6 text-center text-muted">
            No VCP patterns detected in current scan.
          </div>
        ) : (
          <>
            {/* Mobile: stacked cards */}
            <div className="md:hidden space-y-3">
              {detected.map((r) => (
                <Link
                  key={r.ticker}
                  href={`/${encodeURIComponent(r.ticker)}`}
                  className="card p-4 block active:bg-border/50"
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-lg">{r.ticker}</span>
                        <MarketBadge market={r.market || "US"} />
                      </div>
                      <div className="text-xs text-muted line-clamp-1">{r.company}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-accent font-bold num">{r.score.toFixed(0)}</div>
                      <div className="text-xs text-muted">score</div>
                    </div>
                  </div>
                  <ScoreBar score={r.score} />
                  <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
                    <div>
                      <div className="text-muted">RS</div>
                      <div className="num font-semibold">{r.rs_rating}</div>
                    </div>
                    <div>
                      <div className="text-muted">Contractions</div>
                      <div className="num font-semibold">
                        {r.num_contractions} &middot; {fmtNum(r.last_contraction_pct, 1, "%")}
                      </div>
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
                    <th className="text-right px-3 py-2 w-32">Composite</th>
                    <th className="text-right px-3 py-2">RS</th>
                    <th className="text-right px-3 py-2">VCP</th>
                    <th className="text-right px-3 py-2">Contr.</th>
                    <th className="text-right px-3 py-2">Depth</th>
                    <th className="text-right px-3 py-2">Price</th>
                    <th className="text-right px-3 py-2">&rarr; Pivot</th>
                    <th className="text-right px-3 py-2">RS Line</th>
                  </tr>
                </thead>
                <tbody>
                  {detected.map((r) => (
                    <tr
                      key={r.ticker}
                      className="border-t border-border hover:bg-border/20"
                    >
                      <td className="px-3 py-2">
                        <MarketBadge market={r.market || "US"} />
                      </td>
                      <td className="px-3 py-2 font-bold">
                        <Link href={`/${encodeURIComponent(r.ticker)}`} className="hover:text-accent">
                          {r.ticker}
                        </Link>
                      </td>
                      <td className="px-3 py-2 truncate max-w-[180px]">{r.company}</td>
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
                      <td className="px-3 py-2 text-right num text-muted">{fmtNum(r.vcp_quality, 0)}/20</td>
                      <td className="px-3 py-2 text-right num">{r.num_contractions}</td>
                      <td className="px-3 py-2 text-right num">
                        {fmtNum(r.base_depth_pct, 1, "%")}
                      </td>
                      <td className="px-3 py-2 text-right num">
                        {fmtNum(r.current_price, 2)}
                      </td>
                      <td className="px-3 py-2 text-right num">
                        {fmtNum(r.pct_to_pivot, 1, "%")}
                      </td>
                      <td className="px-3 py-2 text-right num">
                        {fmtNum(r.rs_line_pct_from_high, 1, "%")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* Footer */}
      <footer className="mt-10 pt-6 border-t border-border text-xs text-muted">
        <p>
          Data: Finviz (US prefilter) + Yahoo Finance (OHLCV) + Wikipedia (HSI) + FDR (KRX) &middot;
          Updated daily via GitHub Actions &middot; Not investment advice.
        </p>
      </footer>
    </main>
  );
}

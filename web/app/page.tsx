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
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${v.toFixed(digits)}${suffix}`;
}

function fmtDate(iso: string | undefined): string {
  if (!iso) return "—";
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

export default function Home() {
  const { rows, meta } = loadData();
  const detected = rows.filter((r) => r.detected);

  return (
    <main className="max-w-6xl mx-auto px-4 py-6 md:py-10">
      {/* Header */}
      <header className="mb-6 md:mb-8">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
          VCP Screener
        </h1>
        <p className="text-muted text-sm mt-1">
          Mark Minervini Trend Template + Volatility Contraction Pattern ·
          US stocks (NASDAQ/NYSE/AMEX)
        </p>
      </header>

      {/* Meta stats */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="card p-3">
          <div className="text-xs text-muted">VCP Detected</div>
          <div className="text-xl md:text-2xl font-bold num text-accent">
            {meta?.vcp_detected ?? "—"}
          </div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-muted">Trend Template Pass</div>
          <div className="text-xl md:text-2xl font-bold num">
            {meta?.prefilter_count ?? "—"}
          </div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-muted">RS ≥ {meta?.min_rs ?? 70}</div>
          <div className="text-xl md:text-2xl font-bold num">
            {meta?.total_candidates ?? "—"}
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
                  href={`/${r.ticker}`}
                  className="card p-4 block active:bg-border/50"
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      <div className="font-bold text-lg">{r.ticker}</div>
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
                        {r.num_contractions} · {fmtNum(r.last_contraction_pct, 1, "%")}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted">→ Pivot</div>
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
                    <th className="text-left px-3 py-2">Ticker</th>
                    <th className="text-left px-3 py-2">Company</th>
                    <th className="text-left px-3 py-2">Sector</th>
                    <th className="text-right px-3 py-2 w-32">Score</th>
                    <th className="text-right px-3 py-2">RS</th>
                    <th className="text-right px-3 py-2">Contr.</th>
                    <th className="text-right px-3 py-2">Last %</th>
                    <th className="text-right px-3 py-2">Price</th>
                    <th className="text-right px-3 py-2">Pivot</th>
                    <th className="text-right px-3 py-2">→ Pivot</th>
                    <th className="text-right px-3 py-2">Vol</th>
                  </tr>
                </thead>
                <tbody>
                  {detected.map((r) => (
                    <tr
                      key={r.ticker}
                      className="border-t border-border hover:bg-border/20"
                    >
                      <td className="px-3 py-2 font-bold">
                        <Link href={`/${r.ticker}`} className="hover:text-accent">
                          {r.ticker}
                        </Link>
                      </td>
                      <td className="px-3 py-2 truncate max-w-[180px]">{r.company}</td>
                      <td className="px-3 py-2 text-muted text-xs">{r.sector}</td>
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
                      <td className="px-3 py-2 text-right num">{r.num_contractions}</td>
                      <td className="px-3 py-2 text-right num">
                        {fmtNum(r.last_contraction_pct, 1, "%")}
                      </td>
                      <td className="px-3 py-2 text-right num">
                        {fmtNum(r.current_price, 2)}
                      </td>
                      <td className="px-3 py-2 text-right num">
                        {fmtNum(r.pivot_price, 2)}
                      </td>
                      <td className="px-3 py-2 text-right num">
                        {fmtNum(r.pct_to_pivot, 1, "%")}
                      </td>
                      <td className="px-3 py-2 text-right num">
                        {fmtNum(r.volume_dryup_ratio, 2)}
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
          Data: Finviz (Trend Template prefilter) + Yahoo Finance (OHLCV) ·
          Updated daily via GitHub Actions · Not investment advice.
        </p>
      </footer>
    </main>
  );
}

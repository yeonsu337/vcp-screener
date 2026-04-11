import fs from "fs";
import path from "path";
import Link from "next/link";

export const dynamic = "force-static";
export const revalidate = 3600;

type HistoryEntry = {
  first_detected: string;
  detection_price: number | null;
  detection_score: number | null;
  market: string;
  company: string;
  last_seen: string;
  current_price: number | null;
  current_score: number | null;
  rs_rating: number | null;
};

type BacktestRow = {
  ticker: string;
  company: string;
  market: string;
  first_detected: string;
  days_tracked: number;
  detection_price: number;
  current_price: number;
  return_pct: number;
  detection_score: number;
  current_score: number | null;
  still_active: boolean;
};

function loadHistory(): Record<string, HistoryEntry> {
  const p = path.join(process.cwd(), "public", "data", "detection_history.json");
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return {};
  }
}

function fmtNum(v: number | null | undefined, digits = 2, suffix = ""): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "\u2014";
  return `${v.toFixed(digits)}${suffix}`;
}

function fmtDate(iso: string): string {
  return iso; // YYYY-MM-DD is already clean
}

function daysBetween(a: string, b: string): number {
  return Math.floor(
    (new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24)
  );
}

export default function BacktestPage() {
  const history = loadHistory();
  const today = new Date().toISOString().slice(0, 10);

  // Build backtest rows
  const rows: BacktestRow[] = [];
  for (const [ticker, h] of Object.entries(history)) {
    if (!h.detection_price || !h.current_price) continue;
    const days = daysBetween(h.first_detected, today);
    const ret = ((h.current_price - h.detection_price) / h.detection_price) * 100;
    const lastSeenDays = daysBetween(h.last_seen, today);
    rows.push({
      ticker,
      company: h.company || "",
      market: h.market || "US",
      first_detected: h.first_detected,
      days_tracked: days,
      detection_price: h.detection_price,
      current_price: h.current_price,
      return_pct: ret,
      detection_score: h.detection_score ?? 0,
      current_score: h.current_score ?? null,
      still_active: lastSeenDays <= 1,
    });
  }

  // Sort by return descending
  rows.sort((a, b) => b.return_pct - a.return_pct);

  // Stats
  const total = rows.length;
  const winners = rows.filter((r) => r.return_pct > 0).length;
  const hitRate = total > 0 ? ((winners / total) * 100).toFixed(1) : "\u2014";
  const avgReturn = total > 0
    ? (rows.reduce((s, r) => s + r.return_pct, 0) / total).toFixed(2)
    : "\u2014";
  const bestReturn = total > 0 ? Math.max(...rows.map((r) => r.return_pct)) : 0;
  const worstReturn = total > 0 ? Math.min(...rows.map((r) => r.return_pct)) : 0;
  const active = rows.filter((r) => r.still_active).length;

  return (
    <main className="max-w-6xl mx-auto px-4 py-6 md:py-10">
      <nav className="mb-4">
        <Link href="/" className="text-sm text-muted hover:text-accent">
          &larr; Home
        </Link>
      </nav>

      <header className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
          Backtest &mdash; Screener Performance
        </h1>
        <p className="text-muted text-sm mt-1">
          Tracks return since first VCP detection. Updated daily.
        </p>
      </header>

      {/* Summary stats */}
      <section className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
        <div className="card p-3">
          <div className="text-xs text-muted">Tracked</div>
          <div className="text-2xl font-bold num">{total}</div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-muted">Active Now</div>
          <div className="text-2xl font-bold num text-accent">{active}</div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-muted">Hit Rate</div>
          <div className="text-2xl font-bold num">{hitRate}%</div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-muted">Avg Return</div>
          <div className={`text-2xl font-bold num ${Number(avgReturn) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {avgReturn}%
          </div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-muted">Best</div>
          <div className="text-2xl font-bold num text-emerald-400">
            +{bestReturn.toFixed(1)}%
          </div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-muted">Worst</div>
          <div className="text-2xl font-bold num text-red-400">
            {worstReturn.toFixed(1)}%
          </div>
        </div>
      </section>

      {/* Table */}
      {rows.length === 0 ? (
        <div className="card p-8 text-center text-muted">
          <p>No detection history yet. Run the screener at least once to start tracking.</p>
        </div>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="md:hidden space-y-3 mb-8">
            {rows.map((r) => (
              <div key={r.ticker} className="card p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <Link
                      href={`/screener/${encodeURIComponent(r.ticker)}`}
                      className="font-bold text-lg hover:text-accent"
                    >
                      {r.ticker}
                    </Link>
                    <div className="text-xs text-muted">{r.company}</div>
                  </div>
                  <div className="text-right">
                    <div
                      className={`text-lg font-bold num ${r.return_pct >= 0 ? "text-emerald-400" : "text-red-400"}`}
                    >
                      {r.return_pct >= 0 ? "+" : ""}{r.return_pct.toFixed(1)}%
                    </div>
                    <div className="text-xs text-muted">{r.days_tracked}d</div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <div className="text-muted">Detected</div>
                    <div className="num">{r.first_detected}</div>
                  </div>
                  <div>
                    <div className="text-muted">Entry</div>
                    <div className="num">${r.detection_price.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-muted">Current</div>
                    <div className="num">${r.current_price.toFixed(2)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-border/30 text-muted text-xs uppercase">
                <tr>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2">Mkt</th>
                  <th className="text-left px-3 py-2">Ticker</th>
                  <th className="text-left px-3 py-2">Company</th>
                  <th className="text-right px-3 py-2">Detected</th>
                  <th className="text-right px-3 py-2">Days</th>
                  <th className="text-right px-3 py-2">Entry $</th>
                  <th className="text-right px-3 py-2">Current $</th>
                  <th className="text-right px-3 py-2">Return</th>
                  <th className="text-right px-3 py-2">Score @Det</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.ticker}
                    className="border-t border-border hover:bg-border/20"
                  >
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block w-2 h-2 rounded-full ${r.still_active ? "bg-emerald-400" : "bg-border"}`}
                        title={r.still_active ? "Currently detected" : "No longer detected"}
                      />
                    </td>
                    <td className="px-3 py-2 text-xs text-muted">{r.market}</td>
                    <td className="px-3 py-2 font-bold">
                      <Link
                        href={`/screener/${encodeURIComponent(r.ticker)}`}
                        className="hover:text-accent"
                      >
                        {r.ticker}
                      </Link>
                    </td>
                    <td className="px-3 py-2 truncate max-w-[160px]">{r.company}</td>
                    <td className="px-3 py-2 text-right num text-muted text-xs">
                      {r.first_detected}
                    </td>
                    <td className="px-3 py-2 text-right num">{r.days_tracked}</td>
                    <td className="px-3 py-2 text-right num">
                      {fmtNum(r.detection_price, 2)}
                    </td>
                    <td className="px-3 py-2 text-right num">
                      {fmtNum(r.current_price, 2)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right num font-semibold ${r.return_pct >= 0 ? "text-emerald-400" : "text-red-400"}`}
                    >
                      {r.return_pct >= 0 ? "+" : ""}
                      {r.return_pct.toFixed(1)}%
                    </td>
                    <td className="px-3 py-2 text-right num text-muted">
                      {fmtNum(r.detection_score, 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <footer className="mt-10 pt-6 border-t border-border text-xs text-muted">
        Returns are from first detection date price to most recent close.
        Not investment advice. Past detection does not guarantee future performance.
      </footer>
    </main>
  );
}

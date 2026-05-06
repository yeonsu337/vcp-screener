import fs from "fs";
import path from "path";
import Link from "next/link";
import BacktestTable, { type BacktestRow } from "./BacktestTable";

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
  exited?: boolean;
  exit_date?: string;
  exit_price?: number;
  exit_reasons?: string[];
  // Peak / profit-signal tracking (display only — no auto-exit)
  max_return_pct?: number;
  peak_price?: number;
  return_pct?: number;
  profit_signal_partial?: boolean;
  profit_signal_full?: boolean;
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

function daysBetween(a: string, b: string): number {
  return Math.floor(
    (new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24),
  );
}

export default function BacktestPage() {
  const history = loadHistory();
  const today = new Date().toISOString().slice(0, 10);

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
      exited: h.exited ?? false,
      exit_date: h.exit_date,
      exit_price: h.exit_price,
      exit_reasons: h.exit_reasons,
      max_return_pct: h.max_return_pct,
      peak_price: h.peak_price,
      profit_signal_partial: h.profit_signal_partial,
      profit_signal_full: h.profit_signal_full,
    });
  }

  return (
    <main className="max-w-6xl mx-auto px-4 py-6 md:py-10">
      <nav className="mb-4 flex items-center gap-3 text-sm">
        <Link href="/" className="text-muted hover:text-accent">
          &larr; Home
        </Link>
        <span className="text-border">/</span>
        <Link href="/tracking" className="text-muted hover:text-accent">
          My Tracking
        </Link>
      </nav>

      <header className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
          Backtest &mdash; Screener Performance
        </h1>
        <p className="text-muted text-sm mt-1">
          Tracks return since first VCP detection. Prices refresh every 30s during market hours.
        </p>
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-muted hover:text-accent">
            Exit rules (Minervini · O'Neil · IBD standard)
          </summary>
          <div className="mt-2 p-3 bg-border/20 rounded text-text/80 leading-relaxed">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div>
                <span className="text-red-400 font-semibold">EX1</span> Stop Loss <code className="bg-border/40 px-1">−8%</code> (Minervini/O'Neil ironclad rule)
              </div>
              <div>
                <span className="text-red-400 font-semibold">EX3</span> RS Rating <code>&lt; 40</code> collapse
              </div>
              <div>
                <span className="text-red-400 font-semibold">EX4</span> 50d MA break + volume <code>≥ 1.5×</code> SMA50
              </div>
              <div>
                <span className="text-red-400 font-semibold">EX5</span> Trailing <code>−15%</code> from peak (after peak ≥ +10%)
              </div>
              <div>
                <span className="text-red-400 font-semibold">EX6</span> Absent <code>≥ 10</code> consecutive days
              </div>
              <div>
                <span className="text-yellow-400 font-semibold">⚡ Signals</span> +20% / +25% reached (display only — 10x candidates keep running)
              </div>
            </div>
          </div>
        </details>
      </header>

      <BacktestTable rows={rows} />

      <footer className="mt-10 pt-6 border-t border-border text-xs text-muted">
        Returns are computed from detection date price to live price (falling
        back to last close when markets are shut). Not investment advice. Past
        detection does not guarantee future performance.
      </footer>
    </main>
  );
}

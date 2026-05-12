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
                <span className="text-red-300 font-mono text-[10px] px-1 py-0.5 rounded bg-red-500/20 border border-red-500/40 mr-1">EX1</span>
                −8% 초기 손절 — Minervini ironclad (진입가 대비)
              </div>
              <div>
                <span className="text-orange-300 font-mono text-[10px] px-1 py-0.5 rounded bg-orange-500/20 border border-orange-500/40 mr-1">EX3</span>
                RS &lt; 40 — relative strength collapse
              </div>
              <div>
                <span className="text-red-300 font-mono text-[10px] px-1 py-0.5 rounded bg-red-500/20 border border-red-500/40 mr-1">EX4</span>
                50일선 이탈 + 거래량 ≥ 1.5× SMA50 (O'Neil)
              </div>
              <div>
                <span className="text-amber-300 font-mono text-[10px] px-1 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 mr-1">EX5</span>
                Peak −15% trailing (peak ≥ +10% 이후 작동)
              </div>
              <div>
                <span className="text-slate-300 font-mono text-[10px] px-1 py-0.5 rounded bg-slate-500/20 border border-slate-500/40 mr-1">EX6</span>
                장기 부재 ≥ 20일 (detected + soft-gate 모두 부재 시)
              </div>
              <div>
                <span className="text-red-200 font-mono text-[10px] px-1 py-0.5 rounded bg-red-600/30 border border-red-600/50 mr-1">EX7</span>
                단일일 ≤ −10% 폭락 (gap-down/earnings miss)
              </div>
              <div className="md:col-span-2 mt-1 pt-1 border-t border-border/40">
                <span className="text-yellow-400 font-semibold">⚡ Signals</span> Peak +20% / +25% 도달 — 표시만, 자동 exit 안 함 (10x 종목 보유 가능)
              </div>
              <div className="md:col-span-2 mt-1 text-[11px] text-muted/80">
                v1.2 변경: EX6 absent 10일 → 20일, soft-gate (Stage 2 + RS≥70 + Primary 12+) 종목은 last_seen 유지로 false exit 방지
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

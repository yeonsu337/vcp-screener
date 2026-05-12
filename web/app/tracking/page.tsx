import Link from "next/link";
import TrackingClient from "./TrackingClient";

export const metadata = {
  title: "Tracking — VCP Screener",
  description:
    "Track any ticker manually. Performance is computed against your entry price using the same logic as the backtest.",
};

export default function TrackingPage() {
  return (
    <main className="max-w-7xl mx-auto px-4 py-6 md:py-10">
      <nav className="mb-4">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-accent transition"
        >
          ← Home
        </Link>
      </nav>

      <header className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
          My Tracking List
        </h1>
        <p className="text-muted text-sm mt-1">
          Tickers you track manually. Entry price + start date are saved on
          this device. Live prices update every 30s during market hours.
        </p>
      </header>

      <TrackingClient />

      <footer className="mt-12 pt-6 border-t border-border text-xs text-muted leading-relaxed space-y-2">
        <p>
          <span className="font-semibold text-muted">Status thresholds</span>:
          {" "}
          <span className="text-emerald-400">On Track</span> ret ≥ 0% AND
          drawdown ≥ -7%
          {" · "}
          <span className="text-yellow-400">Warning</span> ret &lt; 0% OR
          drawdown &lt; -7% (after 5-day grace)
          {" · "}
          <span className="text-red-400">Critical</span> ret ≤ -7% OR drawdown
          ≤ -15% (backtest EX1/EX5 aligned)
          {" · "}
          <span>Exited</span> manual exit, frozen.
        </p>
        <p>
          <span className="font-semibold text-muted">Cross-device sync</span>:
          Stored client-side (localStorage), not synced across devices. Use
          <span className="text-accent"> Export JSON</span> on one device
          and <span className="text-accent">Import (Merge)</span> on
          another to transfer your list. Merge keeps the earliest entry
          date + highest seen price per ticker. Not investment advice.
        </p>
      </footer>
    </main>
  );
}

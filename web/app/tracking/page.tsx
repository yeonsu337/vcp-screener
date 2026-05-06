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

      <footer className="mt-12 pt-6 border-t border-border text-xs text-muted leading-relaxed">
        <p>
          Stored client-side (localStorage). Returns computed entry → live
          (falling back to last close). Status uses the same drawdown
          threshold as the backtest (Warning if return &lt; 0 or drawdown
          from high &lt; −15%). Not investment advice.
        </p>
      </footer>
    </main>
  );
}

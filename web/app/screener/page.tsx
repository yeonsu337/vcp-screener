import fs from "fs";
import path from "path";
import Link from "next/link";
import type { Candidate, Meta } from "../types";
import ScreenerTable from "./ScreenerTable";

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

function fmtDate(iso: string | undefined): string {
  if (!iso) return "\u2014";
  const d = new Date(iso);
  return d.toLocaleString("en-US", { timeZone: "UTC", hour12: false }) + " UTC";
}

export default function Home() {
  const { rows, meta } = loadData();
  const markets = [...new Set(rows.map((r) => r.market || "US"))].sort();

  return (
    <main className="max-w-6xl mx-auto px-4 py-6 md:py-10">
      {/* Top nav */}
      <nav className="mb-4">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-accent transition"
        >
          ← Home
        </Link>
      </nav>

      {/* Header */}
      <header className="mb-6 md:mb-8">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
          VCP Screener
        </h1>
        <p className="text-muted text-sm mt-1">
          Minervini Trend Template + VCP + CANSLIM-style rule ranking
          {markets.length > 0 && <span> &middot; {markets.join(" / ")}</span>}
        </p>
      </header>

      {/* Meta stats */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="card p-3">
          <div className="text-xs text-muted">Total Candidates</div>
          <div className="text-xl md:text-2xl font-bold num">
            {meta?.total_candidates ?? "\u2014"}
          </div>
          {meta?.markets && (
            <div className="text-[10px] text-muted mt-1 space-x-2">
              {Object.entries(meta.markets).map(([m, c]) => (
                <span key={m}>
                  {m}: {c.total}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="card p-3">
          <div className="text-xs text-muted">VCP Detected (hard gate)</div>
          <div className="text-xl md:text-2xl font-bold num text-accent">
            {meta?.vcp_detected ?? "\u2014"}
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

      {/* Client-side filter + table */}
      <ScreenerTable rows={rows} meta={meta} />

      {/* Footer */}
      <footer className="mt-10 pt-6 border-t border-border text-xs text-muted">
        <p>
          Data: Finviz (US prefilter) + Yahoo Finance (OHLCV + fundamentals) +
          Wikipedia (HSI) + FDR (KRX) &middot; Updated daily via GitHub Actions
          &middot; Not investment advice.
        </p>
      </footer>
    </main>
  );
}

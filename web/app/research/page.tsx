import fs from "fs";
import path from "path";
import Link from "next/link";
import type { Candidate } from "../types";

export const dynamic = "force-static";
export const revalidate = 3600;

function loadCandidates(): Candidate[] {
  const p = path.join(process.cwd(), "public", "data", "results.json");
  if (!fs.existsSync(p)) return [];
  try {
    const rows: Candidate[] = JSON.parse(fs.readFileSync(p, "utf-8"));
    return rows.filter((r) => r.detected);
  } catch {
    return [];
  }
}

export default function ResearchPage() {
  const candidates = loadCandidates();

  return (
    <main className="max-w-4xl mx-auto px-4 py-10">
      <nav className="mb-6">
        <Link href="/" className="text-sm text-muted hover:text-accent">
          &larr; Home
        </Link>
      </nav>

      <header className="mb-6">
        <h1 className="text-2xl font-bold">Company Research</h1>
        <p className="text-muted text-sm mt-1">
          Financial statements, CANSLIM metrics, and fundamental analysis for VCP candidates.
        </p>
      </header>

      {candidates.length === 0 ? (
        <div className="card p-8 text-center text-muted">
          No candidates available. Run the screener first.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {candidates.map((r) => (
            <Link
              key={r.ticker}
              href={`/screener/${encodeURIComponent(r.ticker)}`}
              className="card p-4 hover:border-accent/40 transition-colors block"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-bold text-lg">{r.ticker}</div>
                  <div className="text-xs text-muted">{r.company}</div>
                  <div className="text-[10px] text-muted mt-1">
                    {r.sector} {r.sector && r.industry ? " \u00B7 " : ""} {r.industry}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-accent font-bold num text-lg">{r.score.toFixed(0)}</div>
                  <div className="text-xs text-muted">RS {r.rs_rating}</div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <footer className="mt-10 pt-6 border-t border-border text-xs text-muted">
        Financial data sourced from Yahoo Finance. Click a ticker to view full
        IS/BS/CF statements + CANSLIM metrics. Updated daily.
      </footer>
    </main>
  );
}

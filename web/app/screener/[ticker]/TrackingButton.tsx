"use client";

import { useEffect, useState } from "react";
import { useTracking } from "../../lib/useTracking";
import type { Candidate } from "../../types";

type Props = {
  candidate: Candidate;
  /** Live price overrides candidate.current_price as the entry. */
  livePrice?: number | null;
};

export default function TrackingButton({ candidate, livePrice }: Props) {
  const { hydrated, isTracking, add, remove } = useTracking();
  const [toast, setToast] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const tracking = isTracking(candidate.ticker);
  const entryPrice = livePrice ?? candidate.current_price;

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(id);
  }, [toast]);

  if (!hydrated) {
    // Avoid hydration mismatch — render a placeholder of identical size.
    return (
      <div className="text-[11px] px-2.5 py-1.5 rounded border border-border text-muted opacity-0 pointer-events-none">
        + Add to Tracking
      </div>
    );
  }

  function onAdd() {
    if (entryPrice == null) {
      setToast("No price available");
      return;
    }
    const res = add({
      ticker: candidate.ticker,
      entry_price: +entryPrice.toFixed(4),
      company: candidate.company,
      market: candidate.market,
      sector: candidate.sector,
    });
    if (res.ok) setToast(`Tracking ${candidate.ticker}`);
    else if (res.reason === "duplicate") setToast("Already tracking");
  }

  function onRemove() {
    if (!confirmRemove) {
      setConfirmRemove(true);
      setTimeout(() => setConfirmRemove(false), 2500);
      return;
    }
    remove(candidate.ticker);
    setConfirmRemove(false);
    setToast("Removed");
  }

  return (
    <div className="relative inline-flex items-center">
      {tracking ? (
        <button
          type="button"
          onClick={onRemove}
          className={`text-[11px] font-semibold px-2.5 py-1.5 rounded border transition ${
            confirmRemove
              ? "border-red-500/60 text-red-400 bg-red-500/10"
              : "border-emerald-500/40 text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20"
          }`}
          title="Click again to remove from tracking"
        >
          {confirmRemove ? "✗ Click to confirm" : "✓ Tracking"}
        </button>
      ) : (
        <button
          type="button"
          onClick={onAdd}
          disabled={entryPrice == null}
          className="text-[11px] font-semibold px-2.5 py-1.5 rounded border border-accent/40 text-accent hover:bg-accent/10 transition disabled:opacity-40 disabled:cursor-not-allowed"
          title={
            entryPrice != null
              ? `Add to tracking at $${entryPrice.toFixed(2)}`
              : "Price unavailable"
          }
        >
          + Add to Tracking
        </button>
      )}

      {toast && (
        <span
          role="status"
          className="absolute left-0 top-full mt-1 text-[10px] whitespace-nowrap bg-bg/95 border border-border rounded px-2 py-1 text-text shadow-lg z-10"
        >
          {toast}
        </span>
      )}
    </div>
  );
}

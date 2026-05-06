"use client";

import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// localStorage-based tracking list.
// Vercel deploys are read-only filesystem, so server-side persistence isn't
// possible without a DB. We use the browser's localStorage to persist the
// tracking entries (entry price + added date) on the user's device. Live
// pricing is fetched on-demand via /api/live-prices, mirroring the backtest
// table's approach.
// ---------------------------------------------------------------------------

export const TRACKING_KEY = "vcp-tracking-list-v1";

export type TrackingEntry = {
  ticker: string;
  added_date: string; // YYYY-MM-DD (UTC)
  entry_price: number;
  high_since_add: number; // running max — updated client-side from live quote
  // Optional metadata pulled from the candidate at add time
  company?: string;
  market?: string;
  sector?: string;
  user_note?: string;
  // Manual exit
  exited?: boolean;
  exit_date?: string;
  exit_price?: number;
  exit_reason?: string;
};

// ---- low-level storage ------------------------------------------------------

function isBrowser() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function loadList(): TrackingEntry[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(TRACKING_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    // Defensive — drop entries missing required fields.
    return arr.filter(
      (e): e is TrackingEntry =>
        e && typeof e.ticker === "string" &&
        typeof e.added_date === "string" &&
        typeof e.entry_price === "number" &&
        typeof e.high_since_add === "number",
    );
  } catch {
    return [];
  }
}

function saveList(list: TrackingEntry[]) {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(TRACKING_KEY, JSON.stringify(list));
  } catch {
    /* quota exceeded — ignore */
  }
}

// ---- broadcast across same-tab subscribers ---------------------------------
// localStorage 'storage' event only fires across tabs, so we use a custom
// event for in-tab sync (e.g. button on /screener/[ticker] adding while
// the /tracking page is open in same tab is unlikely, but we still want
// the button on a candidate page to reflect "Tracking ✓" immediately).
const TRACK_EVENT = "vcp-tracking-changed";

function broadcast() {
  if (!isBrowser()) return;
  window.dispatchEvent(new CustomEvent(TRACK_EVENT));
}

// ---- public hook ------------------------------------------------------------

export function useTracking() {
  const [list, setList] = useState<TrackingEntry[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setList(loadList());
    setHydrated(true);
    const onChange = () => setList(loadList());
    if (isBrowser()) {
      window.addEventListener(TRACK_EVENT, onChange);
      window.addEventListener("storage", onChange);
    }
    return () => {
      if (isBrowser()) {
        window.removeEventListener(TRACK_EVENT, onChange);
        window.removeEventListener("storage", onChange);
      }
    };
  }, []);

  const add = useCallback(
    (entry: Omit<TrackingEntry, "added_date" | "high_since_add"> & {
      added_date?: string;
      high_since_add?: number;
    }) => {
      const today =
        entry.added_date ?? new Date().toISOString().slice(0, 10);
      const high = entry.high_since_add ?? entry.entry_price;
      const next = loadList();
      // Prevent duplicates (active entries only — let user re-add an exited
      // ticker to start a new run).
      if (next.some((e) => e.ticker === entry.ticker && !e.exited)) {
        return { ok: false, reason: "duplicate" as const };
      }
      next.push({
        ticker: entry.ticker,
        added_date: today,
        entry_price: entry.entry_price,
        high_since_add: high,
        company: entry.company,
        market: entry.market,
        sector: entry.sector,
        user_note: entry.user_note,
        exited: false,
      });
      saveList(next);
      setList(next);
      broadcast();
      return { ok: true as const };
    },
    [],
  );

  const remove = useCallback((ticker: string) => {
    const next = loadList().filter((e) => e.ticker !== ticker || e.exited);
    saveList(next);
    setList(next);
    broadcast();
  }, []);

  const exit = useCallback(
    (ticker: string, exitPrice: number, reason?: string) => {
      const today = new Date().toISOString().slice(0, 10);
      const next = loadList().map((e) =>
        e.ticker === ticker && !e.exited
          ? {
              ...e,
              exited: true,
              exit_date: today,
              exit_price: exitPrice,
              exit_reason: reason,
            }
          : e,
      );
      saveList(next);
      setList(next);
      broadcast();
    },
    [],
  );

  const reactivate = useCallback((ticker: string) => {
    // Permanently remove an exited entry (so the ticker can be re-added).
    const next = loadList().filter(
      (e) => !(e.ticker === ticker && e.exited),
    );
    saveList(next);
    setList(next);
    broadcast();
  }, []);

  // Update the running high for a ticker if the current price exceeds it.
  // Called from the tracking page after live prices arrive.
  const updateHighs = useCallback((highs: Record<string, number>) => {
    const cur = loadList();
    let changed = false;
    const next = cur.map((e) => {
      if (e.exited) return e;
      const h = highs[e.ticker];
      if (h !== undefined && h > e.high_since_add) {
        changed = true;
        return { ...e, high_since_add: h };
      }
      return e;
    });
    if (changed) {
      saveList(next);
      setList(next);
      // Don't broadcast — would cause infinite render loop on subscribers
      // that compute prices.
    }
  }, []);

  const clearAll = useCallback(() => {
    saveList([]);
    setList([]);
    broadcast();
  }, []);

  const isTracking = useCallback(
    (ticker: string) => list.some((e) => e.ticker === ticker && !e.exited),
    [list],
  );

  return {
    list,
    hydrated,
    add,
    remove,
    exit,
    reactivate,
    updateHighs,
    clearAll,
    isTracking,
  };
}

// ---- pure helpers (used by table) ------------------------------------------

export function daysBetween(a: string, b: string): number {
  return Math.floor(
    (new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24),
  );
}

export function computeReturn(entry: number, current: number): number {
  if (entry <= 0) return 0;
  return (current / entry - 1) * 100;
}

export function computeDrawdown(high: number, current: number): number {
  if (high <= 0) return 0;
  return (current / high - 1) * 100;
}

// Backtest-aligned thresholds: drawdown -15%, no RS / absent-day equivalent
// possible client-side because we don't know if the screener still flags it.
// We surface ON_TRACK / WARNING signals only.
export type TrackStatus = "ON_TRACK" | "WARNING" | "EXITED";

export function computeStatus(
  ret: number,
  drawdown: number,
  exited: boolean,
): TrackStatus {
  if (exited) return "EXITED";
  if (ret < 0 || drawdown < -15) return "WARNING";
  return "ON_TRACK";
}

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

  /**
   * Merge an imported entry set into the current list. Strategy:
   *  - For each imported entry, if a matching ticker exists in the current
   *    list (active state matched), keep whichever has the EARLIER
   *    added_date (preserves the original entry timestamp) and the HIGHER
   *    high_since_add (since high is a running max).
   *  - Otherwise append.
   * Exited entries are matched on ticker+exit_date+added_date triple to
   * avoid collapsing distinct trade runs.
   */
  const merge = useCallback((incoming: TrackingEntry[]): ImportResult => {
    const cur = loadList();
    const out = [...cur];
    let imported = 0;
    let merged = 0;

    const activeIdxByTicker: Record<string, number> = {};
    out.forEach((e, i) => {
      if (!e.exited) activeIdxByTicker[e.ticker] = i;
    });

    const exitedKey = (e: TrackingEntry) =>
      `${e.ticker}|${e.added_date}|${e.exit_date ?? ""}`;
    const exitedSet = new Set(
      out.filter((e) => e.exited).map(exitedKey),
    );

    for (const inc of incoming) {
      if (inc.exited) {
        if (exitedSet.has(exitedKey(inc))) continue;
        out.push(inc);
        imported += 1;
        continue;
      }
      const existingIdx = activeIdxByTicker[inc.ticker];
      if (existingIdx === undefined) {
        out.push(inc);
        imported += 1;
      } else {
        const cur = out[existingIdx];
        out[existingIdx] = {
          ...cur,
          added_date:
            cur.added_date < inc.added_date ? cur.added_date : inc.added_date,
          entry_price:
            cur.added_date < inc.added_date ? cur.entry_price : inc.entry_price,
          high_since_add: Math.max(cur.high_since_add, inc.high_since_add),
          company: cur.company ?? inc.company,
          market: cur.market ?? inc.market,
          sector: cur.sector ?? inc.sector,
          user_note: cur.user_note ?? inc.user_note,
        };
        merged += 1;
      }
    }
    saveList(out);
    setList(out);
    broadcast();
    return { ok: true, imported, merged };
  }, []);

  const replaceAll = useCallback((incoming: TrackingEntry[]): ImportResult => {
    saveList(incoming);
    setList(incoming);
    broadcast();
    return { ok: true, imported: incoming.length, merged: 0 };
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
    merge,
    replaceAll,
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

// Backtest-aligned thresholds, two-step.
//   ON_TRACK       — ret ≥ 0% AND drawdown ≥ -7%
//   EARLY_WARNING  — small loss / minor drawdown (yellow)
//   CRITICAL       — backtest-grade breakdown: ret ≤ -7% OR drawdown ≤ -15%
//   EXITED         — manual exit, frozen
//
// Grace period: within GRACE_DAYS of added_date, EARLY_WARNING is suppressed
// (early noise doesn't trigger an alert); CRITICAL still fires on real
// breakdowns. Aligned with the backtest EX1 stop -8% and EX5 trailing -15%.
export type TrackStatus =
  | "ON_TRACK"
  | "EARLY_WARNING"
  | "CRITICAL"
  | "EXITED";

export const GRACE_DAYS = 5;
export const EARLY_WARNING_RETURN_PCT = 0;
export const EARLY_WARNING_DRAWDOWN_PCT = -7;
export const CRITICAL_RETURN_PCT = -7;
export const CRITICAL_DRAWDOWN_PCT = -15;

export function computeStatus(
  ret: number,
  drawdown: number,
  exited: boolean,
  daysHeld: number = 999,
): TrackStatus {
  if (exited) return "EXITED";
  if (ret <= CRITICAL_RETURN_PCT || drawdown <= CRITICAL_DRAWDOWN_PCT) {
    return "CRITICAL";
  }
  if (daysHeld < GRACE_DAYS) return "ON_TRACK";
  if (ret < EARLY_WARNING_RETURN_PCT || drawdown < EARLY_WARNING_DRAWDOWN_PCT) {
    return "EARLY_WARNING";
  }
  return "ON_TRACK";
}

// ---- import / export helpers (cross-device transfer stopgap) ---------------

export type TrackingExport = {
  $schema: "vcp-tracking.v1";
  exported_at: string;
  count: number;
  entries: TrackingEntry[];
};

export function buildExport(list: TrackingEntry[]): TrackingExport {
  return {
    $schema: "vcp-tracking.v1",
    exported_at: new Date().toISOString(),
    count: list.length,
    entries: list,
  };
}

export type ImportResult = {
  ok: boolean;
  imported?: number;
  merged?: number;
  reason?: string;
};

/**
 * Parse + validate an exported tracking JSON. Returns the entries array on
 * success, or a reason string on failure. Strict: rejects unknown $schema
 * or missing required fields per entry.
 */
export function parseImport(raw: string):
  | { ok: true; entries: TrackingEntry[] }
  | { ok: false; reason: string } {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "invalid JSON" };
  }
  if (!data || typeof data !== "object") {
    return { ok: false, reason: "not a tracking export object" };
  }
  const obj = data as { $schema?: string; entries?: unknown };
  if (obj.$schema !== "vcp-tracking.v1") {
    return { ok: false, reason: `unknown schema: ${obj.$schema ?? "missing"}` };
  }
  if (!Array.isArray(obj.entries)) {
    return { ok: false, reason: "entries is not an array" };
  }
  const out: TrackingEntry[] = [];
  for (const e of obj.entries) {
    if (
      !e ||
      typeof e !== "object" ||
      typeof (e as TrackingEntry).ticker !== "string" ||
      typeof (e as TrackingEntry).added_date !== "string" ||
      typeof (e as TrackingEntry).entry_price !== "number" ||
      typeof (e as TrackingEntry).high_since_add !== "number"
    ) {
      continue;
    }
    out.push(e as TrackingEntry);
  }
  return { ok: true, entries: out };
}

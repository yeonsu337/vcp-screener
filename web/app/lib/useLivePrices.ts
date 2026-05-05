"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type LiveQuote = {
  symbol: string;
  price: number | null;
  change: number | null;
  percentChange: number | null;
  volume: number | null;
  currency?: string;
  marketState?: string;
};

export type LivePricesMap = Record<string, LiveQuote>;

type UseLivePricesOptions = {
  refreshMs?: number; // default 30s
  enabled?: boolean;
};

export function useLivePrices(
  tickers: string[],
  { refreshMs = 30_000, enabled = true }: UseLivePricesOptions = {},
): {
  quotes: LivePricesMap;
  asOf: Date | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const [quotes, setQuotes] = useState<LivePricesMap>({});
  const [asOf, setAsOf] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stable key so effect doesn't refire on array identity change
  const key = tickers.slice().sort().join(",");
  const abortRef = useRef<AbortController | null>(null);

  const doFetch = useCallback(async () => {
    if (!enabled || !key) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/live-prices?tickers=${encodeURIComponent(key)}`,
        { signal: ctrl.signal },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const quoteList: LiveQuote[] = data.quotes ?? [];
      const map: LivePricesMap = {};
      for (const q of quoteList) {
        map[q.symbol] = q;
      }
      setQuotes(map);
      setAsOf(data.asOf ? new Date(data.asOf) : new Date());
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  useEffect(() => {
    doFetch();
    if (!enabled || refreshMs <= 0) return;
    const id = setInterval(doFetch, refreshMs);
    return () => clearInterval(id);
  }, [doFetch, refreshMs, enabled]);

  return { quotes, asOf, loading, error, refresh: doFetch };
}

export function fmtLiveTime(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleTimeString("en-US", { hour12: false });
}

import { NextRequest, NextResponse } from "next/server";

// Yahoo Finance v8 chart endpoint — no auth / crumb required.
// v7/finance/quote now returns 401 without a cookie+crumb pair, so we
// fan out to the chart endpoint per symbol and pull meta fields.
const YF_CHART = "https://query1.finance.yahoo.com/v8/finance/chart";

const CACHE = new Map<string, { t: number; data: LiveQuote[] }>();
const TTL_MS = 30_000;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export type LiveQuote = {
  symbol: string;
  price: number | null;
  change: number | null;
  percentChange: number | null;
  volume: number | null;
  currency?: string;
  marketState?: string;
};

type ChartMeta = {
  symbol?: string;
  regularMarketPrice?: number;
  chartPreviousClose?: number;
  previousClose?: number;
  regularMarketVolume?: number;
  currency?: string;
  marketState?: string;
};

async function fetchChartOne(symbol: string): Promise<LiveQuote> {
  // 1m bars + includePrePost=true so the last bar reflects the most recent
  // trade in pre/regular/post sessions. Falls back to meta.regularMarketPrice
  // when intraday bars are unavailable (e.g. illiquid name, indices).
  const url =
    `${YF_CHART}/${encodeURIComponent(symbol)}` +
    `?interval=1m&range=1d&includePrePost=true`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    return {
      symbol,
      price: null,
      change: null,
      percentChange: null,
      volume: null,
    };
  }
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  const meta: ChartMeta | undefined = result?.meta;
  if (!meta) {
    return {
      symbol,
      price: null,
      change: null,
      percentChange: null,
      volume: null,
    };
  }
  // Last non-null close from the 1m series — captures pre/post-market trades.
  const closes: (number | null)[] = result?.indicators?.quote?.[0]?.close ?? [];
  let lastClose: number | null = null;
  for (let i = closes.length - 1; i >= 0; i--) {
    const v = closes[i];
    if (v != null && Number.isFinite(v)) {
      lastClose = v;
      break;
    }
  }
  const price = lastClose ?? meta.regularMarketPrice ?? null;
  const prev = meta.chartPreviousClose ?? meta.previousClose ?? null;
  const change = price !== null && prev !== null ? price - prev : null;
  const pct =
    price !== null && prev && prev !== 0 ? ((price - prev) / prev) * 100 : null;
  return {
    symbol: meta.symbol || symbol,
    price,
    change,
    percentChange: pct,
    volume: meta.regularMarketVolume ?? null,
    currency: meta.currency,
    marketState: meta.marketState,
  };
}

async function fetchBatch(symbols: string[]): Promise<LiveQuote[]> {
  // Run in parallel, bounded concurrency of 10 to avoid rate limits.
  const out: LiveQuote[] = new Array(symbols.length);
  const CONC = 10;
  let idx = 0;
  async function worker() {
    while (idx < symbols.length) {
      const i = idx++;
      try {
        out[i] = await fetchChartOne(symbols[i]);
      } catch {
        out[i] = {
          symbol: symbols[i],
          price: null,
          change: null,
          percentChange: null,
          volume: null,
        };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONC, symbols.length) }, worker));
  return out;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const tickersParam = url.searchParams.get("tickers") || "";
  const tickers = tickersParam
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  if (tickers.length === 0) {
    return NextResponse.json(
      { error: "missing ?tickers= param" },
      { status: 400 },
    );
  }
  if (tickers.length > 200) {
    return NextResponse.json(
      { error: "max 200 tickers per request" },
      { status: 400 },
    );
  }

  const key = tickers.slice().sort().join(",");
  const now = Date.now();
  const cached = CACHE.get(key);
  if (cached && now - cached.t < TTL_MS) {
    return NextResponse.json(
      {
        quotes: cached.data,
        cached: true,
        asOf: new Date(cached.t).toISOString(),
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        },
      },
    );
  }

  try {
    const all = await fetchBatch(tickers);
    CACHE.set(key, { t: now, data: all });
    return NextResponse.json(
      { quotes: all, cached: false, asOf: new Date(now).toISOString() },
      {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        },
      },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

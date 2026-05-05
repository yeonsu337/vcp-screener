import { NextRequest, NextResponse } from "next/server";

const YF_CHART = "https://query1.finance.yahoo.com/v8/finance/chart";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const CACHE = new Map<string, { t: number; data: ChartResponse }>();
const TTL_MS = 5 * 60 * 1000; // 5 min for chart data

type OhlcvBar = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type OutperformPeriod = {
  period: "1M" | "3M" | "YTD";
  stock_return_pct: number | null;
  benchmark_return_pct: number | null;
  outperform_pct: number | null;
};

type OutperformBlock = {
  benchmark_symbol: string;
  benchmark_label: string;
  periods: OutperformPeriod[];
};

type ChartResponse = {
  ticker: string;
  ohlcv: OhlcvBar[];
  rs_line: { time: string; value: number }[];
  outperform: {
    index: OutperformBlock;
    sector: OutperformBlock | null;
  };
};

const BENCHMARK: Record<string, { symbol: string; label: string }> = {
  US: { symbol: "SPY", label: "S&P 500" },
  HK: { symbol: "^HSI", label: "Hang Seng" },
  KR: { symbol: "^KS11", label: "KOSPI" },
};

// Yahoo industry/sector → SPDR sector ETF. US only (HK/KR lack equivalent free ETFs).
const SECTOR_ETF: Record<string, { symbol: string; label: string }> = {
  Technology: { symbol: "XLK", label: "Technology" },
  "Consumer Cyclical": { symbol: "XLY", label: "Consumer Discretionary" },
  "Consumer Defensive": { symbol: "XLP", label: "Consumer Staples" },
  "Financial Services": { symbol: "XLF", label: "Financials" },
  "Healthcare": { symbol: "XLV", label: "Health Care" },
  "Industrials": { symbol: "XLI", label: "Industrials" },
  "Energy": { symbol: "XLE", label: "Energy" },
  "Utilities": { symbol: "XLU", label: "Utilities" },
  "Basic Materials": { symbol: "XLB", label: "Materials" },
  "Real Estate": { symbol: "XLRE", label: "Real Estate" },
  "Communication Services": { symbol: "XLC", label: "Communication" },
};

function detectMarket(ticker: string): string {
  if (ticker.endsWith(".HK")) return "HK";
  if (ticker.endsWith(".KS") || ticker.endsWith(".KQ")) return "KR";
  return "US";
}

async function fetchOhlcv(
  symbol: string,
  range = "1y",
  interval = "1d",
): Promise<OhlcvBar[]> {
  const url = `${YF_CHART}/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) return [];
  const timestamps: number[] = result.timestamp ?? [];
  const q = result.indicators?.quote?.[0] ?? {};
  const bars: OhlcvBar[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const o = q.open?.[i];
    const h = q.high?.[i];
    const l = q.low?.[i];
    const c = q.close?.[i];
    const v = q.volume?.[i];
    if (o == null || h == null || l == null || c == null) continue;
    const d = new Date(timestamps[i] * 1000);
    const time = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    bars.push({
      time,
      open: +o.toFixed(4),
      high: +h.toFixed(4),
      low: +l.toFixed(4),
      close: +c.toFixed(4),
      volume: Math.round(v ?? 0),
    });
  }
  return bars;
}

function computeRsLine(
  stock: OhlcvBar[],
  bench: OhlcvBar[],
): { time: string; value: number }[] {
  const benchMap = new Map(bench.map((b) => [b.time, b.close]));
  const pairs: { time: string; sc: number; bc: number }[] = [];
  for (const bar of stock) {
    const bc = benchMap.get(bar.time);
    if (bc) pairs.push({ time: bar.time, sc: bar.close, bc });
  }
  if (pairs.length < 10) return [];
  const base = pairs[0].sc / pairs[0].bc;
  return pairs.map((p) => ({
    time: p.time,
    value: +((p.sc / p.bc / base) * 100).toFixed(2),
  }));
}

/**
 * Return % change of a series over the last `tradingDays` bars.
 * Returns null if not enough data.
 */
function returnOverDays(bars: OhlcvBar[], tradingDays: number): number | null {
  if (bars.length < 2) return null;
  const end = bars[bars.length - 1].close;
  const startIdx = Math.max(0, bars.length - 1 - tradingDays);
  const start = bars[startIdx].close;
  if (!start) return null;
  return +((end / start - 1) * 100).toFixed(2);
}

/**
 * Return % change from start of current calendar year.
 */
function ytdReturn(bars: OhlcvBar[]): number | null {
  if (bars.length < 2) return null;
  const lastYear = bars[bars.length - 1].time.slice(0, 4);
  const first = bars.find((b) => b.time.startsWith(lastYear));
  if (!first) return null;
  const end = bars[bars.length - 1].close;
  if (!first.close) return null;
  return +((end / first.close - 1) * 100).toFixed(2);
}

function computeOutperform(
  stock: OhlcvBar[],
  bench: OhlcvBar[],
): OutperformPeriod[] {
  const def: { period: "1M" | "3M" | "YTD"; compute: (b: OhlcvBar[]) => number | null }[] = [
    { period: "1M", compute: (b) => returnOverDays(b, 21) },
    { period: "3M", compute: (b) => returnOverDays(b, 63) },
    { period: "YTD", compute: (b) => ytdReturn(b) },
  ];
  return def.map(({ period, compute }) => {
    const sr = compute(stock);
    const br = compute(bench);
    const op = sr !== null && br !== null ? +(sr - br).toFixed(2) : null;
    return {
      period,
      stock_return_pct: sr,
      benchmark_return_pct: br,
      outperform_pct: op,
    };
  });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const ticker = url.searchParams.get("ticker")?.trim();
  const sector = url.searchParams.get("sector")?.trim();
  if (!ticker) {
    return NextResponse.json(
      { error: "missing ?ticker= param" },
      { status: 400 },
    );
  }

  // Cache key includes sector (different sector → different payload)
  const cacheKey = `${ticker}|${sector ?? ""}`;
  const cached = CACHE.get(cacheKey);
  if (cached && Date.now() - cached.t < TTL_MS) {
    return NextResponse.json(cached.data, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  }

  try {
    const market = detectMarket(ticker);
    const benchInfo = BENCHMARK[market] ?? BENCHMARK.US;
    const sectorInfo = sector && market === "US" ? SECTOR_ETF[sector] : null;

    const fetches = [
      fetchOhlcv(ticker),
      fetchOhlcv(benchInfo.symbol),
      sectorInfo ? fetchOhlcv(sectorInfo.symbol) : Promise.resolve([]),
    ] as const;
    const [stockBars, benchBars, sectorBars] = await Promise.all(fetches);

    if (!stockBars.length) {
      return NextResponse.json(
        { error: `No data for ${ticker}` },
        { status: 404 },
      );
    }

    const rs_line = computeRsLine(stockBars, benchBars);
    const indexOutperform: OutperformBlock = {
      benchmark_symbol: benchInfo.symbol,
      benchmark_label: benchInfo.label,
      periods: computeOutperform(stockBars, benchBars),
    };
    const sectorOutperform: OutperformBlock | null =
      sectorInfo && sectorBars.length > 0
        ? {
            benchmark_symbol: sectorInfo.symbol,
            benchmark_label: sectorInfo.label,
            periods: computeOutperform(stockBars, sectorBars),
          }
        : null;

    const payload: ChartResponse = {
      ticker,
      ohlcv: stockBars,
      rs_line,
      outperform: {
        index: indexOutperform,
        sector: sectorOutperform,
      },
    };
    CACHE.set(cacheKey, { t: Date.now(), data: payload });
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

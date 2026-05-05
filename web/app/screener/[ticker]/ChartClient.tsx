"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  LineStyle,
  type IChartApi,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import type { OhlcvBar, RsLinePoint, Candidate } from "../../types";
import { useLivePrices, fmtLiveTime } from "../../lib/useLivePrices";

// ---------------------------------------------------------------------------
// SMA helper
// ---------------------------------------------------------------------------
function sma(bars: OhlcvBar[], window: number) {
  const out: { time: Time; value: number }[] = [];
  if (bars.length < window) return out;
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].close;
    if (i >= window) sum -= bars[i - window].close;
    if (i >= window - 1) {
      out.push({ time: bars[i].time as Time, value: +(sum / window).toFixed(4) });
    }
  }
  return out;
}

function volSma(bars: OhlcvBar[], window: number) {
  const out: { time: Time; value: number }[] = [];
  if (bars.length < window) return out;
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].volume;
    if (i >= window) sum -= bars[i - window].volume;
    if (i >= window - 1) {
      out.push({ time: bars[i].time as Time, value: sum / window });
    }
  }
  return out;
}

/**
 * Bollinger Bands — SMA(window) ± (stdev * multiplier).
 * Returns { middle, upper, lower } aligned arrays.
 */
function bollinger(bars: OhlcvBar[], window = 20, mult = 2) {
  const middle: { time: Time; value: number }[] = [];
  const upper: { time: Time; value: number }[] = [];
  const lower: { time: Time; value: number }[] = [];
  if (bars.length < window) return { middle, upper, lower };
  for (let i = window - 1; i < bars.length; i++) {
    let sum = 0;
    for (let j = i - window + 1; j <= i; j++) sum += bars[j].close;
    const mean = sum / window;
    let variance = 0;
    for (let j = i - window + 1; j <= i; j++) {
      variance += (bars[j].close - mean) ** 2;
    }
    const std = Math.sqrt(variance / window);
    const time = bars[i].time as Time;
    middle.push({ time, value: +mean.toFixed(4) });
    upper.push({ time, value: +(mean + mult * std).toFixed(4) });
    lower.push({ time, value: +(mean - mult * std).toFixed(4) });
  }
  return { middle, upper, lower };
}

function fmtNum(v: number | null | undefined, digits = 2, suffix = ""): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${v.toFixed(digits)}${suffix}`;
}

function fmtVol(v: number): string {
  if (v >= 1e9) return (v / 1e9).toFixed(1) + "B";
  if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(0) + "K";
  return v.toString();
}

// ---------------------------------------------------------------------------
// Ratings Panel (MarketSmith left sidebar style)
// ---------------------------------------------------------------------------
function RatingsPanel({ c }: { c: Candidate }) {
  const ratings = [
    { label: "Composite", value: c.score?.toFixed(0), color: "text-accent" },
    { label: "RS Rating", value: String(c.rs_rating ?? "—"), color: "text-text" },
    { label: "VCP Quality", value: `${fmtNum(c.vcp_quality, 0)}/20`, color: "text-text" },
  ];

  return (
    <div className="flex flex-col gap-2 mb-3">
      {/* Ratings badges */}
      <div className="grid grid-cols-3 gap-2">
        {ratings.map((r) => (
          <div key={r.label} className="bg-border/30 rounded px-2 py-1.5 text-center">
            <div className={`text-lg font-bold num ${r.color}`}>{r.value}</div>
            <div className="text-[10px] text-muted uppercase tracking-wide">{r.label}</div>
          </div>
        ))}
      </div>

      {/* Key metrics row */}
      <div className="grid grid-cols-4 gap-2 text-xs">
        <div className="bg-border/20 rounded px-2 py-1 text-center">
          <div className="num font-semibold">{c.num_contractions}</div>
          <div className="text-[9px] text-muted">Contractions</div>
        </div>
        <div className="bg-border/20 rounded px-2 py-1 text-center">
          <div className="num font-semibold">{fmtNum(c.last_contraction_pct, 1)}%</div>
          <div className="text-[9px] text-muted">Last Contr.</div>
        </div>
        <div className="bg-border/20 rounded px-2 py-1 text-center">
          <div className="num font-semibold">{fmtNum(c.base_depth_pct, 1)}%</div>
          <div className="text-[9px] text-muted">Base Depth</div>
        </div>
        <div className="bg-border/20 rounded px-2 py-1 text-center">
          <div className="num font-semibold">{fmtNum(c.volume_dryup_ratio, 2)}</div>
          <div className="text-[9px] text-muted">Vol Dry-Up</div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Chart Component
// ---------------------------------------------------------------------------
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

type OutperformData = {
  index: OutperformBlock;
  sector: OutperformBlock | null;
};

function OutperformBox({ block }: { block: OutperformBlock }) {
  return (
    <div className="bg-border/20 rounded p-2.5">
      <div className="flex items-baseline justify-between mb-1.5">
        <div className="text-[10px] text-muted uppercase tracking-wide">
          vs {block.benchmark_label}
        </div>
        <div className="text-[9px] text-muted num">
          {block.benchmark_symbol}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {block.periods.map((p) => {
          const op = p.outperform_pct;
          const color =
            op === null
              ? "text-muted"
              : op >= 0
              ? "text-emerald-400"
              : "text-red-400";
          return (
            <div key={p.period} className="text-center">
              <div className="text-[9px] text-muted">{p.period}</div>
              <div className={`text-sm font-bold num tabular-nums ${color}`}>
                {op === null
                  ? "—"
                  : `${op >= 0 ? "+" : ""}${op.toFixed(1)}%`}
              </div>
              <div className="text-[9px] text-muted num">
                {p.stock_return_pct === null
                  ? "—"
                  : `${p.stock_return_pct >= 0 ? "+" : ""}${p.stock_return_pct.toFixed(1)}`}
                {" / "}
                {p.benchmark_return_pct === null
                  ? "—"
                  : `${p.benchmark_return_pct >= 0 ? "+" : ""}${p.benchmark_return_pct.toFixed(1)}`}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ChartClient({
  candidate,
  staticData,
}: {
  candidate: Candidate;
  staticData?: { ohlcv: OhlcvBar[]; rs_line?: RsLinePoint[] } | null;
}) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [chartData, setChartData] = useState<{
    ohlcv: OhlcvBar[];
    rs_line?: RsLinePoint[];
  } | null>(staticData ?? null);
  const [outperform, setOutperform] = useState<OutperformData | null>(null);
  const [loading, setLoading] = useState(!staticData);
  const [error, setError] = useState<string | null>(null);

  // Live price for real-time marker
  const { quotes, asOf, loading: liveLoading } = useLivePrices(
    [candidate.ticker],
    { refreshMs: 30_000 },
  );
  const liveQuote = quotes[candidate.ticker];

  // Fetch chart data + outperform from API.
  // Always fetch outperform (even with staticData) since it's computed fresh.
  const fetchData = useCallback(async () => {
    setLoading(!staticData);
    setError(null);
    try {
      const params = new URLSearchParams({ ticker: candidate.ticker });
      if (candidate.sector) params.set("sector", candidate.sector);
      const res = await fetch(`/api/chart-data?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (!staticData) {
        setChartData({ ohlcv: data.ohlcv, rs_line: data.rs_line });
      }
      if (data.outperform) setOutperform(data.outperform);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [candidate.ticker, candidate.sector, staticData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Render chart
  useEffect(() => {
    if (!chartContainerRef.current || !chartData?.ohlcv?.length) return;
    const el = chartContainerRef.current;
    const { ohlcv, rs_line } = chartData;

    const chart = createChart(el, {
      width: el.clientWidth,
      height: 520,
      layout: {
        background: { type: ColorType.Solid, color: "#0b0e14" },
        textColor: "#8b93a7",
        fontFamily: "'SF Mono', 'Fira Code', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(31, 36, 48, 0.5)" },
        horzLines: { color: "rgba(31, 36, 48, 0.5)" },
      },
      rightPriceScale: {
        borderColor: "#1f2430",
        scaleMargins: { top: 0.02, bottom: 0.28 },
      },
      timeScale: {
        borderColor: "#1f2430",
        timeVisible: false,
        rightOffset: 5,
      },
      crosshair: { mode: 1 },
    });
    chartRef.current = chart;

    // OHLC Candlestick
    const candles = chart.addCandlestickSeries({
      upColor: "#4ade80",
      downColor: "#f87171",
      borderUpColor: "#4ade80",
      borderDownColor: "#f87171",
      wickUpColor: "#4ade80",
      wickDownColor: "#f87171",
    });
    const bars = ohlcv.map((b) => ({
      time: b.time as Time,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }));
    candles.setData(bars);

    // SMAs (thicker for IBD-style visibility)
    const smaConfigs = [
      { window: 50, color: "#60a5fa", width: 2 },
      { window: 150, color: "#fbbf24", width: 1 },
      { window: 200, color: "#ef4444", width: 2 },
    ];
    for (const { window, color, width } of smaConfigs) {
      const smaData = sma(ohlcv, window);
      if (smaData.length > 0) {
        const s = chart.addLineSeries({
          color,
          lineWidth: width as 1 | 2 | 3 | 4,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        s.setData(smaData);
      }
    }

    // Bollinger Bands (20, 2) — faint bands + dotted middle
    const bb = bollinger(ohlcv, 20, 2);
    if (bb.middle.length > 0) {
      const bbUpper = chart.addLineSeries({
        color: "rgba(168, 85, 247, 0.65)", // violet
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      bbUpper.setData(bb.upper);
      const bbLower = chart.addLineSeries({
        color: "rgba(168, 85, 247, 0.65)",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      bbLower.setData(bb.lower);
      const bbMid = chart.addLineSeries({
        color: "rgba(168, 85, 247, 0.35)",
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      bbMid.setData(bb.middle);
    }

    // Pivot line
    const pivotPrice = candidate.pivot_price;
    if (pivotPrice != null) {
      candles.createPriceLine({
        price: pivotPrice,
        color: "#4ade80",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "Pivot",
      });
    }

    // 52-week high line
    const hi52 = Math.max(...ohlcv.map((b) => b.high));
    candles.createPriceLine({
      price: hi52,
      color: "rgba(139, 147, 167, 0.4)",
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      axisLabelVisible: false,
      title: "52W High",
    });

    // ---- VCP Contraction "boxes" ----
    // For each contraction range, draw a thin horizontal line at the high
    // and at the low between start/end times. This creates a visible
    // upper/lower band per contraction. Color intensity scales with depth
    // (deeper contractions earlier in the sequence = more intense color).
    const cranges = candidate.contraction_ranges ?? [];
    if (cranges.length > 0) {
      const maxDepth = Math.max(...cranges.map((r) => r.depth_pct));
      cranges.forEach((cr, i) => {
        // Color fade: earliest (deepest) = dark amber, latest (tightest) = light yellow.
        const intensity =
          maxDepth > 0 ? 0.25 + 0.55 * (cr.depth_pct / maxDepth) : 0.4;
        const stroke = `rgba(251, 191, 36, ${intensity.toFixed(2)})`;
        const fillStroke = `rgba(251, 191, 36, ${(intensity * 0.45).toFixed(2)})`;

        const highSeries = chart.addLineSeries({
          color: stroke,
          lineWidth: 1,
          lineStyle: LineStyle.Solid,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        highSeries.setData([
          { time: cr.start as Time, value: cr.high },
          { time: cr.end as Time, value: cr.high },
        ]);
        const lowSeries = chart.addLineSeries({
          color: stroke,
          lineWidth: 1,
          lineStyle: LineStyle.Solid,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        lowSeries.setData([
          { time: cr.start as Time, value: cr.low },
          { time: cr.end as Time, value: cr.low },
        ]);
        // Diagonal "fall" line — connects high(start) to low(end) to suggest the contraction leg.
        const legSeries = chart.addLineSeries({
          color: fillStroke,
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        legSeries.setData([
          { time: cr.start as Time, value: cr.high },
          { time: cr.end as Time, value: cr.low },
        ]);
        // Suppress unused var warning (i kept for potential future use)
        void i;
      });
    }

    // ---- Markers: contraction depth labels + pivot + shakeouts ----
    const markers: SeriesMarker<Time>[] = [];

    // Pivot marker
    if (candidate.pivot_date) {
      markers.push({
        time: candidate.pivot_date as Time,
        position: "aboveBar",
        color: "#4ade80",
        shape: "arrowDown",
        text: `Pivot ${pivotPrice != null ? pivotPrice.toFixed(2) : ""}`,
      });
    }

    // Contraction depth labels (one per range, placed at the contraction's HIGH)
    for (const cr of cranges) {
      markers.push({
        time: cr.start as Time,
        position: "aboveBar",
        color: "#fbbf24",
        shape: "circle",
        text: `−${cr.depth_pct.toFixed(0)}%`,
      });
    }

    // Shakeout markers
    for (const sd of candidate.shakeout_dates ?? []) {
      markers.push({
        time: sd as Time,
        position: "belowBar",
        color: "#f87171",
        shape: "arrowUp",
        text: "S",
      });
    }

    // Sort by time (lightweight-charts requires ascending order) and dedupe
    // multiple markers on same time (lightweight-charts only renders one).
    if (markers.length > 0) {
      markers.sort((a, b) => {
        const ta = String(a.time);
        const tb = String(b.time);
        return ta < tb ? -1 : ta > tb ? 1 : 0;
      });
      candles.setMarkers(markers);
    }

    // Volume histogram — color dry-up periods yellow.
    // Build a set of all bar.time strings inside any dryup_range [start, end].
    const dryupSet = new Set<string>();
    const dryupRanges = candidate.dryup_ranges ?? [];
    if (dryupRanges.length > 0) {
      for (const dr of dryupRanges) {
        let inRange = false;
        for (const b of ohlcv) {
          if (b.time === dr.start) inRange = true;
          if (inRange) dryupSet.add(b.time);
          if (b.time === dr.end) {
            // Reached this range's end — move on to next range.
            break;
          }
        }
      }
    }
    const volumeSeries = chart.addHistogramSeries({
      priceScaleId: "volume",
      priceFormat: { type: "volume" },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volumeSeries.setData(
      ohlcv.map((b) => ({
        time: b.time as Time,
        value: b.volume,
        color: dryupSet.has(b.time)
          ? "rgba(251,191,36,0.65)" // dry-up = amber, opaque
          : b.close >= b.open
          ? "rgba(74,222,128,0.25)"
          : "rgba(248,113,113,0.25)",
      })),
    );
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });

    // 21-day volume average line (IBD convention)
    const vol21 = volSma(ohlcv, 21);
    if (vol21.length > 0) {
      const volAvgLine = chart.addLineSeries({
        color: "#fbbf24",
        lineWidth: 1,
        priceScaleId: "volume",
        priceLineVisible: false,
        lastValueVisible: false,
      });
      volAvgLine.setData(vol21);
    }

    // RS Line overlay
    if (rs_line && rs_line.length > 0) {
      const rsLineSeries = chart.addLineSeries({
        color: "#818cf8",
        lineWidth: 2,
        priceScaleId: "rs_line",
        priceLineVisible: false,
        lastValueVisible: true,
        title: "RS",
      });
      rsLineSeries.setData(
        rs_line.map((d) => ({ time: d.time as Time, value: d.value })),
      );
      chart.priceScale("rs_line").applyOptions({
        scaleMargins: { top: 0.62, bottom: 0.22 },
      });
    }

    chart.timeScale().fitContent();

    const onResize = () => {
      if (el && chartRef.current) {
        chartRef.current.applyOptions({ width: el.clientWidth });
      }
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [
    chartData,
    candidate.pivot_price,
    candidate.pivot_date,
    candidate.contraction_ranges,
    candidate.shakeout_dates,
    candidate.dryup_ranges,
  ]);

  // Compute live derived values
  const livePrice = liveQuote?.price ?? candidate.current_price;
  const livePct = liveQuote?.percentChange;
  const livePctToPivot =
    livePrice && candidate.pivot_price
      ? ((livePrice / candidate.pivot_price - 1) * 100)
      : candidate.pct_to_pivot;

  return (
    <div>
      {/* Ratings panel */}
      <RatingsPanel c={candidate} />

      {/* Sector / Index Outperform */}
      {outperform && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-3">
          <OutperformBox block={outperform.index} />
          {outperform.sector ? (
            <OutperformBox block={outperform.sector} />
          ) : (
            <div className="bg-border/10 rounded p-2.5 flex items-center justify-center text-[11px] text-muted text-center">
              {candidate.market === "US"
                ? `Sector ETF mapping not available for "${candidate.sector}"`
                : `Sector outperform: index-only for ${candidate.market} (no equivalent free sector ETF)`}
            </div>
          )}
        </div>
      )}

      {/* Price header with live data */}
      <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
        <div className="flex items-baseline gap-3">
          <span className="text-2xl font-bold num">
            {livePrice != null ? livePrice.toFixed(2) : "—"}
          </span>
          {livePct != null && (
            <span
              className={`text-sm font-semibold num ${livePct >= 0 ? "text-emerald-400" : "text-red-400"}`}
            >
              {livePct >= 0 ? "+" : ""}
              {livePct.toFixed(2)}%
            </span>
          )}
          {livePctToPivot != null && (
            <span className="text-xs text-muted num">
              → Pivot {livePctToPivot >= 0 ? "+" : ""}
              {livePctToPivot.toFixed(1)}%
            </span>
          )}
        </div>
        <div className="text-[11px] text-muted flex items-center gap-2">
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full ${liveLoading ? "bg-yellow-400 animate-pulse" : "bg-emerald-400"}`}
          />
          <span>
            {liveLoading ? "Refreshing" : "Live"} · {fmtLiveTime(asOf)}
          </span>
        </div>
      </div>

      {/* Chart */}
      {loading && (
        <div className="w-full flex items-center justify-center" style={{ height: 520 }}>
          <div className="text-muted text-sm animate-pulse">Loading chart data…</div>
        </div>
      )}
      {error && (
        <div className="w-full flex items-center justify-center" style={{ height: 520 }}>
          <div className="text-red-400 text-sm">
            Chart unavailable: {error}
            <button
              onClick={fetchData}
              className="ml-2 text-accent underline"
            >
              Retry
            </button>
          </div>
        </div>
      )}
      {!loading && !error && (
        <div className="w-full">
          <div ref={chartContainerRef} className="w-full" style={{ height: 520 }} />
          {/* Legend */}
          <div className="flex items-center gap-x-4 gap-y-1 text-xs text-muted mt-2 flex-wrap">
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-[2px] bg-[#60a5fa]" /> SMA 50
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-[1px] bg-[#fbbf24]" /> SMA 150
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-[2px] bg-[#ef4444]" /> SMA 200
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-[1px] bg-[rgba(168,85,247,0.8)]" />{" "}
              BB(20, 2σ)
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-0.5 bg-[#818cf8]" /> RS Line
            </span>
            <span className="flex items-center gap-1">
              <span
                className="inline-block w-3 h-0.5 border-t border-dashed"
                style={{ borderColor: "#4ade80" }}
              />{" "}
              Pivot
            </span>
            <span className="flex items-center gap-1">
              <span
                className="inline-block w-3 h-0.5 border-t border-dotted"
                style={{ borderColor: "rgba(139,147,167,0.4)" }}
              />{" "}
              52W High
            </span>
            <span className="flex items-center gap-1 text-[10px]">
              Vol: <span className="text-[#fbbf24]">━</span> 21d Avg
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-full bg-[#fbbf24]" />
              Contraction (depth%)
            </span>
            <span className="flex items-center gap-1">
              <span className="text-red-400 font-bold">S</span>
              Shakeout
            </span>
            <span className="flex items-center gap-1">
              <span
                className="inline-block w-3 h-2"
                style={{ backgroundColor: "rgba(251,191,36,0.65)" }}
              />
              Vol Dry-Up
            </span>
          </div>
        </div>
      )}

      {/* Contraction sequence */}
      {candidate.contractions.length > 0 && (
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-muted uppercase tracking-wide">
            Contractions
          </span>
          {candidate.contractions.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              <span className="px-2 py-0.5 bg-border/40 rounded num text-xs font-semibold">
                {c.toFixed(1)}%
              </span>
              {i < candidate.contractions.length - 1 && (
                <span className="text-muted text-xs">→</span>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

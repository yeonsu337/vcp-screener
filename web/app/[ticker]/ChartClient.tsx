"use client";
import { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  LineStyle,
  type IChartApi,
  type Time,
} from "lightweight-charts";
import type { OhlcvBar, RsLinePoint } from "../types";

function sma(bars: OhlcvBar[], window: number) {
  const out: { time: Time; value: number }[] = [];
  if (bars.length < window) return out;
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].close;
    if (i >= window) sum -= bars[i - window].close;
    if (i >= window - 1) {
      out.push({ time: bars[i].time as Time, value: sum / window });
    }
  }
  return out;
}

export default function ChartClient({
  data,
  pivot,
  rsLine,
}: {
  data: OhlcvBar[];
  pivot: number | null;
  rsLine?: RsLinePoint[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;

    const chart = createChart(el, {
      width: el.clientWidth,
      height: 480,
      layout: {
        background: { type: ColorType.Solid, color: "#141821" },
        textColor: "#8b93a7",
      },
      grid: {
        vertLines: { color: "#1f2430" },
        horzLines: { color: "#1f2430" },
      },
      rightPriceScale: {
        borderColor: "#1f2430",
        scaleMargins: { top: 0.02, bottom: 0.25 },
      },
      timeScale: { borderColor: "#1f2430", timeVisible: false },
      crosshair: { mode: 1 },
    });
    chartRef.current = chart;

    // Candlestick series
    const candles = chart.addCandlestickSeries({
      upColor: "#4ade80",
      downColor: "#f87171",
      borderUpColor: "#4ade80",
      borderDownColor: "#f87171",
      wickUpColor: "#4ade80",
      wickDownColor: "#f87171",
    });
    const bars = data.map((b) => ({
      time: b.time as Time,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }));
    candles.setData(bars);

    // SMAs
    const smaConfigs = [
      { window: 50, color: "#60a5fa" },
      { window: 150, color: "#fbbf24" },
      { window: 200, color: "#ef4444" },
    ];
    for (const { window, color } of smaConfigs) {
      const smaData = sma(data, window);
      if (smaData.length > 0) {
        const s = chart.addLineSeries({
          color,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        s.setData(smaData);
      }
    }

    // Pivot line
    if (pivot != null) {
      candles.createPriceLine({
        price: pivot,
        color: "#4ade80",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "Pivot",
      });
    }

    // Volume histogram (bottom 15%)
    const volumeSeries = chart.addHistogramSeries({
      priceScaleId: "volume",
      priceFormat: { type: "volume" },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volumeSeries.setData(
      data.map((b) => ({
        time: b.time as Time,
        value: b.volume,
        color: b.close >= b.open ? "rgba(74,222,128,0.25)" : "rgba(248,113,113,0.25)",
      }))
    );
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });

    // RS Line overlay (bottom 25%, above volume)
    if (rsLine && rsLine.length > 0) {
      const rsLineSeries = chart.addLineSeries({
        color: "#818cf8",
        lineWidth: 2,
        priceScaleId: "rs_line",
        priceLineVisible: false,
        lastValueVisible: true,
        title: "RS",
      });
      rsLineSeries.setData(
        rsLine.map((d) => ({ time: d.time as Time, value: d.value }))
      );
      chart.priceScale("rs_line").applyOptions({
        scaleMargins: { top: 0.65, bottom: 0.18 },
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
  }, [data, pivot, rsLine]);

  return (
    <div className="w-full">
      <div ref={ref} className="w-full" style={{ height: 480 }} />
      <div className="flex items-center gap-4 text-xs text-muted mt-2 flex-wrap">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-0.5 bg-[#60a5fa]" /> SMA50
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-0.5 bg-[#fbbf24]" /> SMA150
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-0.5 bg-[#ef4444]" /> SMA200
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
      </div>
    </div>
  );
}

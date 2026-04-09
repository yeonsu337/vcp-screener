"use client";
import { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  LineStyle,
  type IChartApi,
  type Time,
} from "lightweight-charts";
import type { OhlcvBar } from "../types";

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
}: {
  data: OhlcvBar[];
  pivot: number | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;

    const chart = createChart(el, {
      width: el.clientWidth,
      height: 420,
      layout: {
        background: { type: ColorType.Solid, color: "#141821" },
        textColor: "#8b93a7",
      },
      grid: {
        vertLines: { color: "#1f2430" },
        horzLines: { color: "#1f2430" },
      },
      rightPriceScale: { borderColor: "#1f2430" },
      timeScale: { borderColor: "#1f2430", timeVisible: false },
      crosshair: { mode: 1 },
    });
    chartRef.current = chart;

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
    const sma50Data = sma(data, 50);
    const sma150Data = sma(data, 150);
    const sma200Data = sma(data, 200);

    if (sma50Data.length > 0) {
      const s = chart.addLineSeries({
        color: "#60a5fa",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      s.setData(sma50Data);
    }
    if (sma150Data.length > 0) {
      const s = chart.addLineSeries({
        color: "#fbbf24",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      s.setData(sma150Data);
    }
    if (sma200Data.length > 0) {
      const s = chart.addLineSeries({
        color: "#ef4444",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      s.setData(sma200Data);
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
  }, [data, pivot]);

  return (
    <div className="w-full">
      <div ref={ref} className="w-full" style={{ height: 420 }} />
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

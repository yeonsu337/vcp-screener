"use client";

import { useState } from "react";
import type { TickerFinancials, AnnualFinancials, QuarterlyFinancials } from "../../types";

const DASH = "—";

function fmtB(v: number | null): string {
  if (v === null || v === undefined) return DASH;
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${(v / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(0)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return v.toFixed(0);
}

function fmtPct(v: number | null): string {
  if (v === null || v === undefined) return DASH;
  return `${(v * 100).toFixed(1)}%`;
}

function fmtPctRaw(v: number | null, d = 1): string {
  // For values that are already in percentage form (e.g., 24.3 means 24.3%)
  if (v === null || v === undefined) return DASH;
  return `${v.toFixed(d)}%`;
}

function fmtNum(v: number | null, d = 2): string {
  if (v === null || v === undefined) return DASH;
  return v.toFixed(d);
}

function avg(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function lastValid(values: (number | null)[]): number | null {
  // values are newest-first; return the first non-null
  for (const v of values) {
    if (v !== null && v !== undefined && Number.isFinite(v)) return v;
  }
  return null;
}

function shortLabel(period: string, freq: "Q" | "A"): string {
  if (!period) return "";
  if (freq === "A") return period.slice(0, 4); // YYYY
  // Q: convert YYYY-MM-DD -> YY/Qn
  const d = new Date(period);
  if (isNaN(d.getTime())) return period.slice(0, 7);
  const y = String(d.getFullYear()).slice(2);
  const m = d.getMonth() + 1;
  const q = m <= 3 ? 1 : m <= 6 ? 2 : m <= 9 ? 3 : 4;
  return `${y}Q${q}`;
}

// =============================================================================
// MetricCard (reused)
// =============================================================================

function MetricCard({
  label,
  value,
  sub,
  pass,
}: {
  label: string;
  value: string;
  sub?: string;
  pass?: boolean;
}) {
  return (
    <div className="card p-3">
      <div className="text-[10px] text-muted uppercase tracking-wide">{label}</div>
      <div className={`text-lg font-bold num ${pass === true ? "text-emerald-400" : pass === false ? "text-red-400" : ""}`}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-muted num">{sub}</div>}
    </div>
  );
}

// =============================================================================
// Bar Chart (single series, supports negatives, optional growth label)
// =============================================================================

function BarChart({
  labels,
  values,
  growths,
  color = "#4ade80",
  negativeColor = "#ef4444",
  yFormatter,
  height = 140,
}: {
  labels: string[];
  values: (number | null)[];
  growths?: (number | null)[];
  color?: string;
  negativeColor?: string;
  yFormatter?: (v: number) => string;
  height?: number;
}) {
  const valid = values.filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));
  if (valid.length === 0) return <div className="text-muted text-xs h-full flex items-center justify-center">No data</div>;

  const maxAbs = Math.max(...valid.map((v) => Math.abs(v)));
  const hasNegative = valid.some((v) => v < 0);

  // Reverse newest-first -> oldest-first (chronological)
  const rev = [...values].reverse();
  const revLabels = [...labels].reverse();
  const revGrowths = growths ? [...growths].reverse() : undefined;

  return (
    <div style={{ height }} className="flex items-stretch gap-1 relative">
      {rev.map((v, i) => {
        const label = revLabels[i] || "";
        const growth = revGrowths?.[i];
        const valid = v !== null && v !== undefined && Number.isFinite(v);
        const ratio = valid && maxAbs > 0 ? Math.abs(v as number) / maxAbs : 0;
        const isNeg = valid && (v as number) < 0;
        const barColor = isNeg ? negativeColor : color;

        return (
          <div key={i} className="flex-1 flex flex-col items-center justify-end min-w-0">
            {/* Growth label */}
            {growth !== null && growth !== undefined && Number.isFinite(growth) && (
              <span className={`text-[8px] num leading-none mb-0.5 ${growth >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {growth >= 0 ? "+" : ""}{growth.toFixed(0)}%
              </span>
            )}
            {/* Bar area */}
            {hasNegative ? (
              <div className="w-full flex flex-col items-center" style={{ height: "75%" }}>
                <div className="w-full flex-1 flex flex-col justify-end">
                  {valid && !isNeg && (
                    <div className="w-full rounded-t" style={{ height: `${ratio * 100}%`, backgroundColor: barColor, minHeight: 1 }} />
                  )}
                </div>
                <div className="w-full h-px bg-border" />
                <div className="w-full flex-1">
                  {valid && isNeg && (
                    <div className="w-full rounded-b" style={{ height: `${ratio * 100}%`, backgroundColor: barColor, minHeight: 1 }} />
                  )}
                </div>
              </div>
            ) : (
              <div className="w-full flex flex-col-reverse" style={{ height: "75%" }}>
                <div
                  className="w-full rounded-t"
                  style={{ height: `${ratio * 100}%`, backgroundColor: barColor, minHeight: valid ? 1 : 0, opacity: valid ? 1 : 0 }}
                />
              </div>
            )}
            {/* Value above the bar (shown small) */}
            {valid && yFormatter && (
              <span className="text-[8px] num text-muted leading-none mt-0.5">{yFormatter(v as number)}</span>
            )}
            {/* Period label */}
            <span className="text-[8px] text-muted num leading-none mt-1 truncate w-full text-center">{label}</span>
          </div>
        );
      })}
    </div>
  );
}

// =============================================================================
// Multi-series Bar Chart (grouped bars per period)
// =============================================================================

function GroupedBarChart({
  labels,
  series,
  height = 140,
  yFormatter,
}: {
  labels: string[];
  series: { name: string; color: string; values: (number | null)[] }[];
  height?: number;
  yFormatter?: (v: number) => string;
}) {
  const allVals = series
    .flatMap((s) => s.values)
    .filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));
  if (allVals.length === 0) return <div className="text-muted text-xs h-full flex items-center justify-center">No data</div>;

  const maxAbs = Math.max(...allVals.map((v) => Math.abs(v)));
  const hasNegative = allVals.some((v) => v < 0);

  // Reverse all series and labels to chronological
  const revLabels = [...labels].reverse();
  const revSeries = series.map((s) => ({ ...s, values: [...s.values].reverse() }));

  return (
    <div className="flex flex-col">
      {/* Legend */}
      <div className="flex gap-3 text-[10px] mb-1">
        {series.map((s) => (
          <span key={s.name} className="flex items-center gap-1 text-muted">
            <span className="inline-block w-2 h-2 rounded-sm" style={{ backgroundColor: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
      <div style={{ height }} className="flex items-stretch gap-1">
        {revLabels.map((label, i) => (
          <div key={i} className="flex-1 flex flex-col items-center justify-end min-w-0">
            <div className="w-full flex flex-col" style={{ height: "85%" }}>
              {hasNegative ? (
                <>
                  <div className="w-full flex-1 flex items-end justify-center gap-0.5">
                    {revSeries.map((s) => {
                      const v = s.values[i];
                      const valid = v !== null && v !== undefined && Number.isFinite(v);
                      if (!valid || (v as number) < 0) return <div key={s.name} className="flex-1" />;
                      const r = (v as number) / maxAbs;
                      return (
                        <div
                          key={s.name}
                          className="flex-1 rounded-t"
                          style={{ height: `${r * 100}%`, backgroundColor: s.color, minHeight: 1 }}
                          title={`${s.name}: ${yFormatter ? yFormatter(v as number) : v}`}
                        />
                      );
                    })}
                  </div>
                  <div className="w-full h-px bg-border" />
                  <div className="w-full flex-1 flex items-start justify-center gap-0.5">
                    {revSeries.map((s) => {
                      const v = s.values[i];
                      const valid = v !== null && v !== undefined && Number.isFinite(v);
                      if (!valid || (v as number) >= 0) return <div key={s.name} className="flex-1" />;
                      const r = Math.abs(v as number) / maxAbs;
                      return (
                        <div
                          key={s.name}
                          className="flex-1 rounded-b"
                          style={{ height: `${r * 100}%`, backgroundColor: s.color, minHeight: 1 }}
                          title={`${s.name}: ${yFormatter ? yFormatter(v as number) : v}`}
                        />
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="w-full flex-1 flex items-end justify-center gap-0.5">
                  {revSeries.map((s) => {
                    const v = s.values[i];
                    const valid = v !== null && v !== undefined && Number.isFinite(v);
                    const r = valid && maxAbs > 0 ? (v as number) / maxAbs : 0;
                    return (
                      <div
                        key={s.name}
                        className="flex-1 rounded-t"
                        style={{ height: valid ? `${Math.max(r * 100, 1)}%` : 0, backgroundColor: s.color, minHeight: valid ? 1 : 0 }}
                        title={`${s.name}: ${valid && yFormatter ? yFormatter(v as number) : valid ? String(v) : "n/a"}`}
                      />
                    );
                  })}
                </div>
              )}
            </div>
            <span className="text-[8px] text-muted num leading-none mt-1 truncate w-full text-center">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// Line Chart (SVG path; supports null gaps)
// =============================================================================

function LineChart({
  labels,
  values,
  color = "#60a5fa",
  height = 140,
  yMin,
  yMax,
  yFormatter,
}: {
  labels: string[];
  values: (number | null)[];
  color?: string;
  height?: number;
  yMin?: number;
  yMax?: number;
  yFormatter?: (v: number) => string;
}) {
  const valid = values.filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));
  if (valid.length === 0) return <div className="text-muted text-xs h-full flex items-center justify-center">No data</div>;

  const rev = [...values].reverse();
  const revLabels = [...labels].reverse();
  const n = rev.length;

  const dataMin = Math.min(...valid);
  const dataMax = Math.max(...valid);
  const lo = yMin !== undefined ? yMin : Math.min(0, dataMin);
  const hi = yMax !== undefined ? yMax : Math.max(dataMax, lo + 1);
  const range = hi - lo || 1;

  // Build SVG viewBox 100x100; we'll keep the chart proportionate to height
  const W = 100;
  const H = 100;
  const xOf = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W);
  const yOf = (v: number) => H - ((v - lo) / range) * H;

  // Build path; break into segments where values are null
  const segments: string[] = [];
  let current: string[] = [];
  rev.forEach((v, i) => {
    if (v === null || v === undefined || !Number.isFinite(v)) {
      if (current.length > 0) {
        segments.push(current.join(" "));
        current = [];
      }
      return;
    }
    const x = xOf(i).toFixed(2);
    const y = yOf(v as number).toFixed(2);
    current.push(current.length === 0 ? `M ${x} ${y}` : `L ${x} ${y}`);
  });
  if (current.length > 0) segments.push(current.join(" "));

  return (
    <div className="flex flex-col" style={{ height }}>
      <div className="flex-1 relative">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-full">
          {/* Grid lines */}
          {[0.25, 0.5, 0.75].map((t) => (
            <line key={t} x1={0} x2={W} y1={H * t} y2={H * t} stroke="currentColor" strokeOpacity={0.1} strokeWidth={0.3} />
          ))}
          {segments.map((d, idx) => (
            <path key={idx} d={d} fill="none" stroke={color} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
          ))}
          {/* Points */}
          {rev.map((v, i) => {
            if (v === null || v === undefined || !Number.isFinite(v)) return null;
            return <circle key={i} cx={xOf(i)} cy={yOf(v as number)} r={1} fill={color} vectorEffect="non-scaling-stroke" />;
          })}
        </svg>
        {/* Y axis hint (top-right) */}
        <div className="absolute top-0 right-1 text-[8px] text-muted num leading-none">
          {yFormatter ? yFormatter(hi) : hi.toFixed(1)}
        </div>
        <div className="absolute bottom-0 right-1 text-[8px] text-muted num leading-none">
          {yFormatter ? yFormatter(lo) : lo.toFixed(1)}
        </div>
      </div>
      {/* X labels */}
      <div className="flex gap-1 mt-1">
        {revLabels.map((label, i) => (
          <span key={i} className="flex-1 text-[8px] text-muted num text-center truncate">{label}</span>
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// Chart Card wrapper
// =============================================================================

function ChartCard({
  title,
  subtitle,
  footer,
  children,
}: {
  title: string;
  subtitle?: string;
  footer?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-xs font-semibold uppercase tracking-wide">{title}</div>
        {subtitle && <div className="text-[10px] text-muted num">{subtitle}</div>}
      </div>
      <div>{children}</div>
      {footer && <div className="text-[10px] text-muted num mt-2">{footer}</div>}
    </div>
  );
}

// =============================================================================
// FsTable (existing 5Y annual financials table)
// =============================================================================

function FsTable({
  title,
  rows,
  periods,
  currency,
}: {
  title: string;
  rows: { label: string; values: (number | null)[] }[];
  periods: string[];
  currency: string;
}) {
  const revPeriods = [...periods].reverse();
  return (
    <div>
      <div className="text-xs font-semibold text-muted uppercase mb-2">{title} ({currency})</div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted">
            <tr>
              <th className="text-left pr-3 py-1 w-36"></th>
              {revPeriods.map((p, i) => (
                <th key={i} className="text-right px-2 py-1 num">{p.slice(0, 4)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const revVals = [...row.values].reverse();
              return (
                <tr key={row.label} className="border-t border-border/50">
                  <td className="pr-3 py-1.5 text-muted">{row.label}</td>
                  {revVals.map((v, i) => (
                    <td key={i} className="text-right px-2 py-1.5 num">
                      {fmtB(v)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// =============================================================================
// FinancialCharts — 8 charts grid (renders for either Q or A view)
// =============================================================================

type FinancialView = {
  freq: "Q" | "A";
  periods: string[];
  eps: (number | null)[];
  eps_yoy: (number | null)[];
  revenue: (number | null)[];
  revenue_yoy: (number | null)[];
  operating_income: (number | null)[];
  operating_income_yoy: (number | null)[];
  operating_margin: (number | null)[];
  debt_to_equity: (number | null)[];
  current_ratio: (number | null)[];
  cash_ratio: (number | null)[];
  dividend_yield: (number | null)[];
  roe: (number | null)[];
  roa: (number | null)[];
  free_cf: (number | null)[];
};

function safeArr<T>(arr: T[] | undefined | null, len: number): (T | null)[] {
  // Pad/replace with null so downstream code is safe
  if (!Array.isArray(arr)) return new Array(len).fill(null);
  if (arr.length >= len) return arr.slice(0, len) as (T | null)[];
  return [...arr, ...new Array(len - arr.length).fill(null)] as (T | null)[];
}

function buildView(q: QuarterlyFinancials, a: AnnualFinancials, freq: "Q" | "A"): FinancialView {
  if (freq === "Q") {
    const periods = Array.isArray(q?.periods) ? q.periods : [];
    const n = periods.length || 8;
    return {
      freq,
      periods,
      eps: safeArr(q?.eps, n) as (number | null)[],
      eps_yoy: safeArr(q?.eps_yoy, n) as (number | null)[],
      revenue: safeArr(q?.revenue, n) as (number | null)[],
      revenue_yoy: safeArr(q?.revenue_yoy, n) as (number | null)[],
      operating_income: safeArr(q?.operating_income, n) as (number | null)[],
      operating_income_yoy: safeArr(q?.operating_income_yoy, n) as (number | null)[],
      operating_margin: safeArr(q?.operating_margin, n) as (number | null)[],
      debt_to_equity: safeArr(q?.debt_to_equity, n) as (number | null)[],
      current_ratio: safeArr(q?.current_ratio, n) as (number | null)[],
      cash_ratio: safeArr(q?.cash_ratio, n) as (number | null)[],
      dividend_yield: safeArr(q?.dividend_yield, n) as (number | null)[],
      roe: safeArr(q?.roe, n) as (number | null)[],
      roa: safeArr(q?.roa, n) as (number | null)[],
      free_cf: safeArr(q?.free_cf, n) as (number | null)[],
    };
  }
  const periods = Array.isArray(a?.periods) ? a.periods : [];
  const n = periods.length || 5;
  return {
    freq,
    periods,
    eps: safeArr(a?.eps, n) as (number | null)[],
    eps_yoy: safeArr(a?.eps_yoy, n) as (number | null)[],
    revenue: safeArr(a?.revenue, n) as (number | null)[],
    revenue_yoy: safeArr(a?.revenue_yoy, n) as (number | null)[],
    operating_income: safeArr(a?.operating_income, n) as (number | null)[],
    operating_income_yoy: safeArr(a?.operating_income_yoy, n) as (number | null)[],
    operating_margin: safeArr(a?.operating_margin, n) as (number | null)[],
    debt_to_equity: safeArr(a?.debt_to_equity, n) as (number | null)[],
    current_ratio: safeArr(a?.current_ratio, n) as (number | null)[],
    cash_ratio: safeArr(a?.cash_ratio, n) as (number | null)[],
    dividend_yield: safeArr(a?.dividend_yield, n) as (number | null)[],
    roe: safeArr(a?.roe, n) as (number | null)[],
    roa: safeArr(a?.roa, n) as (number | null)[],
    free_cf: safeArr(a?.free_cf, n) as (number | null)[],
  };
}

function FinancialCharts({ view }: { view: FinancialView }) {
  const { freq } = view;
  const labels = view.periods.map((p) => shortLabel(p, freq));

  const lastEps = lastValid(view.eps);
  const lastRev = lastValid(view.revenue);
  const lastOp = lastValid(view.operating_income);
  const lastMargin = lastValid(view.operating_margin);
  const lastFcf = lastValid(view.free_cf);
  const avgRoe = avg(view.roe);
  const avgRoa = avg(view.roa);
  const lastDy = lastValid(view.dividend_yield);

  const hasDividend = view.dividend_yield.some((v) => v !== null && v !== undefined && Number.isFinite(v) && (v as number) > 0);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* 1. EPS */}
      <ChartCard
        title="EPS"
        subtitle={`Latest ${fmtNum(lastEps)}`}
        footer="Diluted EPS, YoY % shown above bar"
      >
        <BarChart labels={labels} values={view.eps} growths={view.eps_yoy} color="#818cf8" />
      </ChartCard>

      {/* 2. Revenue */}
      <ChartCard
        title="Revenue"
        subtitle={`Latest ${fmtB(lastRev)}`}
        footer="Total Revenue, YoY % shown above bar"
      >
        <BarChart labels={labels} values={view.revenue} growths={view.revenue_yoy} color="#4ade80" />
      </ChartCard>

      {/* 3. Operating Income */}
      <ChartCard
        title="Operating Income"
        subtitle={`Latest ${fmtB(lastOp)}`}
        footer="Operating Income, YoY % shown above bar"
      >
        <BarChart labels={labels} values={view.operating_income} growths={view.operating_income_yoy} color="#fbbf24" />
      </ChartCard>

      {/* 4. Operating Margin (line) */}
      <ChartCard
        title="Operating Margin"
        subtitle={`Latest ${fmtPctRaw(lastMargin)}`}
        footer="Operating Income / Revenue (%)"
      >
        <LineChart
          labels={labels}
          values={view.operating_margin}
          color="#f472b6"
          yMin={0}
          yMax={100}
          yFormatter={(v) => `${v.toFixed(0)}%`}
        />
      </ChartCard>

      {/* 5. Financial Health (multi-series) */}
      <ChartCard
        title="Financial Health"
        subtitle="D/E, Current, Cash"
        footer="Debt/Equity (lower better) | Current Ratio (>1) | Cash Ratio"
      >
        <GroupedBarChart
          labels={labels}
          series={[
            { name: "D/E", color: "#ef4444", values: view.debt_to_equity },
            { name: "Current", color: "#22d3ee", values: view.current_ratio },
            { name: "Cash", color: "#a78bfa", values: view.cash_ratio },
          ]}
          yFormatter={(v) => v.toFixed(2)}
        />
      </ChartCard>

      {/* 6. Dividend Yield */}
      <ChartCard
        title="Dividend Yield"
        subtitle={hasDividend ? `Latest ${fmtPctRaw(lastDy, 2)}` : "No dividend"}
        footer="Annualized yield per period (%)"
      >
        {hasDividend ? (
          <BarChart
            labels={labels}
            values={view.dividend_yield}
            color="#34d399"
            yFormatter={(v) => `${v.toFixed(1)}%`}
          />
        ) : (
          <div className="h-[140px] flex items-center justify-center text-muted text-xs">No dividend</div>
        )}
      </ChartCard>

      {/* 7. ROE / ROA (grouped) */}
      <ChartCard
        title="ROE / ROA"
        subtitle={`Avg ROE ${fmtPctRaw(avgRoe)} / ROA ${fmtPctRaw(avgRoa)}`}
        footer="Net Income / Equity (or Assets), %"
      >
        <GroupedBarChart
          labels={labels}
          series={[
            { name: "ROE", color: "#10b981", values: view.roe },
            { name: "ROA", color: "#3b82f6", values: view.roa },
          ]}
          yFormatter={(v) => `${v.toFixed(1)}%`}
        />
      </ChartCard>

      {/* 8. Free Cash Flow */}
      <ChartCard
        title="Free Cash Flow"
        subtitle={`Latest ${fmtB(lastFcf)}`}
        footer="OpCF − Capex (negatives in red)"
      >
        <BarChart
          labels={labels}
          values={view.free_cf}
          color="#22c55e"
          negativeColor="#ef4444"
          yFormatter={(v) => fmtB(v)}
        />
      </ChartCard>
    </div>
  );
}

// =============================================================================
// Tab toggle
// =============================================================================

function TabToggle({
  value,
  onChange,
}: {
  value: "Q" | "A";
  onChange: (v: "Q" | "A") => void;
}) {
  const base = "px-4 py-2 text-xs font-semibold uppercase tracking-wide rounded transition-colors";
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => onChange("Q")}
        className={`${base} ${value === "Q" ? "bg-accent text-bg" : "bg-panel text-muted hover:text-text border border-border"}`}
      >
        Quarterly &middot; 12Q
      </button>
      <button
        type="button"
        onClick={() => onChange("A")}
        className={`${base} ${value === "A" ? "bg-accent text-bg" : "bg-panel text-muted hover:text-text border border-border"}`}
      >
        Annual &middot; 5Y
      </button>
    </div>
  );
}

// =============================================================================
// Main component
// =============================================================================

export default function FinancialSummary({ data }: { data: TickerFinancials }) {
  const [tab, setTab] = useState<"Q" | "A">("Q");

  const m = data.metrics;
  const a = data.annual;
  const q = data.quarterly;
  const cur = m.currency || "USD";

  // CANSLIM/Minervini pass/fail
  const roePass = m.roe !== null ? m.roe >= 0.17 : undefined;
  const epsGrowthPass = m.earnings_growth !== null ? m.earnings_growth >= 0.25 : undefined;
  const revGrowthPass = m.revenue_growth !== null ? m.revenue_growth > 0 : undefined;
  const marginPass = m.profit_margin !== null ? m.profit_margin > 0.1 : undefined;

  const view = buildView(q, a, tab);

  return (
    <div className="space-y-6">
      {/* Key Metrics (Minervini / O'Neil focus) */}
      <section>
        <h3 className="text-sm font-semibold mb-3">CANSLIM / Minervini Metrics</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <MetricCard label="EPS (TTM)" value={fmtNum(m.eps_ttm)} sub={`Fwd ${fmtNum(m.eps_forward)}`} />
          <MetricCard label="EPS Growth" value={fmtPct(m.earnings_growth)} pass={epsGrowthPass} sub=">25% ideal" />
          <MetricCard label="Rev Growth" value={fmtPct(m.revenue_growth)} pass={revGrowthPass} />
          <MetricCard label="ROE" value={fmtPct(m.roe)} pass={roePass} sub=">17% Minervini" />
          <MetricCard label="P/E" value={fmtNum(m.pe_ttm, 1)} sub={`Fwd ${fmtNum(m.pe_forward, 1)}`} />
          <MetricCard label="Profit Margin" value={fmtPct(m.profit_margin)} pass={marginPass} />
          <MetricCard label="Gross Margin" value={fmtPct(m.gross_margin)} />
          <MetricCard label="Op Margin" value={fmtPct(m.operating_margin)} />
          <MetricCard label="Market Cap" value={fmtB(m.market_cap)} />
          <MetricCard label="Sector" value={m.sector || DASH} />
        </div>
      </section>

      {/* Tab toggle + 8-chart visualization */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Financial Visualization</h3>
          <TabToggle value={tab} onChange={setTab} />
        </div>
        <FinancialCharts view={view} />
      </section>

      {/* 5-Year Financial Statements (kept) */}
      <section className="card p-4 space-y-5">
        <FsTable
          title="Income Statement"
          currency={cur}
          periods={a.periods}
          rows={[
            { label: "Revenue", values: a.revenue },
            { label: "Gross Profit", values: a.gross_profit },
            { label: "Operating Income", values: a.operating_income },
            { label: "Net Income", values: a.net_income },
            { label: "EPS", values: a.eps },
          ]}
        />
        <FsTable
          title="Balance Sheet"
          currency={cur}
          periods={a.periods}
          rows={[
            { label: "Total Assets", values: a.total_assets },
            { label: "Total Liabilities", values: a.total_liabilities },
            { label: "Equity", values: a.equity },
            { label: "Cash", values: a.cash },
            { label: "Total Debt", values: a.total_debt },
          ]}
        />
        <FsTable
          title="Cash Flow"
          currency={cur}
          periods={a.periods}
          rows={[
            { label: "Operating CF", values: a.operating_cf },
            { label: "Capex", values: a.capex },
            { label: "Free Cash Flow", values: a.free_cf },
          ]}
        />
      </section>
    </div>
  );
}

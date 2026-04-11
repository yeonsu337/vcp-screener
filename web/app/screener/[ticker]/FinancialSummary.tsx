import type { TickerFinancials } from "../../types";

function fmtB(v: number | null): string {
  if (v === null) return "\u2014";
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${(v / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(0)}M`;
  return v.toFixed(0);
}

function fmtPct(v: number | null): string {
  if (v === null) return "\u2014";
  return `${(v * 100).toFixed(1)}%`;
}

function fmtNum(v: number | null, d = 2): string {
  if (v === null) return "\u2014";
  return v.toFixed(d);
}

function GrowthBadge({ value, threshold = 25 }: { value: number | null; threshold?: number }) {
  if (value === null) return <span className="text-muted">\u2014</span>;
  const pass = value >= threshold;
  return (
    <span className={`num font-semibold ${pass ? "text-emerald-400" : value >= 0 ? "text-yellow-400" : "text-red-400"}`}>
      {value >= 0 ? "+" : ""}{value.toFixed(1)}%
    </span>
  );
}

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

function BarChart({
  labels,
  values,
  growths,
  color = "#4ade80",
}: {
  labels: string[];
  values: (number | null)[];
  growths?: (number | null)[];
  color?: string;
}) {
  const valid = values.filter((v): v is number => v !== null && v > 0);
  if (valid.length === 0) return <div className="text-muted text-xs">No data</div>;
  const maxVal = Math.max(...valid);

  // Reverse to chronological (yfinance returns newest first)
  const rev = [...values].reverse();
  const revLabels = [...labels].reverse();
  const revGrowths = growths ? [...growths].reverse() : undefined;

  return (
    <div className="flex items-end gap-1 h-32">
      {rev.map((v, i) => {
        const h = v !== null && v > 0 ? (v / maxVal) * 100 : 2;
        const label = revLabels[i]?.slice(0, 7) || "";
        const growth = revGrowths?.[i];
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            {growth !== null && growth !== undefined && (
              <span className={`text-[9px] num ${growth >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {growth >= 0 ? "+" : ""}{growth.toFixed(0)}%
              </span>
            )}
            <div
              className="w-full rounded-t"
              style={{ height: `${h}%`, backgroundColor: color, minHeight: 2, opacity: v !== null ? 1 : 0.2 }}
            />
            <span className="text-[9px] text-muted num">{label}</span>
          </div>
        );
      })}
    </div>
  );
}

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

export default function FinancialSummary({ data }: { data: TickerFinancials }) {
  const m = data.metrics;
  const a = data.annual;
  const q = data.quarterly;
  const cur = m.currency || "USD";

  // CANSLIM/Minervini pass/fail
  const roePass = m.roe !== null ? m.roe >= 0.17 : undefined;
  const epsGrowthPass = m.earnings_growth !== null ? m.earnings_growth >= 0.25 : undefined;
  const revGrowthPass = m.revenue_growth !== null ? m.revenue_growth > 0 : undefined;
  const marginPass = m.profit_margin !== null ? m.profit_margin > 0.1 : undefined;

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
          <MetricCard label="Sector" value={m.sector || "\u2014"} />
        </div>
      </section>

      {/* Quarterly EPS & Revenue Charts */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card p-4">
          <div className="text-xs text-muted mb-3">Quarterly EPS (YoY %)</div>
          <BarChart labels={q.periods} values={q.eps} growths={q.eps_yoy} color="#818cf8" />
        </div>
        <div className="card p-4">
          <div className="text-xs text-muted mb-3">Quarterly Revenue (YoY %)</div>
          <BarChart labels={q.periods} values={q.revenue} growths={q.revenue_yoy} color="#4ade80" />
        </div>
      </section>

      {/* 5-Year Financial Statements */}
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

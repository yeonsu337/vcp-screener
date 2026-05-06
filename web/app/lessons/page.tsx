import fs from "fs";
import path from "path";
import Link from "next/link";

export const dynamic = "force-static";
export const revalidate = 3600;

type Snapshot = {
  total_trades: number;
  active: number;
  exited: number;
  winners_50pct: number;
  winners_30pct: number;
  losers: number;
};

type Performance = {
  win_rate_pct: number | null;
  profit_factor: number | null;
  expectancy: number | null;
  avg_winner_pct: number | null;
  avg_loser_pct: number | null;
  best: { ticker: string; return_pct: number } | null;
  worst: { ticker: string; return_pct: number } | null;
  avg_holding_winner_days: number | null;
  avg_holding_loser_days: number | null;
};

type RuleDiff = {
  rule_id: string;
  rule_name: string;
  winner_pct: number;
  loser_pct: number;
  lift: number;
  winner_n: number;
  loser_n: number;
};

type RuleAnalysis = {
  primary_pass_buckets: Array<{
    primary_passed: number;
    trades: number;
    avg_return_pct: number;
    win_rate_pct: number;
  }>;
  rule_hit_rate_diff: RuleDiff[];
  big_winners_common_rules: Array<{
    rule_id: string;
    rule_name: string;
    passed_count: number;
    passed_pct: number;
  }>;
  loser_threshold_pct: number;
  big_winner_threshold_pct: number;
};

type SectorRow = {
  sector: string;
  trades: number;
  win_rate_pct: number;
  avg_return_pct: number;
  best_return_pct: number;
};

type MarketBreakdown = Record<
  string,
  { trades: number; win_rate_pct: number; avg_return_pct: number }
>;

type TimeCurvePoint = {
  day: number;
  trades: number;
  avg_return_pct: number | null;
  winners_pct: number | null;
};

type LLMInsights = {
  generated_at: string;
  winner_patterns: string[];
  loser_traps: string[];
  rule_suggestions: string[];
  note?: string;
  error?: string;
  model?: string;
  trades_analyzed?: number;
};

type Lessons = {
  generated_at: string;
  schema_version: number;
  thresholds: Record<string, number>;
  snapshot: Snapshot;
  performance: Performance;
  exit_breakdown: Record<string, number>;
  rule_analysis: RuleAnalysis;
  sector_breakdown: SectorRow[];
  market_breakdown: MarketBreakdown;
  rs_distribution: {
    winner_avg_rs: number | null;
    loser_avg_rs: number | null;
    winner_n: number;
    loser_n: number;
  };
  time_curve: TimeCurvePoint[];
  llm_insights: LLMInsights;
  data_status: {
    exited_trades_count: number;
    min_for_meaningful: number;
    fallback_message: string | null;
  };
};

function loadLessons(): Lessons | null {
  const p = path.join(process.cwd(), "public", "data", "lessons.json");
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as Lessons;
  } catch {
    return null;
  }
}

const EXIT_LABELS: Record<string, string> = {
  EX1_stop_8pct: "EX1 — Stop −8%",
  EX3_rs_collapse: "EX3 — RS collapse",
  EX4_50dma_break: "EX4 — 50d MA break",
  EX5_trailing: "EX5 — Trailing stop",
  EX6_absent: "EX6 — Absent ≥ 10d",
  EX0_unknown: "Other",
};

function fmt(v: number | null | undefined, digits = 1, suffix = ""): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${v.toFixed(digits)}${suffix}`;
}

function colorByReturn(v: number | null | undefined): string {
  if (v === null || v === undefined) return "text-muted";
  if (v > 0) return "text-emerald-400";
  if (v < 0) return "text-red-400";
  return "";
}

export default function LessonsPage() {
  const data = loadLessons();

  if (!data) {
    return (
      <main className="max-w-5xl mx-auto px-4 py-10">
        <BackHome />
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight mb-3">
          Lessons Learned
        </h1>
        <div className="card p-6 text-muted text-sm">
          No analytics yet. Run{" "}
          <code className="bg-border/40 px-1 rounded">
            python scripts/lessons_analyzer.py
          </code>{" "}
          (or wait for the daily GitHub Action) to populate{" "}
          <code className="bg-border/40 px-1 rounded">
            web/public/data/lessons.json
          </code>
          .
        </div>
      </main>
    );
  }

  const {
    snapshot,
    performance,
    exit_breakdown,
    rule_analysis,
    sector_breakdown,
    market_breakdown,
    rs_distribution,
    time_curve,
    llm_insights,
    data_status,
  } = data;

  const totalExits = Object.values(exit_breakdown).reduce(
    (s, v) => s + (v || 0),
    0,
  );
  const exitRows = Object.entries(exit_breakdown)
    .map(([k, v]) => ({
      key: k,
      label: EXIT_LABELS[k] || k,
      n: v,
      pct: totalExits > 0 ? (v / totalExits) * 100 : 0,
    }))
    .sort((a, b) => b.n - a.n);

  const ruleDiff = rule_analysis.rule_hit_rate_diff.slice(0, 12);
  const bigWinnerRules = rule_analysis.big_winners_common_rules.slice(0, 10);

  const updatedISO = data.generated_at;
  const updatedShort = updatedISO ? updatedISO.slice(0, 16).replace("T", " ") : "—";

  return (
    <main className="max-w-6xl mx-auto px-4 py-6 md:py-10">
      <BackHome />

      <header className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
          Lessons Learned
        </h1>
        <p className="text-muted text-sm mt-1">
          Pattern analytics across every detected ticker (active + exited).
          Auto-refreshed daily; LLM insights refresh weekly.
        </p>
        <p className="text-xs text-muted mt-1">
          Last update: <span className="num">{updatedShort} UTC</span> &middot;{" "}
          {snapshot.total_trades} total trades ({snapshot.active} active /{" "}
          {snapshot.exited} exited)
        </p>
        {data_status.fallback_message && (
          <div className="mt-3 card p-3 text-xs text-yellow-400">
            {data_status.fallback_message}
          </div>
        )}
      </header>

      {/* SECTION 1 — Performance Snapshot */}
      <section className="mb-6">
        <SectionTitle n={1} title="Performance Snapshot" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <Stat label="Win Rate" value={fmt(performance.win_rate_pct, 1, "%")} />
          <Stat
            label="Profit Factor"
            value={
              performance.profit_factor !== null
                ? fmt(performance.profit_factor, 2)
                : "—"
            }
            hint="Σ wins / |Σ losses|"
          />
          <Stat
            label="Expectancy"
            value={fmt(performance.expectancy, 2, "%")}
            hint="per trade, avg"
            color={colorByReturn(performance.expectancy)}
          />
          <Stat
            label={`+${data.thresholds.winner_big_pct}% Winners`}
            value={String(snapshot.winners_50pct)}
            hint={`+${data.thresholds.winner_pct}%: ${snapshot.winners_30pct} · losers ≤ ${data.thresholds.loser_pct}%: ${snapshot.losers}`}
          />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat
            label="Avg Winner"
            value={fmt(performance.avg_winner_pct, 2, "%")}
            color="text-emerald-400"
          />
          <Stat
            label="Avg Loser"
            value={fmt(performance.avg_loser_pct, 2, "%")}
            color="text-red-400"
          />
          <Stat
            label="Best"
            value={
              performance.best
                ? `${performance.best.ticker} ${fmt(performance.best.return_pct, 1, "%")}`
                : "—"
            }
            color="text-emerald-400"
          />
          <Stat
            label="Worst"
            value={
              performance.worst
                ? `${performance.worst.ticker} ${fmt(performance.worst.return_pct, 1, "%")}`
                : "—"
            }
            color="text-red-400"
          />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          <Stat
            label="Hold Days — Winners"
            value={fmt(performance.avg_holding_winner_days, 1, "d")}
          />
          <Stat
            label="Hold Days — Losers"
            value={fmt(performance.avg_holding_loser_days, 1, "d")}
          />
          <Stat
            label="RS — Winners"
            value={fmt(rs_distribution.winner_avg_rs, 1)}
            hint={`n=${rs_distribution.winner_n}`}
          />
          <Stat
            label="RS — Losers"
            value={fmt(rs_distribution.loser_avg_rs, 1)}
            hint={`n=${rs_distribution.loser_n}`}
          />
        </div>
      </section>

      {/* SECTION 2 — Exit Breakdown */}
      <section className="mb-6">
        <SectionTitle n={2} title="Exit Breakdown" />
        {exitRows.length === 0 ? (
          <Empty>No exits recorded yet.</Empty>
        ) : (
          <div className="card p-4">
            <div className="space-y-2">
              {exitRows.map((row) => (
                <div key={row.key} className="flex items-center gap-3">
                  <div className="w-44 text-sm shrink-0">{row.label}</div>
                  <div className="flex-1 h-6 bg-border/30 rounded overflow-hidden">
                    <div
                      className="h-full bg-accent/70"
                      style={{ width: `${row.pct.toFixed(1)}%` }}
                    />
                  </div>
                  <div className="text-sm num text-muted w-24 text-right shrink-0">
                    {row.n} ({row.pct.toFixed(0)}%)
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* SECTION 3 — Rule Hit-Rate Differential */}
      <section className="mb-6">
        <SectionTitle
          n={3}
          title="Rule Hit-Rate Differential"
          subtitle="Which rules separate winners from losers? Lift = winner% − loser%"
        />
        {ruleDiff.length === 0 ? (
          <Empty>
            Need both winners and losers (≤{" "}
            {rule_analysis.loser_threshold_pct}%) — not enough exits yet.
          </Empty>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted text-xs uppercase border-b border-border">
                <tr>
                  <th className="text-left p-3">Rule</th>
                  <th className="text-right p-3">Winner %</th>
                  <th className="text-right p-3">Loser %</th>
                  <th className="text-right p-3">Lift</th>
                </tr>
              </thead>
              <tbody>
                {ruleDiff.map((r) => (
                  <tr
                    key={r.rule_id}
                    className="border-b border-border/40 last:border-0"
                  >
                    <td className="p-3">
                      <div className="text-text">{r.rule_name}</div>
                      <div className="text-[10px] text-muted">{r.rule_id}</div>
                    </td>
                    <td className="p-3 text-right num text-emerald-400">
                      {r.winner_pct.toFixed(0)}%
                    </td>
                    <td className="p-3 text-right num text-red-400">
                      {r.loser_pct.toFixed(0)}%
                    </td>
                    <td
                      className={`p-3 text-right num font-semibold ${
                        r.lift > 0 ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      {r.lift > 0 ? "+" : ""}
                      {r.lift.toFixed(0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Primary buckets */}
        {rule_analysis.primary_pass_buckets.length > 0 && (
          <div className="mt-3">
            <div className="text-xs uppercase text-muted mb-2">
              Primary 14 — passed count vs avg return
            </div>
            <div className="card p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
              {rule_analysis.primary_pass_buckets.map((b) => (
                <div key={b.primary_passed} className="text-sm">
                  <div className="text-xs text-muted">
                    {b.primary_passed} passed (n={b.trades})
                  </div>
                  <div className={`num font-semibold ${colorByReturn(b.avg_return_pct)}`}>
                    {b.avg_return_pct >= 0 ? "+" : ""}
                    {b.avg_return_pct.toFixed(2)}%
                  </div>
                  <div className="text-[11px] text-muted">
                    win {b.win_rate_pct.toFixed(0)}%
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {bigWinnerRules.length > 0 && (
          <div className="mt-3">
            <div className="text-xs uppercase text-muted mb-2">
              +{rule_analysis.big_winner_threshold_pct}% Winners — common rules passed
            </div>
            <div className="card p-4 space-y-1.5">
              {bigWinnerRules.map((r) => (
                <div key={r.rule_id} className="flex items-center gap-3 text-sm">
                  <div className="flex-1 truncate">
                    <span>{r.rule_name}</span>
                    <span className="text-[10px] text-muted ml-2">
                      {r.rule_id}
                    </span>
                  </div>
                  <div className="num text-accent w-20 text-right">
                    {r.passed_pct.toFixed(0)}%
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* SECTION 4 — Sector / Market */}
      <section className="mb-6">
        <SectionTitle n={4} title="Sector & Market" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="card overflow-x-auto">
            <div className="px-4 pt-3 text-xs uppercase text-muted">By Sector</div>
            <table className="w-full text-sm">
              <thead className="text-muted text-xs uppercase border-b border-border">
                <tr>
                  <th className="text-left p-3">Sector</th>
                  <th className="text-right p-3">N</th>
                  <th className="text-right p-3">Win %</th>
                  <th className="text-right p-3">Avg Return</th>
                </tr>
              </thead>
              <tbody>
                {sector_breakdown.map((s) => (
                  <tr
                    key={s.sector}
                    className="border-b border-border/40 last:border-0"
                  >
                    <td className="p-3">{s.sector}</td>
                    <td className="p-3 text-right num">{s.trades}</td>
                    <td className="p-3 text-right num">
                      {s.win_rate_pct.toFixed(0)}%
                    </td>
                    <td
                      className={`p-3 text-right num ${colorByReturn(s.avg_return_pct)}`}
                    >
                      {s.avg_return_pct >= 0 ? "+" : ""}
                      {s.avg_return_pct.toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card overflow-x-auto">
            <div className="px-4 pt-3 text-xs uppercase text-muted">By Market</div>
            <table className="w-full text-sm">
              <thead className="text-muted text-xs uppercase border-b border-border">
                <tr>
                  <th className="text-left p-3">Market</th>
                  <th className="text-right p-3">N</th>
                  <th className="text-right p-3">Win %</th>
                  <th className="text-right p-3">Avg Return</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(market_breakdown).map(([m, v]) => (
                  <tr key={m} className="border-b border-border/40 last:border-0">
                    <td className="p-3">{m}</td>
                    <td className="p-3 text-right num">{v.trades}</td>
                    <td className="p-3 text-right num">
                      {v.win_rate_pct.toFixed(0)}%
                    </td>
                    <td
                      className={`p-3 text-right num ${colorByReturn(v.avg_return_pct)}`}
                    >
                      {v.avg_return_pct >= 0 ? "+" : ""}
                      {v.avg_return_pct.toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* SECTION 5 — Time-to-Profit Curve */}
      <section className="mb-6">
        <SectionTitle n={5} title="Time-to-Profit Curve" />
        <TimeCurveChart points={time_curve} />
      </section>

      {/* SECTION 6 — LLM Insights */}
      <section className="mb-10">
        <SectionTitle
          n={6}
          title="LLM Insights"
          subtitle={`Refreshed every ${data.thresholds.llm_refresh_days} days · Gemini 2.5 Flash`}
        />
        <LLMBlock data={llm_insights} />
      </section>

      <footer className="mt-8 pt-6 border-t border-border text-xs text-muted leading-relaxed">
        Win rate is computed on end-price (live for active, exit-price for
        closed). Lift compares rule pass-rate among winners (return &gt; 0) vs
        losers (return ≤ {data.thresholds.loser_pct}%). Past performance does
        not guarantee future results.
      </footer>
    </main>
  );
}

// ===== Subcomponents =====

function BackHome() {
  return (
    <nav className="mb-4 flex items-center gap-3 text-sm">
      <Link href="/" className="text-muted hover:text-accent">
        ← Home
      </Link>
      <span className="text-border">/</span>
      <Link href="/backtest" className="text-muted hover:text-accent">
        Backtest
      </Link>
    </nav>
  );
}

function SectionTitle({
  n,
  title,
  subtitle,
}: {
  n: number;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-3">
      <h2 className="text-lg md:text-xl font-semibold">
        <span className="text-muted mr-2">{n}.</span>
        {title}
      </h2>
      {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  color,
}: {
  label: string;
  value: string;
  hint?: string;
  color?: string;
}) {
  return (
    <div className="card p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={`text-xl md:text-2xl font-bold num ${color || ""}`}>
        {value}
      </div>
      {hint && <div className="text-[10px] text-muted mt-0.5">{hint}</div>}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="card p-4 text-sm text-muted">{children}</div>
  );
}

function TimeCurveChart({ points }: { points: TimeCurvePoint[] }) {
  const valid = points.filter((p) => p.avg_return_pct !== null);
  if (valid.length === 0) {
    return <Empty>Not enough trade history yet.</Empty>;
  }
  const W = 600;
  const H = 200;
  const PAD = { l: 40, r: 20, t: 16, b: 28 };
  const minY = Math.min(0, ...valid.map((p) => p.avg_return_pct as number));
  const maxY = Math.max(...valid.map((p) => p.avg_return_pct as number));
  const yRange = Math.max(maxY - minY, 1);
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  // X = log-spaced milestones
  const days = points.map((p) => p.day);
  const maxDay = Math.max(...days, 1);
  const x = (d: number) =>
    PAD.l + (Math.log(d + 1) / Math.log(maxDay + 1)) * innerW;
  const y = (v: number) =>
    PAD.t + innerH - ((v - minY) / yRange) * innerH;
  const linePoints = valid
    .map((p) => `${x(p.day)},${y(p.avg_return_pct as number)}`)
    .join(" ");
  const zeroY = y(0);

  return (
    <div className="card p-4 overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[700px]">
        {/* zero line */}
        <line
          x1={PAD.l}
          x2={W - PAD.r}
          y1={zeroY}
          y2={zeroY}
          stroke="#444"
          strokeDasharray="3 3"
        />
        {/* axis labels */}
        {points.map((p) => (
          <text
            key={p.day}
            x={x(p.day)}
            y={H - 8}
            textAnchor="middle"
            fontSize="10"
            fill="#9aa0a6"
          >
            {p.day}d
          </text>
        ))}
        {/* y axis labels */}
        <text x={4} y={PAD.t + 4} fontSize="10" fill="#9aa0a6">
          {maxY.toFixed(1)}%
        </text>
        <text x={4} y={H - PAD.b + 2} fontSize="10" fill="#9aa0a6">
          {minY.toFixed(1)}%
        </text>
        {/* curve */}
        <polyline
          points={linePoints}
          fill="none"
          stroke="#5eead4"
          strokeWidth="2"
        />
        {/* dots */}
        {valid.map((p) => (
          <g key={p.day}>
            <circle
              cx={x(p.day)}
              cy={y(p.avg_return_pct as number)}
              r="4"
              fill="#5eead4"
            />
            <text
              x={x(p.day)}
              y={y(p.avg_return_pct as number) - 8}
              textAnchor="middle"
              fontSize="10"
              fill="#e6e8eb"
            >
              {(p.avg_return_pct as number).toFixed(1)}%
            </text>
          </g>
        ))}
      </svg>
      <div className="mt-2 text-xs text-muted">
        Avg return at day-N for trades that reached that holding period.
        Winners% labels:{" "}
        {valid
          .map(
            (p) => `${p.day}d ${p.winners_pct?.toFixed(0)}% (n=${p.trades})`,
          )
          .join(" · ")}
      </div>
    </div>
  );
}

function LLMBlock({ data }: { data: LLMInsights }) {
  const hasContent =
    (data.winner_patterns && data.winner_patterns.length > 0) ||
    (data.loser_traps && data.loser_traps.length > 0) ||
    (data.rule_suggestions && data.rule_suggestions.length > 0);
  const updated = data.generated_at
    ? data.generated_at.slice(0, 16).replace("T", " ")
    : "—";

  if (!hasContent) {
    return (
      <Empty>
        {data.note ||
          data.error ||
          "Insights pending — add GEMINI_API_KEY to GitHub secrets and wait for the next weekly refresh."}
      </Empty>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <InsightCard
        title="승자 공통 패턴"
        items={data.winner_patterns}
        accent="text-emerald-400"
      />
      <InsightCard
        title="패배 함정"
        items={data.loser_traps}
        accent="text-red-400"
      />
      <InsightCard
        title="룰 제안"
        items={data.rule_suggestions}
        accent="text-accent"
      />
      <div className="md:col-span-3 text-[10px] text-muted">
        {data.model || "gemini"} · generated {updated} UTC
        {data.trades_analyzed
          ? ` · trades analyzed: ${data.trades_analyzed}`
          : ""}
      </div>
    </div>
  );
}

function InsightCard({
  title,
  items,
  accent,
}: {
  title: string;
  items: string[];
  accent: string;
}) {
  return (
    <div className="card p-4">
      <div className={`text-xs uppercase font-semibold mb-2 ${accent}`}>
        {title}
      </div>
      {items && items.length > 0 ? (
        <ul className="text-sm space-y-1.5 list-disc list-inside leading-relaxed">
          {items.map((it, i) => (
            <li key={i}>{it}</li>
          ))}
        </ul>
      ) : (
        <div className="text-xs text-muted">—</div>
      )}
    </div>
  );
}

import type { Candidate, RuleResult } from "../../types";

// Rule category mapping (primary = must-have core, secondary = bonus/confirmation)
const PRIMARY_IDS = [
  "A1_ud_vol_ratio",
  "B1_price_above_150_200",
  "B2_sma150_gt_sma200",
  "B3_sma50_gt_150_200",
  "B4_price_above_sma50",
  "B5_sma200_rising_5mo",
  "B6_30pct_above_52w_low",
  "B7_within_25pct_high",
  "R1_rs_70",
  "L1_liquidity_gate",
  "E7_roe",
  "F1_outperform_1y",
  "H4_ni_cagr_3y",
];

const SECONDARY_IDS = [
  "B8_within_10pct_high",
  "B9_stage2",
  "B10_higher_highs_lows",
  "R2_rs_80",
  "R3_rs_90",
  "V1_atr_contraction",
  "V2_short_term_tightening",
  "L2_liquidity_50m",
  "L3_share_volume",
  "L4_price_floor",
  "P1_tightening",
  "P2_last_contraction",
  "P3_vol_dryup",
  "P4_base_count",
  "P6_monotonic_decreasing",
  "E1_eps_growth",
  "E2_eps_yoy_accel",
  "E3_rev_growth",
  "E4_rev_yoy_accel",
  "E5_op_inc_growing",
  "E6_op_inc_yoy_accel",
  "E8_annual_eps_growth",
  "E9_eps_breakout",
  "E10_inst_ownership",
  "F2_outperform_6m",
  "F3_outperform_1m",
  "H1_short_float",
  "H2_cfps_to_eps",
  "H3_net_margin_high",
];

type RuleEntry = { id: string; rule: RuleResult };

function splitByCategory(rules: Record<string, RuleResult>) {
  const primary: RuleEntry[] = [];
  const secondary: RuleEntry[] = [];
  for (const id of PRIMARY_IDS) {
    if (rules[id]) primary.push({ id, rule: rules[id] });
  }
  for (const id of SECONDARY_IDS) {
    if (rules[id]) secondary.push({ id, rule: rules[id] });
  }
  // Sort within each group: failed first (attention), then passed
  const order = (a: RuleEntry, b: RuleEntry) =>
    Number(a.rule.passed) - Number(b.rule.passed);
  primary.sort(order);
  secondary.sort(order);
  return { primary, secondary };
}

function deviationText(rule: RuleResult): string {
  if (rule.value === null || rule.threshold === null) return "";
  const v = rule.value;
  const t = rule.threshold;
  // For ratio-based thresholds (threshold = 1.0 cascade rules)
  if (t === 1.0) {
    const pct = (v - 1) * 100;
    return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
  }
  // For "rising 21 days" (21.0) — show days
  if (t === 20.0 || t === 21.0) {
    return `${v.toFixed(0)}/${t.toFixed(0)} days`;
  }
  // For -10.0 threshold (52W high): v is pct below, pass if >= -10
  if (t === -10.0) {
    return `${v >= 0 ? "+" : ""}${v.toFixed(1)}% from high`;
  }
  // RS thresholds (70, 90)
  if (t === 70.0 || t === 90.0) {
    return `${v.toFixed(0)} (threshold ${t.toFixed(0)})`;
  }
  // Liquidity ($): format big number
  if (t >= 1_000_000) {
    const fmt = (n: number) => {
      if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
      if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
      return `$${n.toFixed(0)}`;
    };
    return `${fmt(v)} / ${fmt(t)}`;
  }
  // Percent thresholds (0.6 vol_ratio, 10 last_pct, etc)
  return `${v.toFixed(2)} vs ${t.toFixed(2)}`;
}

function RuleRow({ entry }: { entry: RuleEntry }) {
  const { rule } = entry;
  const Icon = rule.passed ? (
    <span className="text-emerald-400 font-bold w-4 inline-block">✓</span>
  ) : (
    <span className="text-red-400 font-bold w-4 inline-block">✗</span>
  );
  const textCls = rule.passed ? "text-text" : "text-text/90";
  return (
    <div className="flex items-start gap-2 py-1.5 text-sm border-b border-border/40 last:border-b-0">
      {Icon}
      <div className="flex-1 min-w-0">
        <div className={`${textCls} leading-tight`}>{rule.name}</div>
        {rule.value !== null && (
          <div className="text-xs text-muted num mt-0.5 tabular-nums">
            {deviationText(rule)}
          </div>
        )}
      </div>
    </div>
  );
}

export default function RuleScorecard({ candidate }: { candidate: Candidate }) {
  if (!candidate.rules) return null;
  const { primary, secondary } = splitByCategory(candidate.rules);
  const primaryPassed = primary.filter((e) => e.rule.passed).length;
  const secondaryPassed = secondary.filter((e) => e.rule.passed).length;

  return (
    <section className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
      {/* Primary */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Primary
          </h3>
          <div className="num text-sm font-bold tabular-nums">
            <span
              className={
                primaryPassed === primary.length
                  ? "text-emerald-400"
                  : primaryPassed >= primary.length - 1
                  ? "text-yellow-400"
                  : "text-muted"
              }
            >
              {primaryPassed}
            </span>
            <span className="text-muted">/{primary.length}</span>
          </div>
        </div>
        <div className="divide-y divide-border/40">
          {primary.map((e) => (
            <RuleRow key={e.id} entry={e} />
          ))}
        </div>
      </div>

      {/* Secondary */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Secondary
          </h3>
          <div className="num text-sm font-bold tabular-nums">
            <span
              className={
                secondaryPassed >= Math.ceil(secondary.length * 0.8)
                  ? "text-emerald-400"
                  : secondaryPassed >= secondary.length * 0.5
                  ? "text-yellow-400"
                  : "text-muted"
              }
            >
              {secondaryPassed}
            </span>
            <span className="text-muted">/{secondary.length}</span>
          </div>
        </div>
        <div className="divide-y divide-border/40">
          {secondary.map((e) => (
            <RuleRow key={e.id} entry={e} />
          ))}
        </div>
      </div>
    </section>
  );
}

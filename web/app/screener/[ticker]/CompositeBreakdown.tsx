import type { Candidate } from "../../types";

// Phase 1.4-alpha breakdown: visualize the 3 macro components feeding score_v2.
//   Technical  (legacy score_v1)  -- 0~100pt
//   Fundamentals                  -- 0~30pt  (US only; KR/HK = 0 fallback)
//   A1 Accumulation (sliding)     -- 0~5pt
// Normalized: (sum) * 100/135  ->  score_v2 (0~100).

function Bar({
  label,
  sublabel,
  value,
  max,
  color,
  caveat,
}: {
  label: string;
  sublabel?: string;
  value: number;
  max: number;
  color: "emerald" | "blue" | "amber";
  caveat?: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const colorCls = {
    emerald: "bg-emerald-500/80",
    blue: "bg-blue-500/80",
    amber: "bg-amber-500/80",
  }[color];
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-semibold truncate">{label}</span>
          {sublabel && (
            <span className="text-muted text-[10px] truncate">{sublabel}</span>
          )}
        </div>
        <div className="num tabular-nums shrink-0">
          <span className="font-semibold">{value.toFixed(1)}</span>
          <span className="text-muted"> / {max}</span>
        </div>
      </div>
      <div className="w-full h-2 bg-border/40 rounded overflow-hidden">
        <div className={`h-2 ${colorCls} rounded`} style={{ width: `${pct}%` }} />
      </div>
      {caveat && (
        <div className="text-[10px] text-yellow-400/80 mt-0.5">{caveat}</div>
      )}
    </div>
  );
}

function _ruleVal(c: Candidate, id: string): number | null {
  const r = c.rules?.[id];
  if (!r) return null;
  return typeof r.value === "number" ? r.value : null;
}

function FundamentalsSubBreakdown({ c }: { c: Candidate }) {
  if (c.fundamentals_basis === "fallback_kr_hk") {
    return (
      <div className="text-[11px] text-muted leading-relaxed pl-2 mt-1.5 border-l-2 border-yellow-500/30">
        ⚠️ KR/HK: yfinance Fundamentals 결손으로 30pt = 0 처리 (보수적).
        OpenDart 등 백필 데이터 확보 시 v1.5에서 재산정 예정.
      </div>
    );
  }
  const eps = _ruleVal(c, "E1_eps_growth");
  const sales = _ruleVal(c, "E3_rev_growth");
  const roe = _ruleVal(c, "E7_roe");
  const opGrow = c.rules?.E5_op_inc_growing?.passed ?? false;
  const opAccel = c.rules?.E6_op_inc_yoy_accel?.passed ?? false;

  const _fmt = (v: number | null, suffix = "") =>
    v === null ? "N/A" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}${suffix}`;

  const _epsCls =
    eps === null
      ? "text-muted"
      : eps >= 40
      ? "text-emerald-400"
      : eps >= 18
      ? "text-yellow-400"
      : "text-red-400";
  const _salesCls =
    sales === null
      ? "text-muted"
      : sales >= 30
      ? "text-emerald-400"
      : sales >= 15
      ? "text-yellow-400"
      : "text-red-400";
  const _roeCls =
    roe === null
      ? "text-muted"
      : roe >= 17
      ? "text-emerald-400"
      : roe >= 12
      ? "text-yellow-400"
      : "text-red-400";

  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] pl-2 mt-1.5 border-l-2 border-blue-500/30">
      <div>
        <span className="text-muted">EPS YoY:</span>{" "}
        <span className={`num ${_epsCls}`}>{_fmt(eps, "%")}</span>
        <span className="text-muted text-[10px]"> / 10pt (≥40% full)</span>
      </div>
      <div>
        <span className="text-muted">Sales YoY:</span>{" "}
        <span className={`num ${_salesCls}`}>{_fmt(sales, "%")}</span>
        <span className="text-muted text-[10px]"> / 8pt (≥30% full)</span>
      </div>
      <div>
        <span className="text-muted">ROE:</span>{" "}
        <span className={`num ${_roeCls}`}>{_fmt(roe, "%")}</span>
        <span className="text-muted text-[10px]"> / 7pt (≥17% full)</span>
      </div>
      <div>
        <span className="text-muted">Op Income:</span>{" "}
        <span className={opGrow ? "text-emerald-400" : "text-red-400"}>
          {opGrow ? "성장 ✓" : "✗"}
        </span>
        <span className="text-muted"> · </span>
        <span className={opAccel ? "text-emerald-400" : "text-red-400"}>
          {opAccel ? "가속 ✓" : "✗"}
        </span>
        <span className="text-muted text-[10px]"> / 5pt</span>
      </div>
    </div>
  );
}

export default function CompositeBreakdown({ candidate }: { candidate: Candidate }) {
  const v1 = candidate.score_v1 ?? 0;
  const fund = candidate.fundamentals_score ?? 0;
  const a1 = candidate.a1_pts ?? 0;
  const extPenalty = candidate.extended_penalty ?? 0;
  const total = v1 + fund + a1 - extPenalty;
  const v2 = candidate.score ?? 0;
  const a1Raw = _ruleVal(candidate, "A1_ud_vol_ratio");

  const isFallback = candidate.fundamentals_basis === "fallback_kr_hk";
  const strictTT = candidate.qualifies_strict !== false;  // undefined treated as legacy-pass
  const ttPenaltyApplied = candidate.qualifies_strict === false;

  return (
    <section className="card p-5 mb-6">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-base font-semibold">Composite Score v2 — 구성 분해</h2>
        <div className="num tabular-nums text-right">
          <div>
            <span className="text-accent text-2xl font-bold">{v2.toFixed(1)}</span>
            <span className="text-muted text-sm"> / 100</span>
          </div>
          {!strictTT && (
            <div className="text-[10px] text-yellow-400 mt-0.5">
              ⚠️ Trend Template 미통과 -15%
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <Bar
            label="Technical"
            sublabel="(RS · Stage · MA · 52W · VCP · RS Line)"
            value={v1}
            max={100}
            color="emerald"
          />
        </div>

        <div>
          <Bar
            label="Fundamentals"
            sublabel="(EPS · Sales · ROE · Op Inc)"
            value={fund}
            max={30}
            color="blue"
            caveat={isFallback ? "T*: 보수적 0pt fallback" : undefined}
          />
          <FundamentalsSubBreakdown c={candidate} />
        </div>

        <div>
          <Bar
            label="Institutional Accumulation"
            sublabel={
              a1Raw !== null ? `(A1 U/D Vol = ${a1Raw.toFixed(2)})` : "(A1)"
            }
            value={a1}
            max={5}
            color="amber"
          />
        </div>
      </div>

      <div className="border-t border-border pt-3 mt-4 flex flex-col gap-1.5 text-xs">
        {extPenalty > 0 && (
          <div className="flex justify-between text-yellow-400">
            <span>⚠️ Extended VCP penalty (pivot &gt; +8%)</span>
            <span className="num font-semibold tabular-nums">-{extPenalty.toFixed(1)}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-muted">Raw total (Technical + Fund + A1 - penalty)</span>
          <span className="num font-semibold tabular-nums">
            {total.toFixed(1)} / 135
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Normalized × (100 / 135)</span>
          <span className="num tabular-nums">
            {(total * 100 / 135).toFixed(1)}
          </span>
        </div>
        {ttPenaltyApplied && (
          <div className="flex justify-between text-yellow-400">
            <span>⚠️ Trend Template 미통과 × 0.85</span>
            <span className="num tabular-nums">→ {v2.toFixed(1)}</span>
          </div>
        )}
        <div className="flex justify-between pt-1 border-t border-border/50">
          <span className="text-muted font-semibold">Final v2</span>
          <span className="num text-accent font-bold tabular-nums">
            {v2.toFixed(1)} / 100
          </span>
        </div>
      </div>

      <div className="text-[10px] text-muted mt-3 leading-relaxed">
        v2 = Phase 1.4-α (2026-05-14). Minervini SEPA의 "Earnings" 차원
        Fundamentals 30pt + Volume Accumulation 5pt 추가, 기존 Technical 100pt와
        합산 후 135pt 기준 정규화. KR/HK는 yfinance Fundamentals 결손으로
        Fundamentals = 0 적용 (보수적). 이전 점수는{" "}
        <span className="num">{(candidate.score_v1 ?? 0).toFixed(1)}</span> (v1).
      </div>
    </section>
  );
}

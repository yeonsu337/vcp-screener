"""
Minervini Bot — per-ticker recommendation JSON generator.

Reads `web/public/data/results.json` (+ optional `macro.json`), classifies each
qualifying ticker into one of 5 verdicts (BUY_NOW / BUY_AT_PIVOT / WATCH /
EXTENDED / AVOID), and emits 4-5 Korean lines following the persona in
`docs/minervini-bot-persona.md`.

Pure deterministic — no LLM. Template-based Korean output for cost·
reproducibility·zero hallucination. Spec §8.4 "1차 출시: deterministic 템플릿".

Output: `web/public/data/minervini-bot/<safe_ticker>.json` (one file per
ticker), matching schema in spec §6.
"""
from __future__ import annotations
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "web" / "public" / "data"
OUT_DIR = DATA_DIR / "minervini-bot"
RESULTS_PATH = DATA_DIR / "results.json"
MACRO_PATH = DATA_DIR / "macro.json"
HISTORY_PATH = DATA_DIR / "detection_history.json"

SCHEMA = "minervini-bot.v1"

# -------- gate: filter candidates that deserve a recommendation -------------
# Aligned with run_daily.py / page.tsx soft-gate (Primary ≥12).
PRIMARY_IDS = [
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
]
PRIMARY_GATE = 12

# -------- Minervini Trend Template (8 criteria) -----------------------------
TT_RULES = [
    "B1_price_above_150_200",
    "B2_sma150_gt_sma200",
    "B5_sma200_rising_5mo",
    "B3_sma50_gt_150_200",
    "B4_price_above_sma50",
    "B6_30pct_above_52w_low",
    "B7_within_25pct_high",
    "R1_rs_70",
]

# -------- thresholds (spec §2-2, §2-3) --------------------------------------
LAST_CONTRACTION_MAX = 6.5     # P2 ideal
VOL_DRYUP_MAX = 0.60           # P3 ideal
BASE_DAYS_MIN = 28
BASE_DAYS_MAX = 84
BASE_DEPTH_MAX = 30.0
NUM_CONTRACTIONS_MIN = 2
NUM_CONTRACTIONS_MAX = 6
RS_LINE_FROM_HIGH_MIN = -5.0   # within 5% of high

# Verdict zone thresholds (% from pivot)
PCT_BUY_NOW_LO = 0.0
PCT_BUY_NOW_HI = 3.0
PCT_BUY_AT_PIVOT_LO = -5.0
PCT_BUY_AT_PIVOT_HI = 0.0
PCT_EXTENDED = 5.0

# Risk management (spec §2-4)
STOP_PCT = -7.0
TARGET1_PCT = 20.0
POSITION_RISK_PCT = 1.5

# STOP_OUT triggers for active tracking entries (spec §2-4 sell framework)
STOP_OUT_INITIAL_LOSS = -8.0     # EX1 ironclad stop from entry
STOP_OUT_TRAILING_FROM_PEAK = -15.0  # EX5 trailing after gain
STOP_OUT_TRAILING_KICK_IN = 10.0  # trailing only activates after +10%


def _rule_passed(rules: dict, rid: str) -> bool:
    r = rules.get(rid) if rules else None
    return bool(r and r.get("passed"))


def _count_primary(rules: dict) -> int:
    if not rules:
        return 0
    return sum(1 for rid in PRIMARY_IDS if _rule_passed(rules, rid))


def _trend_template_score(rules: dict) -> int:
    """0-8. R1_rs_70 is the gate; R2/R3 stronger but only the gate counts here."""
    if not rules:
        return 0
    return sum(1 for rid in TT_RULES if _rule_passed(rules, rid))


def _vcp_quality_score(row: dict) -> tuple[int, dict]:
    """
    8 dimensions (spec §2-2). Returns (score, breakdown).
    Each dimension counted only if data exists; missing → fail.
    """
    rules = row.get("rules") or {}
    n_contr = row.get("num_contractions") or 0
    last_contr = row.get("last_contraction_pct")
    base_days = row.get("base_days") or 0
    base_depth = row.get("base_depth_pct")
    vdu = row.get("volume_dryup_ratio")
    rs_line = row.get("rs_line_pct_from_high")

    d1 = NUM_CONTRACTIONS_MIN <= n_contr <= NUM_CONTRACTIONS_MAX
    d2 = _rule_passed(rules, "P6_monotonic_decreasing")
    d3 = last_contr is not None and last_contr <= LAST_CONTRACTION_MAX
    d4 = BASE_DAYS_MIN <= base_days <= BASE_DAYS_MAX
    d5 = base_depth is not None and base_depth <= BASE_DEPTH_MAX
    d6 = vdu is not None and vdu <= VOL_DRYUP_MAX
    d7 = _rule_passed(rules, "P4_base_count")
    d8 = rs_line is not None and rs_line >= RS_LINE_FROM_HIGH_MIN

    score = sum([d1, d2, d3, d4, d5, d6, d7, d8])
    breakdown = {
        "contraction_count": d1,
        "monotonic_decrease": d2,
        "last_contraction": d3,
        "base_length": d4,
        "base_depth": d5,
        "vol_dryup": d6,
        "base_count": d7,
        "rs_line": d8,
    }
    return score, breakdown


def _base_count_from_rule(rules: dict) -> int | None:
    """P4_base_count rule's `value` field holds the actual base number."""
    r = (rules or {}).get("P4_base_count")
    if not r:
        return None
    v = r.get("value")
    try:
        return int(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _classify_verdict(row: dict, tt_score: int, vcp_score: int) -> tuple[str, str]:
    """
    Decision matrix (spec §3, aligned with sample KEYS.json semantics):
      base_count is informational (warning + line addition), NOT a verdict gate.
      Order of checks:
        1. AVOID if TT ≤ 6 OR Stage ≠ 2 OR RS < 70
        2. EXTENDED if pct_to_pivot > +5%
        3. WATCH if VCP < 4 OR pct_to_pivot < -5%
        4. BUY_NOW if 0 ≤ pct_to_pivot ≤ +3% AND VCP ≥ 4
        5. BUY_AT_PIVOT if -5% ≤ pct_to_pivot < 0% AND VCP ≥ 4
        6. else WATCH (handles +3% < pct ≤ +5% edge)
    """
    rs = row.get("rs_rating") or 0
    stage = row.get("stage") or 0
    pct = row.get("pct_to_pivot")

    if tt_score <= 6 or stage != 2 or rs < 70:
        return "AVOID", "회피"
    if pct is not None and pct > PCT_EXTENDED:
        return "EXTENDED", "추격 위험"
    if vcp_score < 4 or pct is None or pct < PCT_BUY_AT_PIVOT_LO:
        return "WATCH", "관망"
    if PCT_BUY_NOW_LO <= pct <= PCT_BUY_NOW_HI:
        return "BUY_NOW", "매수 (Pivot 돌파 직후)"
    if PCT_BUY_AT_PIVOT_LO <= pct < PCT_BUY_AT_PIVOT_HI:
        return "BUY_AT_PIVOT", "매수 대기 (Pivot 돌파 시)"
    return "WATCH", "관망"


def _confidence(tt: int, vcp: int, rs: int, verdict: str) -> float:
    if verdict == "AVOID":
        return round(0.20 + (8 - tt) * 0.05, 2)
    base = (tt / 8.0) * 0.5 + (vcp / 8.0) * 0.3 + (min(rs, 99) / 100.0) * 0.2
    if verdict == "EXTENDED":
        base -= 0.15
    if verdict == "WATCH":
        base -= 0.10
    return round(max(0.0, min(1.0, base)), 2)


def _action(row: dict, verdict: str) -> dict:
    """Entry / stop / target price calculation per spec §5 Step 8."""
    pivot = row.get("pivot_price")
    current = row.get("current_price")
    if verdict == "AVOID":
        return _empty_action()
    if verdict == "EXTENDED":
        # No new entry — reference only
        return {
            "entry_type": "none",
            "entry_price": None,
            "stop_price": None,
            "stop_pct": None,
            "target1_price": None,
            "target1_pct": None,
            "trailing_rule": "close_below_sma50_on_volume",
            "position_risk_pct": POSITION_RISK_PCT,
        }
    if verdict == "WATCH":
        return _empty_action()
    entry = current if verdict == "BUY_NOW" else pivot
    if entry is None:
        return _empty_action()
    stop = round(entry * (1 + STOP_PCT / 100.0), 2)
    target1 = round(entry * (1 + TARGET1_PCT / 100.0), 2)
    return {
        "entry_type": "immediate" if verdict == "BUY_NOW" else "pivot_breakout",
        "entry_price": round(entry, 2),
        "stop_price": stop,
        "stop_pct": STOP_PCT,
        "target1_price": target1,
        "target1_pct": TARGET1_PCT,
        "trailing_rule": "close_below_sma50_on_volume",
        "position_risk_pct": POSITION_RISK_PCT,
    }


def _empty_action() -> dict:
    return {
        "entry_type": "none",
        "entry_price": None,
        "stop_price": None,
        "stop_pct": None,
        "target1_price": None,
        "target1_pct": None,
        "trailing_rule": None,
        "position_risk_pct": POSITION_RISK_PCT,
    }


def _currency_symbol(market: str | None) -> str:
    return {"US": "$", "KR": "₩", "HK": "HK$"}.get(market or "US", "$")


def _contractions_str(row: dict) -> str:
    cs = row.get("contractions") or []
    if not cs:
        return "수축 데이터 없음"
    return " → ".join(f"{c:.1f}%" for c in cs[:5])


def _key_failures(row: dict, tt: int, vcp_breakdown: dict) -> list[str]:
    fails = []
    rules = row.get("rules") or {}
    if not _rule_passed(rules, "P2_last_contraction"):
        lc = row.get("last_contraction_pct")
        if lc is not None:
            fails.append(f"P2_last_contraction ({lc:.2f}% vs {LAST_CONTRACTION_MAX}%)")
    if not _rule_passed(rules, "P3_vol_dryup"):
        vdu = row.get("volume_dryup_ratio")
        if vdu is not None:
            fails.append(f"P3_vol_dryup ({vdu:.2f}× vs {VOL_DRYUP_MAX}×)")
    if not _rule_passed(rules, "P4_base_count"):
        bc = _base_count_from_rule(rules)
        if bc is not None:
            fails.append(f"P4_base_count ({bc} — 후기 베이스)")
    if not _rule_passed(rules, "P6_monotonic_decreasing"):
        fails.append("P6_monotonic_decreasing (수축 단조 감소 위반)")
    if not _rule_passed(rules, "H4_ni_cagr_3y"):
        fails.append("H4_ni_cagr_3y (NI CAGR 미달)")
    if not vcp_breakdown.get("rs_line"):
        rsl = row.get("rs_line_pct_from_high")
        if rsl is not None:
            fails.append(f"rs_line ({rsl:.1f}% vs ≥{RS_LINE_FROM_HIGH_MIN}%)")
    if tt < 8:
        missing = [rid for rid in TT_RULES if not _rule_passed(rules, rid)]
        if missing:
            fails.append("Trend Template fail: " + ", ".join(missing))
    return fails[:6]


def _warnings(row: dict, verdict: str) -> list[str]:
    warns = []
    base_count = _base_count_from_rule(row.get("rules") or {})
    if base_count and base_count >= 3:
        warns.append(f"베이스 카운트 {base_count} — 후기 베이스, 실패율 상승")
    if (row.get("base_depth_pct") or 0) > 25 and verdict not in ("AVOID",):
        warns.append(f"베이스 깊이 {row['base_depth_pct']:.1f}% — 25% 초과로 변동성 큼")
    rs = row.get("rs_rating") or 0
    if 70 <= rs < 80 and verdict not in ("AVOID",):
        warns.append(f"RS {rs} — Minervini 선호 80+ 미달, 강도 평균")
    return warns


def _market_regime() -> str:
    """
    Simple regime from macro.json US Fear & Greed.
      < 25 → bear, > 75 → bull (overheated/neutral mix), else neutral.
    Fallback: neutral.
    """
    if not MACRO_PATH.exists():
        return "neutral"
    try:
        m = json.loads(MACRO_PATH.read_text(encoding="utf-8"))
        for item in (m.get("us", {}) or {}).get("sentiment", []) or []:
            if item.get("id") == "us_fg":
                v = item.get("value")
                if v is None:
                    return "neutral"
                if v < 25:
                    return "bear"
                if v > 75:
                    return "neutral"  # overheated but not bear; spec leaves room
                return "neutral"
    except Exception:
        pass
    return "neutral"


# ----------------------------- Korean line templates ------------------------

def _lines_buy_now(row, sym, tt, vcp, regime) -> list[str]:
    pivot = row.get("pivot_price") or 0
    current = row.get("current_price") or 0
    pct = row.get("pct_to_pivot") or 0
    rs = row.get("rs_rating") or 0
    rsl = row.get("rs_line_pct_from_high")
    base_weeks = round((row.get("base_days") or 0) / 7)
    vdu = row.get("volume_dryup_ratio") or 0
    stop = round(current * (1 + STOP_PCT / 100.0), 2)
    target1 = round(current * (1 + TARGET1_PCT / 100.0), 2)
    rsl_str = f"{rsl:+.1f}%" if rsl is not None else "데이터 없음"
    lines = [
        f"매수 — Stage 2 진입 확정, pivot {sym}{pivot:.2f} 돌파(+{pct:.2f}%, buy zone).",
        f"{base_weeks}주 베이스 {_contractions_str(row)} 수축, VDU {vdu:.2f}× 진행.",
        f"Trend Template {tt}/8 통과, RS {rs}, RS 라인 신고가 {rsl_str}.",
        f"{sym}{current:.2f} 매수·-7% 손절({sym}{stop:.2f})·+20%({sym}{target1:.2f}) 절반 익절, 이후 50일선 trailing.",
    ]
    if regime == "bear":
        lines.insert(0, "시장 약세 — 신규 진입 보류 권고, 신호 참고만.")
    return lines


def _lines_buy_at_pivot(row, sym, tt, vcp, regime) -> list[str]:
    pivot = row.get("pivot_price") or 0
    pct = row.get("pct_to_pivot") or 0
    rs = row.get("rs_rating") or 0
    rsl = row.get("rs_line_pct_from_high")
    base_weeks = round((row.get("base_days") or 0) / 7)
    vdu = row.get("volume_dryup_ratio") or 0
    stop = round(pivot * (1 + STOP_PCT / 100.0), 2)
    target1 = round(pivot * (1 + TARGET1_PCT / 100.0), 2)
    rsl_str = f"{rsl:+.1f}%" if rsl is not None else "데이터 없음"
    lines = [
        f"매수 대기 — Stage 2 진입, pivot {sym}{pivot:.2f} 근접({pct:+.2f}%).",
        f"{base_weeks}주 베이스 {_contractions_str(row)} 수축, VDU {vdu:.2f}× 진행.",
        f"Trend Template {tt}/8 통과, RS {rs}, RS 라인 신고가 {rsl_str}.",
        f"{sym}{pivot:.2f} 돌파 시 매수·-7% 손절({sym}{stop:.2f})·+20%({sym}{target1:.2f}) 절반 익절.",
    ]
    if regime == "bear":
        lines.insert(0, "시장 약세 — 신규 진입 보류 권고, 신호 참고만.")
    return lines


def _lines_watch(row, sym, tt, vcp, regime) -> list[str]:
    pivot = row.get("pivot_price")
    pct = row.get("pct_to_pivot")
    rs = row.get("rs_rating") or 0
    last_c = row.get("last_contraction_pct")
    n_contr = row.get("num_contractions") or 0
    base_weeks = round((row.get("base_days") or 0) / 7)
    vdu = row.get("volume_dryup_ratio") or 0
    pivot_str = f"{sym}{pivot:.2f}" if pivot else "미산출"
    pct_str = f"{pct:+.2f}%" if pct is not None else "데이터 없음"
    last_c_str = f"{last_c:.2f}%" if last_c is not None else "—"
    lines = [
        f"관망 — Stage 2 진입, VCP 미숙성(수축 {n_contr}회, 마지막 {last_c_str}).",
        f"{base_weeks}주 베이스 {_contractions_str(row)}, VDU {vdu:.2f}×, pivot {pivot_str}({pct_str}).",
        f"Trend Template {tt}/8 통과, RS {rs} — 추세는 살아있음.",
        f"Setup 재형성 대기. 수축 ≥3회 + 마지막 ≤{LAST_CONTRACTION_MAX}% + VDU ≤{VOL_DRYUP_MAX}× 충족 시 재평가.",
    ]
    if regime == "bear":
        lines.insert(0, "시장 약세 — 매수 신호 자체 보류.")
    return lines


def _lines_extended(row, sym, tt, vcp, regime) -> list[str]:
    pivot = row.get("pivot_price") or 0
    current = row.get("current_price") or 0
    pct = row.get("pct_to_pivot") or 0
    rs = row.get("rs_rating") or 0
    base_weeks = round((row.get("base_days") or 0) / 7)
    vdu = row.get("volume_dryup_ratio") or 0
    base_count = _base_count_from_rule(row.get("rules") or {})
    late_base_note = f", 베이스 카운트 {base_count}" if (base_count and base_count >= 4) else ""
    lines = [
        f"추격 위험 — Pivot {sym}{pivot:.2f} 대비 {pct:+.1f}%, buy zone 초과{late_base_note}.",
        f"{base_weeks}주 베이스 {_contractions_str(row)}, VDU {vdu:.2f}× — setup 자체는 유효.",
        f"Trend Template {tt}/8 + RS {rs}로 추세는 살아있음.",
        f"신규 진입 보류·다음 수축 형성 대기. 현 시점 신규 매수 부적합.",
    ]
    if regime == "bear":
        lines.insert(0, "시장 약세 — 보유분도 trailing 강화 권고.")
    return lines


def _lines_stop_out(row, sym, hist, reason_label) -> list[str]:
    """Build STOP_OUT lines from detection_history entry + current screener row."""
    det_px = hist.get("detection_price") or 0
    cur_px = row.get("current_price") or hist.get("current_price") or det_px
    ret = hist.get("return_pct")
    peak = hist.get("max_return_pct")
    rs = row.get("rs_rating") or hist.get("rs_rating") or 0
    stage = row.get("stage") or hist.get("stage") or 0
    first = hist.get("first_detected") or "—"
    ret_s = f"{ret:+.1f}%" if ret is not None else "n/a"
    peak_s = f"{peak:+.1f}%" if peak is not None else "n/a"
    return [
        f"청산 — {reason_label}, 현재 손익 {ret_s} (Peak {peak_s}).",
        f"진입 {first} @ {sym}{det_px:.2f} → 현재 {sym}{cur_px:.2f}.",
        f"Stage {stage}, RS {rs}. Minervini ironclad 손절 룰 발화 — 협의 불가.",
        f"전량 청산 후 새 진입 setup 형성 대기. 손실 누적 금지.",
    ]


def _lines_avoid(row, sym, tt, vcp, regime) -> list[str]:
    rs = row.get("rs_rating") or 0
    stage = row.get("stage") or 0
    base_depth = row.get("base_depth_pct")
    last_c = row.get("last_contraction_pct")
    vdu = row.get("volume_dryup_ratio")
    base_depth_str = f"{base_depth:.1f}%" if base_depth is not None else "—"
    last_c_str = f"{last_c:.2f}%" if last_c is not None else "—"
    vdu_str = f"{vdu:.2f}×" if vdu is not None else "—"

    reasons = []
    if tt <= 6:
        reasons.append(f"TT {tt}/8 fail")
    if stage != 2:
        reasons.append(f"Stage {stage} (≠2)")
    if rs < 70:
        reasons.append(f"RS {rs} 미달")
    reason_str = " / ".join(reasons) if reasons else "추세 미형성"

    lines = [
        f"회피 — {reason_str}.",
        f"베이스 깊이 {base_depth_str}, 마지막 수축 {last_c_str}, VDU {vdu_str}.",
        f"Minervini Trend Template {tt}/8 — 진입 조건 미충족.",
        f"신호 없음. 다른 종목 우선 검토.",
    ]
    return lines


VERDICT_LINE_FN = {
    "BUY_NOW": _lines_buy_now,
    "BUY_AT_PIVOT": _lines_buy_at_pivot,
    "WATCH": _lines_watch,
    "EXTENDED": _lines_extended,
    "AVOID": _lines_avoid,
}


# ----------------------------- main per-ticker build ------------------------

def _safe_filename(ticker: str) -> str:
    return ticker.replace(".", "_")


def _dedupe(seq) -> list:
    seen = set()
    out = []
    for x in seq:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def _check_stop_out(hist: dict) -> str | None:
    """Inspect a detection_history entry for STOP_OUT triggers.

    Returns a human-readable reason label, or None if no stop fires.
    Aligned with run_daily.py exit rules: EX1 -8% from entry, EX5 trailing
    -15% from peak (after peak ≥ +10%).
    """
    if hist.get("exited"):
        return None
    ret = hist.get("return_pct")
    peak = hist.get("max_return_pct")

    if ret is not None and ret <= STOP_OUT_INITIAL_LOSS:
        return f"진입 후 {ret:+.1f}% (-8% 초기 손절선 도달)"

    if (
        peak is not None
        and peak >= STOP_OUT_TRAILING_KICK_IN
        and ret is not None
        and (ret - peak) <= STOP_OUT_TRAILING_FROM_PEAK
    ):
        return f"Peak +{peak:.1f}%에서 {(ret - peak):.1f}% 후퇴 (Trailing -15% 발화)"
    return None


def build_stop_out_call(
    ticker: str,
    hist: dict,
    row: dict | None,
    regime: str,
    source_date: str,
    reason_label: str,
) -> dict:
    """STOP_OUT verdict for an active tracking entry that hit a stop."""
    market = (row or {}).get("market") or hist.get("market") or "US"
    sym = _currency_symbol(market)
    lines = _lines_stop_out(row or {}, sym, hist, reason_label)
    rs = (row or {}).get("rs_rating") or hist.get("rs_rating") or 0
    stage = (row or {}).get("stage") or hist.get("stage") or 0

    return {
        "$schema": SCHEMA,
        "ticker": ticker,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_results_date": source_date,
        "verdict": "STOP_OUT",
        "verdict_kr": "청산 (Stop hit)",
        "confidence": 0.95,
        "lines": lines,
        "action": {
            "entry_type": "none",
            "entry_price": None,
            "stop_price": None,
            "stop_pct": None,
            "target1_price": None,
            "target1_pct": None,
            "trailing_rule": None,
            "position_risk_pct": POSITION_RISK_PCT,
        },
        "framework": {
            "trend_template_score": "—",
            "vcp_quality_score": "—",
            "rs_rating": rs,
            "stage": stage,
            "base_count": 0,
            "late_base_warning": False,
            "market_regime": regime,
        },
        "rule_references": [],
        "key_failures": [reason_label],
        "warnings": [
            f"진입가 {sym}{(hist.get('detection_price') or 0):.2f} · "
            f"감지일 {hist.get('first_detected', '—')}",
            "포지션 전량 청산 후 새 setup 형성 시까지 신규 진입 금지",
        ],
    }


def build_call(row: dict, regime: str, source_date: str) -> dict | None:
    rules = row.get("rules") or {}
    tt = _trend_template_score(rules)
    vcp, vcp_breakdown = _vcp_quality_score(row)
    verdict, verdict_kr = _classify_verdict(row, tt, vcp)
    rs = row.get("rs_rating") or 0
    conf = _confidence(tt, vcp, rs, verdict)
    sym = _currency_symbol(row.get("market"))

    lines_fn = VERDICT_LINE_FN[verdict]
    lines = lines_fn(row, sym, tt, vcp, regime)

    # Enforce hard cap: 70 chars per line (UI safety)
    for i, line in enumerate(lines):
        if len(line) > 80:
            lines[i] = line[:78] + "…"

    base_count = _base_count_from_rule(rules)
    market_regime_label = regime

    return {
        "$schema": SCHEMA,
        "ticker": row["ticker"],
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_results_date": source_date,
        "verdict": verdict,
        "verdict_kr": verdict_kr,
        "confidence": conf,
        "lines": lines,
        "action": _action(row, verdict),
        "framework": {
            "trend_template_score": f"{tt}/8",
            "vcp_quality_score": f"{vcp}/8",
            "rs_rating": rs,
            "stage": row.get("stage") or 0,
            "base_count": base_count if base_count is not None else 0,
            "late_base_warning": bool(base_count and base_count >= 3),
            "market_regime": market_regime_label,
        },
        "rule_references": _dedupe(
            rid for rid in (
                PRIMARY_IDS + TT_RULES
                + ["P6_monotonic_decreasing", "P2_last_contraction", "P3_vol_dryup", "R2_rs_80", "R3_rs_90"]
            )
            if _rule_passed(rules, rid)
        ),
        "key_failures": _key_failures(row, tt, vcp_breakdown),
        "warnings": _warnings(row, verdict),
    }


def main() -> int:
    if not RESULTS_PATH.exists():
        print(f"[minervini] results.json missing: {RESULTS_PATH}", file=sys.stderr)
        return 1

    rows = json.loads(RESULTS_PATH.read_text(encoding="utf-8"))
    regime = _market_regime()

    # Pick source date from meta if available
    source_date = ""
    meta_p = DATA_DIR / "meta.json"
    if meta_p.exists():
        try:
            meta = json.loads(meta_p.read_text(encoding="utf-8"))
            source_date = (meta.get("updated_at") or "")[:10]
        except Exception:
            pass

    # Filter: detected OR primary ≥ 12
    candidates = []
    for r in rows:
        if r.get("detected"):
            candidates.append(r)
            continue
        if _count_primary(r.get("rules") or {}) >= PRIMARY_GATE:
            candidates.append(r)

    print(f"[minervini] regime={regime}  candidates={len(candidates)}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # De-duplicate keep set (clean stale)
    keep: set[str] = set()
    written = 0
    stopped_out: set[str] = set()
    by_verdict: dict[str, int] = {}

    # Step 1 — STOP_OUT pass over active tracking entries.
    # Held-position stops take precedence: a ticker that hit -8% from entry
    # gets a STOP_OUT call regardless of whether it still passes the Primary
    # 12+ gate today.
    history = {}
    if HISTORY_PATH.exists():
        try:
            history = json.loads(HISTORY_PATH.read_text(encoding="utf-8"))
        except Exception:
            history = {}

    rows_by_ticker = {r["ticker"]: r for r in rows}
    for ticker, hist in history.items():
        if hist.get("exited"):
            continue
        reason = _check_stop_out(hist)
        if not reason:
            continue
        row = rows_by_ticker.get(ticker)
        call = build_stop_out_call(ticker, hist, row, regime, source_date, reason)
        fname = _safe_filename(ticker) + ".json"
        (OUT_DIR / fname).write_text(
            json.dumps(call, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        keep.add(fname)
        stopped_out.add(ticker)
        by_verdict["STOP_OUT"] = by_verdict.get("STOP_OUT", 0) + 1
        written += 1

    # Step 2 — standard verdict pass for screener candidates.
    # Skip tickers already classified as STOP_OUT in step 1.
    for row in candidates:
        if row["ticker"] in stopped_out:
            continue
        call = build_call(row, regime, source_date)
        if not call:
            continue
        fname = _safe_filename(call["ticker"]) + ".json"
        (OUT_DIR / fname).write_text(
            json.dumps(call, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        keep.add(fname)
        written += 1
        v = call["verdict"]
        by_verdict[v] = by_verdict.get(v, 0) + 1

    # Cleanup files not in current batch
    removed = 0
    for f in OUT_DIR.glob("*.json"):
        if f.name not in keep:
            f.unlink()
            removed += 1

    print(f"[minervini] wrote={written}  removed_stale={removed}")
    for v, n in sorted(by_verdict.items(), key=lambda kv: -kv[1]):
        print(f"  {v:14s} {n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

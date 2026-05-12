"""
Lessons Learned analyzer.

Reads:
  web/public/data/detection_history.json   — every ticker ever detected (active + exited)
  web/public/data/results.json             — latest 42-rule evaluation for each candidate

Writes:
  web/public/data/lessons.json             — aggregated stats + (weekly) Gemini insights

5 categories:
  A. Win/Loss statistics (quantitative)
  B. Detection-rule vs outcome
  C. Sector / market patterns
  D. Time-based curves
  E. LLM insight digest (Gemini 2.5 Flash, refreshed every 7 days)

Free-tier only. No new pip deps. Graceful fallback when there are no exits.

Usage:
    python scripts/lessons_analyzer.py
"""
from __future__ import annotations

import json
import os
import statistics
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _secrets import clean_api_key  # noqa: E402

import requests

PROJ = Path(__file__).parent.parent
DATA = PROJ / "web" / "public" / "data"
HISTORY_PATH = DATA / "detection_history.json"
RESULTS_PATH = DATA / "results.json"
OUT_PATH = DATA / "lessons.json"

# ---- Thresholds ----------------------------------------------------------
WINNER_BIG_PCT = 50.0       # +50% → "big winner"
WINNER_PCT = 30.0           # +30% → secondary winner threshold
LOSER_PCT = -10.0           # ≤ -10% → loser (used for rule lift)
LLM_REFRESH_DAYS = 7

# Mark Minervini Primary 14 (mirrors run_daily / company_research)
PRIMARY_IDS: list[str] = [
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

# ---- Gemini --------------------------------------------------------------
GEMINI_MODEL = "gemini-2.5-flash"
GEMINI_URL = (
    f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
)


# =========================================================================
# Loading
# =========================================================================

def load() -> tuple[dict[str, dict], dict[str, dict]]:
    history = {}
    if HISTORY_PATH.exists():
        try:
            history = json.loads(HISTORY_PATH.read_text(encoding="utf-8"))
        except Exception:
            history = {}
    results_by_ticker: dict[str, dict] = {}
    if RESULTS_PATH.exists():
        try:
            rows = json.loads(RESULTS_PATH.read_text(encoding="utf-8"))
            if isinstance(rows, list):
                results_by_ticker = {r["ticker"]: r for r in rows if "ticker" in r}
        except Exception:
            results_by_ticker = {}
    return history, results_by_ticker


# =========================================================================
# Helpers
# =========================================================================

def days_between(a: str, b: str) -> int:
    try:
        return (datetime.fromisoformat(b) - datetime.fromisoformat(a)).days
    except Exception:
        return 0


def safe_pct(price_now: float | None, price_then: float | None) -> float | None:
    if price_now is None or price_then is None or price_then == 0:
        return None
    return (price_now - price_then) / price_then * 100.0


def classify_exit_reason(reasons: list[str] | None) -> str:
    """Map a list of free-text exit reasons to a single bucket."""
    if not reasons:
        return "EX0_unknown"
    text = " ".join(r.lower() for r in reasons)
    # Ordered: stop > rs > 50dma > drawdown(trailing) > absent
    if "drawdown" in text and "limit -8" in text:
        return "EX1_stop_8pct"
    if "stop" in text and "8" in text:
        return "EX1_stop_8pct"
    if "rs" in text and ("collapse" in text or "<" in text or "below" in text):
        return "EX3_rs_collapse"
    if "50dma" in text or "50d ma" in text or "sma50" in text or "50-day" in text:
        return "EX4_50dma_break"
    if "drawdown" in text:
        return "EX5_trailing"
    if "absent" in text:
        return "EX6_absent"
    return "EX0_unknown"


def normalize_entry(ticker: str, h: dict) -> dict | None:
    """Return a flat trade record. Returns None if essential data missing."""
    det = h.get("detection_price")
    if det is None or det == 0:
        return None
    cur = h.get("current_price")
    if h.get("exited"):
        end_price = h.get("exit_price") or cur
        end_date = h.get("exit_date") or h.get("last_seen")
    else:
        end_price = cur
        end_date = h.get("last_seen") or h.get("first_detected")
    ret = safe_pct(end_price, det)
    if ret is None:
        return None
    holding = days_between(h.get("first_detected", ""), end_date or h.get("first_detected", ""))
    return {
        "ticker": ticker,
        "company": h.get("company") or "",
        "market": h.get("market") or "US",
        "first_detected": h.get("first_detected"),
        "detection_price": det,
        "detection_score": h.get("detection_score"),
        "rs_rating": h.get("rs_rating"),
        "exited": bool(h.get("exited")),
        "exit_date": h.get("exit_date"),
        "exit_reason_bucket": classify_exit_reason(h.get("exit_reasons")),
        "end_price": end_price,
        "return_pct": ret,
        "holding_days": max(holding, 0),
    }


# =========================================================================
# Category A — Win/Loss statistics
# =========================================================================

def analyze_performance(trades: list[dict]) -> dict:
    if not trades:
        return _empty_perf()
    rets = [t["return_pct"] for t in trades]
    winners = [r for r in rets if r > 0]
    losers = [r for r in rets if r <= 0]

    win_sum = sum(winners)
    loss_sum_abs = abs(sum(losers))
    profit_factor = (win_sum / loss_sum_abs) if loss_sum_abs > 0 else None
    win_rate = len(winners) / len(rets) * 100
    avg_winner = statistics.mean(winners) if winners else 0.0
    avg_loser = statistics.mean(losers) if losers else 0.0
    expectancy = (
        (win_rate / 100.0) * avg_winner + ((100 - win_rate) / 100.0) * avg_loser
    )

    best = max(trades, key=lambda t: t["return_pct"])
    worst = min(trades, key=lambda t: t["return_pct"])

    # Holding period split
    win_holding = [t["holding_days"] for t in trades if t["return_pct"] > 0]
    lose_holding = [t["holding_days"] for t in trades if t["return_pct"] <= 0]

    return {
        "win_rate_pct": round(win_rate, 1),
        "profit_factor": round(profit_factor, 2) if profit_factor is not None else None,
        "expectancy": round(expectancy, 2),
        "avg_winner_pct": round(avg_winner, 2),
        "avg_loser_pct": round(avg_loser, 2),
        "best": {"ticker": best["ticker"], "return_pct": round(best["return_pct"], 1)},
        "worst": {"ticker": worst["ticker"], "return_pct": round(worst["return_pct"], 1)},
        "avg_holding_winner_days": round(statistics.mean(win_holding), 1) if win_holding else None,
        "avg_holding_loser_days": round(statistics.mean(lose_holding), 1) if lose_holding else None,
    }


def _empty_perf() -> dict:
    return {
        "win_rate_pct": None,
        "profit_factor": None,
        "expectancy": None,
        "avg_winner_pct": None,
        "avg_loser_pct": None,
        "best": None,
        "worst": None,
        "avg_holding_winner_days": None,
        "avg_holding_loser_days": None,
    }


# =========================================================================
# Category B — Rule vs outcome
# =========================================================================

def analyze_rules(trades: list[dict], results_by_ticker: dict[str, dict]) -> dict:
    """Compare rule pass-rates between winners and losers.

    Returns:
      - primary_pass_buckets: bucket trades by # of Primary rules passed → avg return + win rate
      - rule_hit_rate_diff: per-rule [winner% vs loser% vs lift]
      - winners_50pct_rules: top common rules among +50% trades
    """
    # Index trades by category
    winners = [t for t in trades if t["return_pct"] > 0]
    losers = [t for t in trades if t["return_pct"] <= LOSER_PCT]
    big_winners = [t for t in trades if t["return_pct"] >= WINNER_BIG_PCT]

    # Primary pass buckets
    bucket_to_returns: dict[int, list[float]] = defaultdict(list)
    for t in trades:
        r = results_by_ticker.get(t["ticker"])
        if not r:
            continue
        rules = r.get("rules") or {}
        n_pass = sum(1 for rid in PRIMARY_IDS if rules.get(rid, {}).get("passed"))
        bucket_to_returns[n_pass].append(t["return_pct"])
    primary_buckets = []
    for n in sorted(bucket_to_returns.keys()):
        rets = bucket_to_returns[n]
        wins = sum(1 for r in rets if r > 0)
        primary_buckets.append({
            "primary_passed": n,
            "trades": len(rets),
            "avg_return_pct": round(statistics.mean(rets), 2),
            "win_rate_pct": round(wins / len(rets) * 100, 1),
        })

    # Rule lift: hit rate among winners vs losers
    rule_diff = []
    if winners and losers:
        # Collect ALL rule IDs from any matched trade
        all_rule_ids: set[str] = set()
        for t in trades:
            r = results_by_ticker.get(t["ticker"])
            if r and isinstance(r.get("rules"), dict):
                all_rule_ids.update(r["rules"].keys())

        for rid in sorted(all_rule_ids):
            w_pass = w_total = 0
            l_pass = l_total = 0
            rule_name = rid
            for t in winners:
                r = results_by_ticker.get(t["ticker"])
                if not r:
                    continue
                rd = (r.get("rules") or {}).get(rid)
                if rd is None:
                    continue
                w_total += 1
                if rd.get("passed"):
                    w_pass += 1
                if rd.get("name") and rule_name == rid:
                    rule_name = rd["name"]
            for t in losers:
                r = results_by_ticker.get(t["ticker"])
                if not r:
                    continue
                rd = (r.get("rules") or {}).get(rid)
                if rd is None:
                    continue
                l_total += 1
                if rd.get("passed"):
                    l_pass += 1
            if w_total < 2 or l_total < 2:
                continue
            w_pct = w_pass / w_total * 100
            l_pct = l_pass / l_total * 100
            rule_diff.append({
                "rule_id": rid,
                "rule_name": rule_name,
                "winner_pct": round(w_pct, 1),
                "loser_pct": round(l_pct, 1),
                "lift": round(w_pct - l_pct, 1),
                "winner_n": w_total,
                "loser_n": l_total,
            })
        rule_diff.sort(key=lambda r: r["lift"], reverse=True)

    # Big winners common pattern: which rules did most of them pass?
    big_winner_rules = []
    if big_winners:
        rule_hits: Counter = Counter()
        rule_names: dict[str, str] = {}
        for t in big_winners:
            r = results_by_ticker.get(t["ticker"])
            if not r:
                continue
            for rid, rd in (r.get("rules") or {}).items():
                if rd.get("passed"):
                    rule_hits[rid] += 1
                    if rd.get("name"):
                        rule_names[rid] = rd["name"]
        for rid, n in rule_hits.most_common(15):
            big_winner_rules.append({
                "rule_id": rid,
                "rule_name": rule_names.get(rid, rid),
                "passed_count": n,
                "passed_pct": round(n / len(big_winners) * 100, 1),
            })

    return {
        "primary_pass_buckets": primary_buckets,
        "rule_hit_rate_diff": rule_diff[:25],   # top 25 by lift
        "big_winners_common_rules": big_winner_rules,
        "loser_threshold_pct": LOSER_PCT,
        "big_winner_threshold_pct": WINNER_BIG_PCT,
    }


# =========================================================================
# Category C — Sector / market patterns
# =========================================================================

def analyze_sectors(trades: list[dict], results_by_ticker: dict[str, dict]) -> list[dict]:
    sector_trades: dict[str, list[dict]] = defaultdict(list)
    for t in trades:
        r = results_by_ticker.get(t["ticker"])
        sector = (r.get("sector") if r else None) or "Unknown"
        sector_trades[sector].append(t)
    out = []
    for sector, ts in sector_trades.items():
        if not ts:
            continue
        rets = [x["return_pct"] for x in ts]
        wins = sum(1 for r in rets if r > 0)
        out.append({
            "sector": sector,
            "trades": len(ts),
            "win_rate_pct": round(wins / len(ts) * 100, 1),
            "avg_return_pct": round(statistics.mean(rets), 2),
            "best_return_pct": round(max(rets), 1),
        })
    out.sort(key=lambda x: x["trades"], reverse=True)
    return out


def analyze_markets(trades: list[dict]) -> dict:
    out: dict[str, dict] = {}
    by_mkt: dict[str, list[dict]] = defaultdict(list)
    for t in trades:
        by_mkt[t["market"]].append(t)
    for mkt, ts in by_mkt.items():
        rets = [x["return_pct"] for x in ts]
        wins = sum(1 for r in rets if r > 0)
        out[mkt] = {
            "trades": len(ts),
            "win_rate_pct": round(wins / len(ts) * 100, 1) if rets else 0,
            "avg_return_pct": round(statistics.mean(rets), 2) if rets else 0,
        }
    return out


def analyze_rs_distribution(trades: list[dict]) -> dict:
    rs_winners = [t["rs_rating"] for t in trades if t["return_pct"] > 0 and t.get("rs_rating") is not None]
    rs_losers = [t["rs_rating"] for t in trades if t["return_pct"] <= 0 and t.get("rs_rating") is not None]
    return {
        "winner_avg_rs": round(statistics.mean(rs_winners), 1) if rs_winners else None,
        "loser_avg_rs": round(statistics.mean(rs_losers), 1) if rs_losers else None,
        "winner_n": len(rs_winners),
        "loser_n": len(rs_losers),
    }


# =========================================================================
# Category D — Time-based
# =========================================================================

def analyze_time_curve(trades: list[dict]) -> list[dict]:
    """For each milestone day, compute avg return + winners% across trades whose
    holding period reached that day. Uses end-price so it is approximate (no
    intraday history retained), but useful for a directional curve."""
    if not trades:
        return []
    milestones = [1, 5, 21, 63]
    out = []
    for day in milestones:
        sample = [t for t in trades if t["holding_days"] >= day]
        if not sample:
            out.append({"day": day, "trades": 0, "avg_return_pct": None, "winners_pct": None})
            continue
        rets = [t["return_pct"] for t in sample]
        wins = sum(1 for r in rets if r > 0)
        out.append({
            "day": day,
            "trades": len(sample),
            "avg_return_pct": round(statistics.mean(rets), 2),
            "winners_pct": round(wins / len(sample) * 100, 1),
        })
    return out


# =========================================================================
# Category E — Gemini insights (weekly refresh)
# =========================================================================

def _existing_llm_insights() -> dict | None:
    if not OUT_PATH.exists():
        return None
    try:
        prev = json.loads(OUT_PATH.read_text(encoding="utf-8"))
        return prev.get("llm_insights")
    except Exception:
        return None


def _is_stale(prev: dict | None) -> bool:
    if not prev or not prev.get("generated_at"):
        return True
    try:
        ts = datetime.fromisoformat(prev["generated_at"].replace("Z", "+00:00"))
        age = (datetime.now(timezone.utc) - ts).days
        return age >= LLM_REFRESH_DAYS
    except Exception:
        return True


def gemini_call(prompt: str, max_output_tokens: int = 1500) -> str:
    api_key = clean_api_key("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not set")
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.3,
            "maxOutputTokens": max_output_tokens,
            "responseMimeType": "application/json",
            "thinkingConfig": {"thinkingBudget": 0},
        },
    }
    # Header auth (x-goog-api-key) — never put the key in the URL where
    # exception messages might echo it back.
    r = requests.post(
        GEMINI_URL,
        json=body,
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": api_key,
        },
        timeout=60,
    )
    if r.status_code != 200:
        raise RuntimeError(f"gemini HTTP {r.status_code}: {r.text[:200]}")
    data = r.json()
    return data["candidates"][0]["content"]["parts"][0]["text"]


def llm_insights(trades: list[dict], rule_analysis: dict, sectors: list[dict], force: bool = False) -> dict:
    """Generate Gemini insights when stale or when forced. Otherwise reuse cached."""
    prev = _existing_llm_insights()
    if not force and not _is_stale(prev):
        return prev

    if not trades or len([t for t in trades if t["exited"]]) < 3:
        return {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "winner_patterns": [],
            "loser_traps": [],
            "rule_suggestions": [],
            "note": "exited trades < 3 — insights deferred until more data accumulates",
        }

    # Build compact dataset
    top_winners = sorted(trades, key=lambda t: t["return_pct"], reverse=True)[:10]
    top_losers = sorted(trades, key=lambda t: t["return_pct"])[:10]

    def _row(t):
        return {
            "ticker": t["ticker"],
            "market": t["market"],
            "return_pct": round(t["return_pct"], 1),
            "exit": t["exit_reason_bucket"] if t["exited"] else "active",
            "holding_days": t["holding_days"],
            "rs_rating": t.get("rs_rating"),
        }

    top_lift = rule_analysis.get("rule_hit_rate_diff", [])[:10]
    bottom_lift = sorted(
        rule_analysis.get("rule_hit_rate_diff", []),
        key=lambda r: r["lift"],
    )[:5]

    payload = {
        "winners_top10": [_row(t) for t in top_winners],
        "losers_top10": [_row(t) for t in top_losers],
        "rule_lift_top10": top_lift,
        "rule_lift_bottom5": bottom_lift,
        "sector_breakdown": sectors[:8],
    }

    prompt = f"""당신은 미네르비니 / 오닐 스타일의 모멘텀 트레이딩 시스템을 운용하는
시니어 퀀트 애널리스트입니다. 아래 데이터는 VCP 스크리너의 실제 탐지·청산
이력입니다. 한국어로 패턴·함정·룰 제안을 도출하세요.

데이터 (JSON):
{json.dumps(payload, ensure_ascii=False, indent=2)}

다음 스키마와 정확히 일치하는 JSON만 반환 (마크다운 펜스 X):
{{
  "winner_patterns": ["승자 종목 5~7개의 공통 특징 — 한국어, 60자 이내", ...],
  "loser_traps": ["패배 종목 5~7개의 공통 함정 — 한국어, 60자 이내", ...],
  "rule_suggestions": ["다음 스크리닝에 추가/조정할 룰 제안 3~5개 — 한국어, 60자 이내", ...]
}}

규칙:
- 모든 문자열은 **한국어**.
- 추측은 [가설] 태그 표기. 데이터 기반 사실은 그대로.
- 표본이 작으면 (n<5) "표본 부족" 명시.
- 60자 이내 강제. 미사여구 X.

JSON만 반환."""

    try:
        text = gemini_call(prompt, max_output_tokens=2000)
        # strip markdown fences if any
        cleaned = text.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[-1]
            if cleaned.endswith("```"):
                cleaned = cleaned.rsplit("```", 1)[0]
        parsed = json.loads(cleaned)
        return {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "winner_patterns": parsed.get("winner_patterns") or [],
            "loser_traps": parsed.get("loser_traps") or [],
            "rule_suggestions": parsed.get("rule_suggestions") or [],
            "model": GEMINI_MODEL,
            "trades_analyzed": len(trades),
        }
    except Exception as e:
        # On failure, keep stale data if exists, else empty
        if prev:
            return {**prev, "last_error": str(e)[:200]}
        return {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "winner_patterns": [],
            "loser_traps": [],
            "rule_suggestions": [],
            "error": str(e)[:200],
        }


# =========================================================================
# Main
# =========================================================================

def main() -> int:
    history, results_by_ticker = load()

    trades_raw: list[dict] = []
    for ticker, h in (history or {}).items():
        rec = normalize_entry(ticker, h)
        if rec:
            trades_raw.append(rec)

    exited = [t for t in trades_raw if t["exited"]]
    active = [t for t in trades_raw if not t["exited"]]

    # Snapshot
    big_winners = [t for t in trades_raw if t["return_pct"] >= WINNER_BIG_PCT]
    winners30 = [t for t in trades_raw if t["return_pct"] >= WINNER_PCT]
    losers = [t for t in trades_raw if t["return_pct"] <= LOSER_PCT]

    snapshot = {
        "total_trades": len(trades_raw),
        "active": len(active),
        "exited": len(exited),
        f"winners_{int(WINNER_BIG_PCT)}pct": len(big_winners),
        f"winners_{int(WINNER_PCT)}pct": len(winners30),
        "losers": len(losers),
    }

    # Performance — use end-price returns over ALL trades (active counted at last seen)
    performance = analyze_performance(trades_raw)

    # Exit breakdown — exited trades only
    exit_counter: Counter = Counter()
    for t in exited:
        exit_counter[t["exit_reason_bucket"]] += 1
    exit_breakdown = dict(exit_counter)

    # Rule analysis
    rule_analysis = analyze_rules(trades_raw, results_by_ticker)

    # Sector / market
    sectors = analyze_sectors(trades_raw, results_by_ticker)
    markets = analyze_markets(trades_raw)
    rs_dist = analyze_rs_distribution(trades_raw)

    # Time curve
    time_curve = analyze_time_curve(trades_raw)

    # LLM insights — refreshed every 7 days (or first run)
    llm_force = os.environ.get("LESSONS_LLM_FORCE") == "1"
    llm = llm_insights(trades_raw, rule_analysis, sectors, force=llm_force)

    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "schema_version": 1,
        "thresholds": {
            "winner_big_pct": WINNER_BIG_PCT,
            "winner_pct": WINNER_PCT,
            "loser_pct": LOSER_PCT,
            "llm_refresh_days": LLM_REFRESH_DAYS,
        },
        "snapshot": snapshot,
        "performance": performance,
        "exit_breakdown": exit_breakdown,
        "rule_analysis": rule_analysis,
        "sector_breakdown": sectors,
        "market_breakdown": markets,
        "rs_distribution": rs_dist,
        "time_curve": time_curve,
        "llm_insights": llm,
        "data_status": {
            "exited_trades_count": len(exited),
            "min_for_meaningful": 5,
            "fallback_message": (
                None if len(exited) >= 5
                else "Only {} exited trade(s) so far — analytics will sharpen as more positions close."
                .format(len(exited))
            ),
        },
    }

    OUT_PATH.write_text(
        json.dumps(out, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"lessons.json written → {OUT_PATH}")
    print(f"  trades total={snapshot['total_trades']}  active={snapshot['active']}  exited={snapshot['exited']}")
    print(f"  win_rate={performance['win_rate_pct']}%  avg_winner={performance['avg_winner_pct']}%  avg_loser={performance['avg_loser_pct']}%")
    print(f"  llm_insights generated_at={llm.get('generated_at')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

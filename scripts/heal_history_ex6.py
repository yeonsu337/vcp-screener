"""One-shot healer — un-exit tickers that were prematurely evicted by EX6
(absence) but are currently in the soft-gate (Stage 2 + RS ≥ 70 + Primary
12+). Mirrors the new T1+T2+T3 logic applied retroactively to existing
detection_history.json.

Run once after pulling the new run_daily.py. Cron will keep history correct
going forward.

Usage:
  python scripts/heal_history_ex6.py            # dry-run, prints plan
  python scripts/heal_history_ex6.py --apply    # writes to disk
"""
from __future__ import annotations
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "public" / "data"
HISTORY_PATH = DATA / "detection_history.json"
RESULTS_PATH = DATA / "results.json"

SOFT_GATE_PRIMARY_IDS = [
    "A1_ud_vol_ratio", "B1_price_above_150_200", "B2_sma150_gt_sma200",
    "B3_sma50_gt_150_200", "B4_price_above_sma50", "B5_sma200_rising_5mo",
    "B6_30pct_above_52w_low", "B7_within_25pct_high", "R1_rs_70",
    "L1_liquidity_gate", "E7_roe", "F1_outperform_1y", "H4_ni_cagr_3y",
]
SOFT_GATE_US_ONLY = {"E7_roe", "F1_outperform_1y", "H4_ni_cagr_3y"}
SOFT_GATE_REQUIRE_RS = 70


def _soft_gate_ids(market: str | None) -> list[str]:
    if (market or "US") == "US":
        return SOFT_GATE_PRIMARY_IDS
    return [rid for rid in SOFT_GATE_PRIMARY_IDS if rid not in SOFT_GATE_US_ONLY]


def _soft_gate_threshold(market: str | None) -> int:
    return 12 if (market or "US") == "US" else 9


def is_soft_gate(r: dict) -> bool:
    rules = r.get("rules") or {}
    market = r.get("market")
    ids = _soft_gate_ids(market)
    passed = sum(1 for rid in ids if (rules.get(rid) or {}).get("passed"))
    if passed < _soft_gate_threshold(market):
        return False
    if (r.get("stage") or 0) != 2:
        return False
    if (r.get("rs_rating") or 0) < SOFT_GATE_REQUIRE_RS:
        return False
    return True


def is_ex6_only(h: dict) -> bool:
    """True if every exit reason is an EX6 absence-based eviction. Matches
    both the new format ("EX6 absent ...") and the legacy format
    ("absent Nd (limit Nd)") so historical detection_history entries also
    qualify for un-exit."""
    reasons = h.get("exit_reasons") or []
    if not reasons:
        return False

    def is_absence(r: str) -> bool:
        s = str(r).lower()
        return s.startswith("ex6") or s.startswith("absent")

    return all(is_absence(r) for r in reasons)


def main():
    apply = "--apply" in sys.argv

    history = json.loads(HISTORY_PATH.read_text(encoding="utf-8"))
    results = json.loads(RESULTS_PATH.read_text(encoding="utf-8"))
    soft_gate_set = {r["ticker"]: r for r in results if is_soft_gate(r)}
    detected_set = {r["ticker"] for r in results if r.get("detected")}

    eligible = []
    for ticker, h in history.items():
        if not h.get("exited"):
            continue
        if not is_ex6_only(h):
            continue
        if ticker not in soft_gate_set and ticker not in detected_set:
            continue
        eligible.append((ticker, h, soft_gate_set.get(ticker)))

    print(f"Total exited: {sum(1 for h in history.values() if h.get('exited'))}")
    print(f"EX6-only exits in current soft-gate: {len(eligible)}\n")

    for ticker, h, r in sorted(eligible, key=lambda x: -(x[1].get("max_return_pct") or -999)):
        ret = h.get("return_pct")
        peak = h.get("max_return_pct")
        rs = (r.get("rs_rating") if r else h.get("rs_rating")) or 0
        mkt = (r or {}).get("market") if r else h.get("market")
        ids = _soft_gate_ids(mkt)
        passed = sum(
            1 for rid in ids
            if r and (r.get("rules") or {}).get(rid, {}).get("passed")
        ) if r else 0
        ret_s = f"{ret:+.1f}%" if ret is not None else "n/a"
        peak_s = f"{peak:+.1f}%" if peak is not None else "n/a"
        denom = len(ids)
        print(f"  {ticker:14s} {mkt or 'US':3s} ret={ret_s:>7s}  peak={peak_s:>7s}  RS={rs:3d}  rules={passed}/{denom}  exit_reason={h.get('exit_reasons')}")

    if not apply:
        print("\n[dry-run] add --apply to write changes")
        return 0

    today = max((h.get("last_seen") or "") for h in history.values())
    for ticker, h, r in eligible:
        h["exited"] = False
        h.pop("exit_date", None)
        h.pop("exit_price", None)
        prev = h.pop("exit_reasons", None)
        h["re_entry_date"] = today
        h["re_entry_reason"] = (
            f"healer: EX6 reversal (Stage 2 + RS≥{SOFT_GATE_REQUIRE_RS} + Primary 12+ confirmed)"
            + (f" (was: {', '.join(prev)})" if prev else "")
        )
        # Refresh fresh metrics from latest results
        if r:
            h["rs_rating"] = r.get("rs_rating")
            h["stage"] = r.get("stage")
            h["last_seen"] = today
            h["soft_gate_streak"] = 1

    HISTORY_PATH.write_text(
        json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"\n[applied] un-exited {len(eligible)} tickers in {HISTORY_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

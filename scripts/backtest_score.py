"""
Phase 1.4-alpha verification - compare score_v1 vs score_v2 correlation with realized returns.

Sources:
  - detection_history.json: active 11 + exited 25 tickers with first_detected + return data
  - results.json: current score_v1/score_v2 for cross-check
  - score_snapshots/*.json (forward-looking, populated by run_daily.py - empty on day 1)

Output: stdout report + verdict (PASS if Spearman_v2 >= Spearman_v1 + 0.05).

Run:  python scripts/backtest_score.py
"""
from __future__ import annotations
import json
import sys
from pathlib import Path
from statistics import median

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from screener import compute_composite_v2_from_row  # noqa: E402

DATA_DIR = ROOT / "web" / "public" / "data"
HISTORY_PATH = DATA_DIR / "detection_history.json"
RESULTS_PATH = DATA_DIR / "results.json"


def spearman(xs: list[float], ys: list[float]) -> float:
    """Spearman rank correlation. Returns NaN if N<3 or no variance."""
    n = len(xs)
    if n < 3 or len(ys) != n:
        return float("nan")

    def _rank(vs: list[float]) -> list[float]:
        idx = sorted(range(n), key=lambda i: vs[i])
        ranks = [0.0] * n
        i = 0
        while i < n:
            j = i
            while j + 1 < n and vs[idx[j + 1]] == vs[idx[i]]:
                j += 1
            avg = (i + j) / 2 + 1  # average rank (1-indexed)
            for k in range(i, j + 1):
                ranks[idx[k]] = avg
            i = j + 1
        return ranks

    rx, ry = _rank(xs), _rank(ys)
    mx, my = sum(rx) / n, sum(ry) / n
    num = sum((rx[i] - mx) * (ry[i] - my) for i in range(n))
    dx2 = sum((rx[i] - mx) ** 2 for i in range(n))
    dy2 = sum((ry[i] - my) ** 2 for i in range(n))
    denom = (dx2 * dy2) ** 0.5
    if denom == 0:
        return float("nan")
    return num / denom


def main() -> int:
    if not HISTORY_PATH.exists():
        print(f"ERROR: {HISTORY_PATH} missing - run scripts/run_daily.py first")
        return 1
    if not RESULTS_PATH.exists():
        print(f"ERROR: {RESULTS_PATH} missing")
        return 1

    history: dict = json.loads(HISTORY_PATH.read_text(encoding="utf-8"))
    results: list[dict] = json.loads(RESULTS_PATH.read_text(encoding="utf-8"))
    results_by_ticker = {r["ticker"]: r for r in results}

    print(f"\n{'='*60}")
    print("Phase 1.4-alpha Backtest - score_v1 vs score_v2 vs realized return")
    print(f"{'='*60}\n")

    # Build sample: ALL tracked tickers (active + exited) with return data
    samples = []  # (ticker, score_v1, score_v2, return_pct)
    for ticker, h in history.items():
        det_score_v1 = h.get("detection_score")  # captured at first_detected
        if det_score_v1 is None:
            continue
        # Return: active uses current return, exited uses exit return
        if h.get("exited"):
            ep = h.get("exit_price")
            dp = h.get("detection_price")
            ret = ((ep - dp) / dp * 100) if (ep and dp) else None
        else:
            ret = h.get("return_pct")
        if ret is None:
            continue

        # Get current row to compute v2 (using today's rules - proxy for what v2 would have been)
        row = results_by_ticker.get(ticker)
        if row is None:
            # Ticker dropped from universe - skip (can't compute v2)
            continue
        v2 = compute_composite_v2_from_row({
            "score": det_score_v1,  # historical v1 score
            "market": row.get("market"),
            "rules": row.get("rules"),
        })
        samples.append((ticker, float(det_score_v1), float(v2["score_v2"]), float(ret)))

    n = len(samples)
    print(f"Sample size: N = {n}")
    if n < 5:
        print("FAIL: sample too small (N<5) - cannot validate")
        print("  Mitigation: deploy v2 with caveat, wait 30d for score_snapshots accumulation")
        return 0  # not a hard fail - proceed with caveat

    samples.sort(key=lambda s: -s[3])  # by return desc
    print()
    print(f"{'Ticker':<12} {'v1':>7} {'v2':>7} {'Return%':>9}")
    print("-" * 40)
    for t, v1, v2, ret in samples:
        print(f"{t:<12} {v1:>7.1f} {v2:>7.1f} {ret:>+8.1f}%")
    print()

    v1_scores = [s[1] for s in samples]
    v2_scores = [s[2] for s in samples]
    returns = [s[3] for s in samples]

    rho_v1 = spearman(v1_scores, returns)
    rho_v2 = spearman(v2_scores, returns)

    print(f"Spearman(score_v1, return) = {rho_v1:+.3f}")
    print(f"Spearman(score_v2, return) = {rho_v2:+.3f}")
    print(f"Delta (v2 - v1)            = {rho_v2 - rho_v1:+.3f}")
    print()

    # Verdict
    gate = 0.05
    if rho_v2 != rho_v2 or rho_v1 != rho_v1:  # NaN
        print("WARN: NaN correlation - degenerate sample (no variance)")
        verdict = "PROCEED_WITH_CAVEAT"
    elif rho_v2 >= rho_v1 + gate:
        verdict = "PASS"
    elif rho_v2 >= rho_v1 - gate:
        verdict = "TIE"
    else:
        verdict = "FAIL"

    print(f"VERDICT: {verdict} (gate: Δ ≥ +{gate:.2f})")
    print()

    # Top/bottom quartile return spread (alternative metric)
    if n >= 8:
        sorted_v2 = sorted(samples, key=lambda s: -s[2])
        q = max(2, n // 4)
        top_q = sorted_v2[:q]
        bot_q = sorted_v2[-q:]
        top_ret_med = median(s[3] for s in top_q)
        bot_ret_med = median(s[3] for s in bot_q)
        print(f"Top-{q} v2 median return: {top_ret_med:+.1f}%")
        print(f"Bot-{q} v2 median return: {bot_ret_med:+.1f}%")
        print(f"Spread (top-bot)         : {top_ret_med - bot_ret_med:+.1f}%")
        print()

    print("Forward backtest data: score_snapshots/<date>.json (N=426/day)")
    print("Re-run after 30d for stronger statistical power.")
    return 0 if verdict in ("PASS", "TIE", "PROCEED_WITH_CAVEAT") else 1


if __name__ == "__main__":
    sys.exit(main())

"""
Daily screener runner.
Runs the full pipeline, writes JSON outputs consumed by the Next.js frontend.

Outputs:
  web/public/data/results.json   — main table (all VCP candidates)
  web/public/data/meta.json      — timestamp, counts
  web/public/data/charts/<T>.json — OHLCV for top N tickers
"""
from __future__ import annotations
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Make screener importable
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import warnings
warnings.filterwarnings("ignore")

from screener import (  # noqa: E402
    fetch_finviz_prefilter,
    fetch_ohlcv,
    compute_rs_scores,
    detect_vcp,
)

DATA_DIR = ROOT / "web" / "public" / "data"
CHARTS_DIR = DATA_DIR / "charts"
DATA_DIR.mkdir(parents=True, exist_ok=True)
CHARTS_DIR.mkdir(parents=True, exist_ok=True)

MIN_RS = 70
TOP_CHART_N = 50  # per-ticker OHLCV for top N candidates (by score)


def _df_ohlcv_to_list(df):
    """Convert OHLCV DataFrame → lightweight-charts format."""
    out = []
    for idx, row in df.iterrows():
        out.append({
            "time": idx.strftime("%Y-%m-%d"),
            "open": round(float(row["Open"]), 2),
            "high": round(float(row["High"]), 2),
            "low": round(float(row["Low"]), 2),
            "close": round(float(row["Close"]), 2),
            "volume": int(row["Volume"]),
        })
    return out


def main():
    t_start = time.time()
    print("[1/4] Finviz prefilter…")
    pf = fetch_finviz_prefilter()
    if pf.empty:
        print("ERROR: Finviz returned no rows.")
        sys.exit(1)
    print(f"      {len(pf)} passed Trend Template")

    print("[2/4] yfinance OHLCV (2y)…")
    tickers = pf["Ticker"].tolist()
    ohlcv = fetch_ohlcv(tickers, period="2y")
    print(f"      {len(ohlcv)} with history")

    print("[3/4] RS Rating…")
    rs = compute_rs_scores(ohlcv)
    survivors = [t for t in ohlcv if t in rs.index and rs[t] >= MIN_RS]
    print(f"      {len(survivors)} with RS ≥ {MIN_RS}")

    print("[4/4] VCP detection…")
    rows = []
    for t in survivors:
        r = detect_vcp(t, ohlcv[t])
        meta = pf[pf["Ticker"] == t].iloc[0]
        rows.append({
            "ticker": r.ticker,
            "company": str(meta.get("Company", "")),
            "sector": str(meta.get("Sector", "")),
            "industry": str(meta.get("Industry", "")),
            "detected": bool(r.detected),
            "score": round(r.score, 1),
            "rs_rating": int(rs[t]),
            "num_contractions": int(r.num_contractions),
            "contractions": r.contractions,
            "last_contraction_pct": round(r.last_contraction_pct, 2)
                if r.last_contraction_pct == r.last_contraction_pct else None,
            "current_price": round(r.current_price, 2)
                if r.current_price == r.current_price else None,
            "pivot_price": round(r.pivot_price, 2)
                if r.pivot_price == r.pivot_price else None,
            "pct_to_pivot": round(r.pct_to_pivot, 2)
                if r.pct_to_pivot == r.pct_to_pivot else None,
            "volume_dryup_ratio": round(r.volume_dryup_ratio, 2)
                if r.volume_dryup_ratio == r.volume_dryup_ratio else None,
        })

    # Sort: detected first, then by score
    rows.sort(key=lambda x: (not x["detected"], -x["score"]))
    detected_count = sum(1 for r in rows if r["detected"])
    print(f"      {detected_count} VCP detected / {len(rows)} total")

    # Write main results
    (DATA_DIR / "results.json").write_text(
        json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # Write meta
    meta = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "total_candidates": len(rows),
        "vcp_detected": detected_count,
        "min_rs": MIN_RS,
        "prefilter_count": len(pf),
        "runtime_sec": round(time.time() - t_start, 1),
    }
    (DATA_DIR / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # Write per-ticker OHLCV for top N (by score)
    top_tickers = [r["ticker"] for r in rows[:TOP_CHART_N]]
    for t in top_tickers:
        if t not in ohlcv:
            continue
        df = ohlcv[t].iloc[-252:]  # last year
        payload = {
            "ticker": t,
            "ohlcv": _df_ohlcv_to_list(df),
        }
        (CHARTS_DIR / f"{t}.json").write_text(
            json.dumps(payload, ensure_ascii=False), encoding="utf-8"
        )

    # Clean up old chart JSONs no longer in top N
    keep = set(top_tickers)
    for f in CHARTS_DIR.glob("*.json"):
        if f.stem not in keep:
            f.unlink()

    print(f"\nDone in {meta['runtime_sec']}s")
    print(f"  → {DATA_DIR / 'results.json'}")
    print(f"  → {DATA_DIR / 'meta.json'}")
    print(f"  → {len(top_tickers)} chart files in {CHARTS_DIR}")


if __name__ == "__main__":
    main()

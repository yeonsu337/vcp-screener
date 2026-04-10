"""
Daily screener runner (multi-market).
Reads config.json, runs the full pipeline, writes JSON for the Next.js frontend.

Outputs:
  web/public/data/results.json   — main table (all candidates, all markets)
  web/public/data/meta.json      — timestamp, counts, market breakdown
  web/public/data/charts/<T>.json — OHLCV for top N detected tickers
"""
from __future__ import annotations
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import warnings
warnings.filterwarnings("ignore")

from screener import run_screener, fetch_ohlcv, load_config  # noqa: E402

DATA_DIR = ROOT / "web" / "public" / "data"
CHARTS_DIR = DATA_DIR / "charts"
DATA_DIR.mkdir(parents=True, exist_ok=True)
CHARTS_DIR.mkdir(parents=True, exist_ok=True)

TOP_CHART_N = 50


def _df_ohlcv_to_list(df):
    """Convert OHLCV DataFrame -> lightweight-charts format."""
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


def _safe_chart_filename(ticker: str) -> str:
    """0700.HK -> 0700_HK (avoid dots in filenames)."""
    return ticker.replace(".", "_")


def main():
    t_start = time.time()
    config = load_config()

    # Run multi-market pipeline (all candidates, not just VCP-detected)
    result_df = run_screener(vcp_only=False)

    if result_df.empty:
        print("\nERROR: No results from any market.")
        sys.exit(1)

    rows = result_df.to_dict(orient="records")

    # NaN -> None for JSON
    for r in rows:
        for k, v in r.items():
            if isinstance(v, float) and v != v:
                r[k] = None

    # Sort: detected first, then by score
    rows.sort(key=lambda x: (not x.get("detected", False), -(x.get("score") or 0)))

    detected_count = sum(1 for r in rows if r.get("detected"))
    total = len(rows)

    # Market breakdown
    market_counts: dict[str, dict] = {}
    for r in rows:
        m = r.get("market", "US")
        if m not in market_counts:
            market_counts[m] = {"total": 0, "detected": 0}
        market_counts[m]["total"] += 1
        if r.get("detected"):
            market_counts[m]["detected"] += 1

    print(f"\n{'='*50}")
    print(f"  RESULTS: {detected_count} VCP detected / {total} total")
    for m, c in market_counts.items():
        print(f"    {m}: {c['detected']} detected / {c['total']} total")
    print(f"{'='*50}")

    # Write results.json
    (DATA_DIR / "results.json").write_text(
        json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # Write meta.json
    meta = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "total_candidates": total,
        "vcp_detected": detected_count,
        "min_rs": config.get("min_rs", 70),
        "markets": market_counts,
        "runtime_sec": round(time.time() - t_start, 1),
    }
    (DATA_DIR / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # Chart JSONs for top N detected tickers
    detected_tickers = [r["ticker"] for r in rows if r.get("detected")][:TOP_CHART_N]
    if detected_tickers:
        print(f"\nDownloading chart OHLCV for {len(detected_tickers)} tickers...")
        chart_ohlcv = fetch_ohlcv(detected_tickers, period="1y")
        for t in detected_tickers:
            if t not in chart_ohlcv:
                continue
            df = chart_ohlcv[t].iloc[-252:]
            payload = {"ticker": t, "ohlcv": _df_ohlcv_to_list(df)}
            fname = _safe_chart_filename(t)
            (CHARTS_DIR / f"{fname}.json").write_text(
                json.dumps(payload, ensure_ascii=False), encoding="utf-8"
            )

    # Clean up old chart JSONs not in top N
    keep = set(_safe_chart_filename(t) for t in detected_tickers)
    for f in CHARTS_DIR.glob("*.json"):
        if f.stem not in keep:
            f.unlink()

    elapsed = round(time.time() - t_start, 1)
    meta["runtime_sec"] = elapsed
    (DATA_DIR / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"\nDone in {elapsed}s")
    print(f"  -> {DATA_DIR / 'results.json'}")
    print(f"  -> {DATA_DIR / 'meta.json'}")
    print(f"  -> {len(detected_tickers)} chart files in {CHARTS_DIR}")


if __name__ == "__main__":
    main()

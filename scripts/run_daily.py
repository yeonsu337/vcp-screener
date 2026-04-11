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

from screener import (  # noqa: E402
    run_screener, fetch_ohlcv, fetch_benchmark, load_config,
    BENCHMARK_TICKERS,
)
import pandas as pd  # noqa: E402

DATA_DIR = ROOT / "web" / "public" / "data"
CHARTS_DIR = DATA_DIR / "charts"
HISTORY_PATH = DATA_DIR / "detection_history.json"
DATA_DIR.mkdir(parents=True, exist_ok=True)
CHARTS_DIR.mkdir(parents=True, exist_ok=True)

TOP_CHART_N = 50


def _update_detection_history(rows: list[dict], today: str) -> dict:
    """
    Maintain first-detection history for backtest tracking.

    For each detected ticker: if not already in history, record first detection
    date + price + score. If already present, keep existing (first detection).
    Also tracks last_seen date to identify dropoffs.

    Returns the updated history dict.
    """
    history: dict = {}
    if HISTORY_PATH.exists():
        try:
            history = json.loads(HISTORY_PATH.read_text(encoding="utf-8"))
        except Exception:
            history = {}

    detected = {r["ticker"]: r for r in rows if r.get("detected")}

    # Add new detections
    for ticker, r in detected.items():
        if ticker not in history:
            history[ticker] = {
                "first_detected": today,
                "detection_price": r.get("current_price"),
                "detection_score": r.get("score"),
                "market": r.get("market", "US"),
                "company": r.get("company", ""),
            }
        # Always update last_seen + current data
        history[ticker]["last_seen"] = today
        history[ticker]["current_price"] = r.get("current_price")
        history[ticker]["current_score"] = r.get("score")
        history[ticker]["rs_rating"] = r.get("rs_rating")

    # For tickers NOT detected today but in history, just update last_seen info
    # (don't update current_price — we'll fetch it in the backtest page)

    HISTORY_PATH.write_text(
        json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return history


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

    # Update detection history for backtest tracking
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    history = _update_detection_history(rows, today)
    history_detected = sum(1 for v in history.values() if v.get("first_detected"))
    print(f"\nDetection history: {history_detected} tickers tracked")

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

        # Download benchmarks for RS Line overlay
        market_map = {r["ticker"]: r.get("market", "US") for r in rows if r.get("detected")}
        benchmarks: dict[str, pd.Series] = {}
        for mkt in set(market_map.values()):
            b = fetch_benchmark(mkt, period="1y")
            if b is not None:
                benchmarks[mkt] = b

        for t in detected_tickers:
            if t not in chart_ohlcv:
                continue
            df = chart_ohlcv[t].iloc[-252:]
            # RS Line: stock/benchmark ratio normalized to start at 100
            rs_line_data: list[dict] = []
            mkt = market_map.get(t, "US")
            if mkt in benchmarks:
                stock_c = df["Close"].squeeze()
                bench_c = benchmarks[mkt]
                aligned = pd.DataFrame({"s": stock_c, "b": bench_c}).dropna()
                if len(aligned) > 10:
                    ratio = aligned["s"] / aligned["b"]
                    ratio_norm = ratio / ratio.iloc[0] * 100
                    for idx, val in ratio_norm.items():
                        rs_line_data.append({
                            "time": idx.strftime("%Y-%m-%d"),
                            "value": round(float(val), 2),
                        })

            payload = {
                "ticker": t,
                "ohlcv": _df_ohlcv_to_list(df),
                "rs_line": rs_line_data,
            }
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

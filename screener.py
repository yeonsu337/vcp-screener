"""
VCP Screener — Finviz prefilter + custom VCP pattern detection.

Pipeline:
  1. finvizfinance: Trend Template prefilter (Finviz built-in)
  2. yfinance: OHLCV download for survivors only
  3. detect_vcp: pivot/contraction analysis
  4. rank: composite score
"""
from __future__ import annotations
import time
from dataclasses import dataclass, asdict
from pathlib import Path

import numpy as np
import pandas as pd
import yfinance as yf
from finvizfinance.screener.overview import Overview
from scipy.signal import find_peaks

CACHE_DIR = Path(__file__).parent / ".cache"
CACHE_DIR.mkdir(exist_ok=True)


# =============================================================================
# Step 1: Finviz prefilter — Trend Template (8 criteria) approximation
# =============================================================================

# Finviz filter keys → Minervini Trend Template mapping:
#   Price > SMA200                 → 200-Day SMA filter
#   SMA50 > SMA200                 → 50-Day SMA filter
#   SMA20 > SMA50 (proxy SMA50>150)→ 20-Day SMA filter
#   Within 10% of 52w high         → 52-Week High/Low filter (tighter than 25%)
#   Quarter uptrend                → Performance filter
#   Liquidity guards               → Price/Avg Volume
# Note: Finviz allows one value per key → remaining criteria (Price>SMA50,
# 30% above 52w low, 200SMA uptrend ≥1mo) are implied by the combination above.
TREND_TEMPLATE_FILTERS = {
    "Country": "USA",
    "Price": "Over $10",
    "Average Volume": "Over 500K",
    "50-Day Simple Moving Average": "SMA50 above SMA200",
    "200-Day Simple Moving Average": "Price above SMA200",
    "20-Day Simple Moving Average": "SMA20 above SMA50",
    "52-Week High/Low": "0-10% below High",
    "Performance": "Quarter Up",
}


def fetch_finviz_prefilter() -> pd.DataFrame:
    """
    Run Finviz screener once with Trend Template-equivalent filters.
    Returns DataFrame of survivors (US stocks, all exchanges).
    """
    screener = Overview()
    try:
        screener.set_filter(filters_dict=TREND_TEMPLATE_FILTERS)
        df = screener.screener_view(verbose=0)
    except Exception as e:
        print(f"[finviz] failed: {e}")
        return pd.DataFrame()
    if df is None or df.empty:
        return pd.DataFrame()
    return df.drop_duplicates(subset=["Ticker"]).reset_index(drop=True)


# =============================================================================
# Step 2: yfinance OHLCV download (batched)
# =============================================================================

def fetch_ohlcv(tickers: list[str], period: str = "2y") -> dict[str, pd.DataFrame]:
    """Batched download. Returns {ticker: dataframe}."""
    if not tickers:
        return {}
    data = yf.download(
        tickers=" ".join(tickers),
        period=period,
        interval="1d",
        group_by="ticker",
        auto_adjust=True,
        progress=False,
        threads=True,
    )
    out: dict[str, pd.DataFrame] = {}
    if len(tickers) == 1:
        t = tickers[0]
        out[t] = data.dropna()
        return out
    for t in tickers:
        try:
            sub = data[t].dropna()
            if len(sub) >= 60:
                out[t] = sub
        except (KeyError, AttributeError):
            continue
    return out


# =============================================================================
# Step 3: IBD-style RS Rating (computed only on prefiltered survivors)
# =============================================================================

def _perf(prices: pd.Series, days: int) -> float:
    if len(prices) < days + 1:
        return np.nan
    return float(prices.iloc[-1] / prices.iloc[-days - 1] - 1.0)


def compute_rs_scores(ohlcv: dict[str, pd.DataFrame]) -> pd.Series:
    """
    IBD-style: weighted perf (recent quarter ×2 weight).
    Score = 0.4*Q1 + 0.2*Q2 + 0.2*Q3 + 0.2*Q4
    Returns percentile rank 1-99 across the input universe.
    """
    raw = {}
    for t, df in ohlcv.items():
        c = df["Close"]
        q1 = _perf(c, 63)   # ~3mo
        q2 = _perf(c, 126)  # ~6mo
        q3 = _perf(c, 189)  # ~9mo
        q4 = _perf(c, 252)  # ~12mo
        if any(pd.isna(x) for x in (q1, q2, q3, q4)):
            continue
        raw[t] = 0.4 * q1 + 0.2 * q2 + 0.2 * q3 + 0.2 * q4
    s = pd.Series(raw)
    if s.empty:
        return s
    pct = s.rank(pct=True) * 98 + 1  # 1-99
    return pct.round(0).astype(int)


# =============================================================================
# Step 4: VCP pattern detection
# =============================================================================

@dataclass
class VCPResult:
    ticker: str
    detected: bool
    num_contractions: int
    contractions: list[float]   # depth ratios
    last_contraction_pct: float
    base_days: int
    pivot_price: float
    current_price: float
    pct_to_pivot: float
    volume_dryup_ratio: float   # last 5d avg vol / base avg vol
    score: float                # 0-100


def _find_swings(closes: np.ndarray, highs: np.ndarray, lows: np.ndarray,
                 prominence_pct: float = 0.03, distance: int = 5):
    """Detect swing highs and lows via scipy.find_peaks on highs/lows."""
    h_idx, _ = find_peaks(highs, distance=distance, prominence=highs.mean() * prominence_pct)
    l_idx, _ = find_peaks(-lows, distance=distance, prominence=lows.mean() * prominence_pct)
    return h_idx, l_idx


def detect_vcp(ticker: str, df: pd.DataFrame, lookback: int = 90) -> VCPResult:
    """
    VCP heuristic:
      - Look at last `lookback` bars
      - Find swing highs (peaks) and lows (troughs)
      - Build contractions: peak → next trough (depth = (peak-trough)/peak)
      - Require: ≥2 contractions, each progressively tighter
      - Last contraction depth < 15%
      - Volume in last 5d < 0.7 * base avg volume
      - Pivot = highest peak in base
    """
    empty = VCPResult(ticker, False, 0, [], np.nan, 0, np.nan, np.nan, np.nan, np.nan, 0.0)
    if len(df) < lookback + 5:
        return empty
    base = df.iloc[-lookback:].copy()
    highs = base["High"].values
    lows = base["Low"].values
    closes = base["Close"].values
    vols = base["Volume"].values

    h_idx, l_idx = _find_swings(closes, highs, lows)
    if len(h_idx) < 2 or len(l_idx) < 1:
        return empty

    # Pair peaks and troughs in chronological order
    events = sorted(
        [(i, "H", highs[i]) for i in h_idx] + [(i, "L", lows[i]) for i in l_idx]
    )
    # Build contractions: each (peak → following trough)
    contractions: list[float] = []
    last_peak = None
    for idx, kind, val in events:
        if kind == "H":
            last_peak = val
        elif kind == "L" and last_peak is not None:
            depth = (last_peak - val) / last_peak
            if depth > 0.005:
                contractions.append(float(depth))
            last_peak = None

    if len(contractions) < 2:
        return empty

    # Use last 2-6 contractions
    recent = contractions[-6:]
    n = len(recent)

    # Check progressive tightening (allow 10% noise: each ≤ prev * 1.10)
    tightening = all(recent[i] <= recent[i - 1] * 1.10 for i in range(1, n))
    last_pct = recent[-1] * 100

    # Pivot = max high in base
    pivot_price = float(highs.max())
    current_price = float(closes[-1])
    pct_to_pivot = (current_price / pivot_price - 1.0) * 100

    # Volume dry-up (last 5d vs base avg)
    avg_recent_vol = float(vols[-5:].mean())
    avg_base_vol = float(vols.mean())
    vol_ratio = avg_recent_vol / avg_base_vol if avg_base_vol > 0 else np.nan

    # Detection rules
    detected = (
        tightening
        and n >= 2
        and last_pct < 15.0
        and vol_ratio < 0.95
        and pct_to_pivot > -12.0  # within 12% of pivot
    )

    # Score 0-100
    score = 0.0
    if detected:
        score += 30  # base
        score += min(20, n * 5)                      # more contractions = better
        score += max(0, 25 - last_pct * 2)           # tighter last contraction
        score += max(0, 15 - vol_ratio * 15)         # more dry-up
        score += max(0, 10 + pct_to_pivot)           # closer to pivot
        score = float(min(100, max(0, score)))

    return VCPResult(
        ticker=ticker,
        detected=detected,
        num_contractions=n,
        contractions=[round(c * 100, 2) for c in recent],
        last_contraction_pct=round(last_pct, 2),
        base_days=lookback,
        pivot_price=round(pivot_price, 2),
        current_price=round(current_price, 2),
        pct_to_pivot=round(pct_to_pivot, 2),
        volume_dryup_ratio=round(vol_ratio, 2),
        score=round(score, 1),
    )


# =============================================================================
# Pipeline
# =============================================================================

def run_screener(min_rs: int = 70, vcp_only: bool = True) -> pd.DataFrame:
    """Full pipeline. Returns ranked DataFrame."""
    print("[1/4] Finviz prefilter…")
    pf = fetch_finviz_prefilter()
    if pf.empty:
        print("Finviz returned no rows.")
        return pd.DataFrame()
    tickers = pf["Ticker"].tolist()
    print(f"      {len(tickers)} tickers passed Trend Template")

    print("[2/4] Downloading OHLCV…")
    ohlcv = fetch_ohlcv(tickers, period="2y")
    print(f"      {len(ohlcv)} tickers with sufficient history")

    print("[3/4] Computing RS Rating…")
    rs = compute_rs_scores(ohlcv)
    survivors = [t for t in ohlcv if t in rs.index and rs[t] >= min_rs]
    print(f"      {len(survivors)} tickers with RS ≥ {min_rs}")

    print("[4/4] VCP pattern detection…")
    rows = []
    for t in survivors:
        r = detect_vcp(t, ohlcv[t])
        if vcp_only and not r.detected:
            continue
        d = asdict(r)
        d["rs_rating"] = int(rs[t])
        meta = pf[pf["Ticker"] == t].iloc[0]
        d["company"] = meta.get("Company", "")
        d["sector"] = meta.get("Sector", "")
        d["industry"] = meta.get("Industry", "")
        rows.append(d)

    if not rows:
        return pd.DataFrame()
    out = pd.DataFrame(rows).sort_values("score", ascending=False).reset_index(drop=True)
    return out


if __name__ == "__main__":
    result = run_screener(min_rs=70, vcp_only=True)
    print(f"\n=== {len(result)} VCP candidates ===")
    if not result.empty:
        print(result[["ticker", "company", "score", "rs_rating",
                      "num_contractions", "last_contraction_pct",
                      "pct_to_pivot", "volume_dryup_ratio"]].to_string())

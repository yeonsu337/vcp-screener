"""
VCP Screener — Multi-market Trend Template + VCP pattern detection.

Supports: US (NASDAQ/NYSE via Finviz), HK (Hang Seng via Wikipedia),
KR (KOSPI/KOSDAQ via FinanceDataReader).

Config: config.json at project root.

Pipeline per market:
  1. Fetch universe + broad RS denominator
  2. yfinance OHLCV 2y download (chunked)
  3. Trend Template filter (Finviz prefilter for US; Python-based for HK/KR)
  4. IBD RS Rating percentile (per-market)
  5. VCP detection + scoring
  6. Tag with market field
"""
from __future__ import annotations
import io
import json
import re
from dataclasses import dataclass, asdict
from pathlib import Path

import numpy as np
import pandas as pd
import requests
import yfinance as yf
from finvizfinance.screener.overview import Overview
from scipy.signal import find_peaks

PROJ_DIR = Path(__file__).parent
CACHE_DIR = PROJ_DIR / ".cache"
CACHE_DIR.mkdir(exist_ok=True)
CONFIG_PATH = PROJ_DIR / "config.json"

DEFAULT_CONFIG = {
    "min_rs": 70,
    "max_single_day_drop_pct": 10.0,
    "drawdown_lookback_days": 5,
    "markets": {
        "US": {"enabled": True, "exchanges": ["NASDAQ", "NYSE"]},
        "HK": {"enabled": False},
        "KR": {"enabled": False, "indices": ["KOSPI", "KOSDAQ"]},
    },
}


def load_config() -> dict:
    if CONFIG_PATH.exists():
        try:
            return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"[config] failed to load, using defaults: {e}")
    return DEFAULT_CONFIG


# =============================================================================
# Finviz filters (US only)
# =============================================================================

TREND_TEMPLATE_FILTERS = {
    "Country": "USA",
    "Industry": "Stocks only (ex-Funds)",
    "Price": "Over $10",
    "Average Volume": "Over 500K",
    "50-Day Simple Moving Average": "SMA50 above SMA200",
    "200-Day Simple Moving Average": "Price above SMA200",
    "20-Day Simple Moving Average": "SMA20 above SMA50",
    "52-Week High/Low": "0-10% below High",
    "Performance": "Quarter Up",
}

BROAD_UNIVERSE_FILTERS = {
    "Country": "USA",
    "Industry": "Stocks only (ex-Funds)",
    "Price": "Over $5",
    "Average Volume": "Over 200K",
}


def _finviz_screener(
    base_filters: dict, exchanges: list[str] | None = None
) -> pd.DataFrame:
    """
    Run Finviz screener. If exchanges given (e.g. ["NASDAQ", "NYSE"]),
    makes one call per exchange and unions (Finviz only allows one Exchange value).
    """
    targets = exchanges if exchanges else [None]
    frames: list[pd.DataFrame] = []
    for exch in targets:
        screener = Overview()
        filters = dict(base_filters)
        if exch:
            filters["Exchange"] = exch
        try:
            screener.set_filter(filters_dict=filters)
            df = screener.screener_view(verbose=0)
            if df is not None and not df.empty:
                frames.append(df)
        except Exception as e:
            label = f" {exch}" if exch else ""
            print(f"  [finviz{label}] {e}")
    if not frames:
        return pd.DataFrame()
    return (
        pd.concat(frames, ignore_index=True)
        .drop_duplicates(subset=["Ticker"])
        .reset_index(drop=True)
    )


def fetch_us_prefilter(exchanges: list[str] | None = None) -> pd.DataFrame:
    return _finviz_screener(TREND_TEMPLATE_FILTERS, exchanges)


def fetch_us_broad(exchanges: list[str] | None = None) -> list[str]:
    df = _finviz_screener(BROAD_UNIVERSE_FILTERS, exchanges)
    if df.empty:
        return []
    return sorted(df["Ticker"].tolist())


# =============================================================================
# HK universe — Hang Seng Index constituents from Wikipedia
# =============================================================================

_WIKI_HSI_URL = "https://en.wikipedia.org/wiki/Hang_Seng_Index"


def fetch_hk_universe() -> tuple[list[str], dict[str, str]]:
    """Returns (yfinance_tickers, {ticker: company_name}) for HSI."""
    try:
        ua = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko)"
            )
        }
        r = requests.get(_WIKI_HSI_URL, headers=ua, timeout=15)
        r.raise_for_status()
        tbls = pd.read_html(io.StringIO(r.text))
    except Exception as e:
        print(f"  [hk] Wikipedia fetch failed: {e}")
        return [], {}
    for tbl in tbls:
        if "Ticker" not in tbl.columns:
            continue
        tickers: list[str] = []
        names: dict[str, str] = {}
        for _, row in tbl.iterrows():
            raw = str(row["Ticker"])
            digits = re.sub(r"\D", "", raw)
            if not digits:
                continue
            yf_t = f"{int(digits):04d}.HK"
            tickers.append(yf_t)
            names[yf_t] = str(row.get("Name", ""))
        return sorted(set(tickers)), names
    return [], {}


# =============================================================================
# KR universe — KOSPI / KOSDAQ via FinanceDataReader
# =============================================================================

_KR_SUFFIX = {"KOSPI": ".KS", "KOSDAQ": ".KQ"}


def fetch_kr_universe(
    indices: list[str] | None = None,
) -> tuple[list[str], dict[str, str]]:
    """Returns (yfinance_tickers, {ticker: company_name})."""
    if indices is None:
        indices = ["KOSPI", "KOSDAQ"]
    try:
        import FinanceDataReader as fdr
    except ImportError:
        print("  [kr] FinanceDataReader not installed (pip install finance-datareader)")
        return [], {}
    tickers: list[str] = []
    names: dict[str, str] = {}
    for idx in indices:
        try:
            df = fdr.StockListing(idx)
        except Exception as e:
            print(f"  [kr {idx}] listing failed: {e}")
            continue
        sfx = _KR_SUFFIX.get(idx, ".KS")
        if "Volume" in df.columns:
            df = df[df["Volume"] > 100_000]
        if "Close" in df.columns:
            df = df[df["Close"] > 1000]
        for _, row in df.iterrows():
            code = str(row.get("Code", "")).strip()
            if not code or not code.isdigit():
                continue
            t = f"{code.zfill(6)}{sfx}"
            tickers.append(t)
            names[t] = str(row.get("Name", ""))
    return sorted(set(tickers)), names


# =============================================================================
# yfinance OHLCV download (chunked)
# =============================================================================


def fetch_ohlcv(
    tickers: list[str],
    period: str = "2y",
    chunk_size: int = 400,
    min_bars: int = 60,
) -> dict[str, pd.DataFrame]:
    """Chunked batched download. Returns {ticker: dataframe}."""
    if not tickers:
        return {}
    out: dict[str, pd.DataFrame] = {}
    for i in range(0, len(tickers), chunk_size):
        chunk = tickers[i : i + chunk_size]
        try:
            data = yf.download(
                tickers=" ".join(chunk),
                period=period,
                interval="1d",
                group_by="ticker",
                auto_adjust=True,
                progress=False,
                threads=True,
            )
        except Exception as e:
            print(f"  [ohlcv chunk {i}-{i+len(chunk)}] failed: {e}")
            continue
        if len(chunk) == 1:
            t = chunk[0]
            sub = data.dropna()
            if len(sub) >= min_bars:
                out[t] = sub
            continue
        for t in chunk:
            try:
                sub = data[t].dropna()
                if len(sub) >= min_bars:
                    out[t] = sub
            except (KeyError, AttributeError):
                continue
    return out


# =============================================================================
# Trend Template — Python implementation (for HK/KR where Finviz N/A)
# =============================================================================


def passes_drawdown_filter(
    df: pd.DataFrame,
    max_drop_pct: float = 10.0,
    lookback_days: int = 5,
) -> bool:
    """
    Reject tickers that suffered any single-day drop of `max_drop_pct`% or worse
    within the most recent `lookback_days` trading days.

    Single-day return = Close[t] / Close[t-1] - 1. Catches gap-down + intraday
    crashes (e.g. ANET -13% earnings miss, WFRD guidance cut).
    """
    closes = df["Close"]
    if len(closes) < lookback_days + 1:
        return True  # not enough history → don't filter
    recent = closes.iloc[-(lookback_days + 1):]
    daily_ret = recent.pct_change().dropna()
    worst = float(daily_ret.min())
    threshold = -abs(max_drop_pct) / 100.0
    return worst > threshold


def passes_trend_template(df: pd.DataFrame) -> bool:
    """
    Minervini Trend Template (matches Finviz prefilter criteria):
      - Price > SMA200
      - SMA50 > SMA200
      - SMA20 > SMA50
      - Within 10% of 52-week high
      - Quarter performance > 0
    """
    if len(df) < 252:
        return False
    close = df["Close"]
    p = float(close.iloc[-1])
    sma20 = float(close.rolling(20).mean().iloc[-1])
    sma50 = float(close.rolling(50).mean().iloc[-1])
    sma200 = float(close.rolling(200).mean().iloc[-1])
    high52 = float(close.iloc[-252:].max())
    if len(close) < 64:
        return False
    q_ago = float(close.iloc[-64])
    if any(np.isnan(x) for x in (sma20, sma50, sma200, q_ago)):
        return False
    return bool(
        p > sma200 and sma50 > sma200 and sma20 > sma50 and p >= high52 * 0.90 and p > q_ago
    )


# =============================================================================
# IBD RS Rating
# =============================================================================


def _perf(prices: pd.Series, days: int) -> float:
    if len(prices) < days + 1:
        return np.nan
    return float(prices.iloc[-1] / prices.iloc[-days - 1] - 1.0)


def compute_rs_scores(ohlcv: dict[str, pd.DataFrame]) -> pd.Series:
    """
    IBD-style: 0.4*Q1 + 0.2*Q2 + 0.2*Q3 + 0.2*Q4. Percentile 1-99.
    """
    raw = {}
    for t, df in ohlcv.items():
        c = df["Close"]
        q1 = _perf(c, 63)
        q2 = _perf(c, 126)
        q3 = _perf(c, 189)
        q4 = _perf(c, 252)
        if any(pd.isna(x) for x in (q1, q2, q3, q4)):
            continue
        raw[t] = 0.4 * q1 + 0.2 * q2 + 0.2 * q3 + 0.2 * q4
    s = pd.Series(raw)
    if s.empty:
        return s
    pct = s.rank(pct=True) * 98 + 1
    return pct.round(0).astype(int)


# =============================================================================
# Stage Analysis (Weinstein / Minervini)
# =============================================================================


def determine_stage(df: pd.DataFrame) -> dict:
    """
    Weinstein 4-stage analysis. Stage 2 (Advancing) is the only stage
    Minervini trades — used as a hard filter for VCP detection.

    Returns dict with stage (1-4), stage_name, confidence (0-100).
    """
    result = {"stage": 0, "stage_name": "Unknown", "confidence": 0}
    if len(df) < 252:
        return result
    close = df["Close"]
    current = float(close.iloc[-1])
    sma50 = float(close.rolling(50).mean().iloc[-1])
    sma150 = float(close.rolling(150).mean().iloc[-1])
    sma200 = float(close.rolling(200).mean().iloc[-1])
    sma200_mo_ago = float(close.rolling(200).mean().iloc[-21])

    if any(np.isnan(x) for x in (sma50, sma150, sma200, sma200_mo_ago)):
        return result

    ma_chg = ((sma200 - sma200_mo_ago) / sma200_mo_ago) * 100 if sma200_mo_ago > 0 else 0
    ma_rising = ma_chg > 1.0
    ma_falling = ma_chg < -1.0
    above_200 = current > sma200

    # Stage 2: perfect Minervini alignment + rising 200 SMA
    if current > sma50 > sma150 > sma200 and ma_rising:
        stage, conf = 2, 80
        # Quarter performance boost
        if len(close) > 64 and current > float(close.iloc[-64]):
            conf += 10
        # Higher 52W position boost
        high52 = float(close.iloc[-252:].max())
        if current >= high52 * 0.90:
            conf += 10
    elif not above_200 and ma_falling:
        stage, conf = 4, 75
    elif not ma_rising and not ma_falling:  # flat
        stage, conf = 1, 60
    elif above_200 and (not ma_rising or sma50 < sma200):
        stage, conf = 3, 65
    elif not above_200 and ma_rising:
        stage, conf = 1, 55
    else:
        stage = 4 if not above_200 else 3
        conf = 50

    names = {1: "Basing", 2: "Advancing", 3: "Topping", 4: "Declining", 0: "Unknown"}
    return {"stage": stage, "stage_name": names[stage], "confidence": min(100, conf)}


def compute_ma_alignment(df: pd.DataFrame) -> float:
    """
    MA alignment score (0-15). Full alignment = SMA20 > SMA50 > SMA150 > SMA200,
    price above all of them.
    """
    if len(df) < 252:
        return 0.0
    close = df["Close"]
    p = float(close.iloc[-1])
    sma20 = float(close.rolling(20).mean().iloc[-1])
    sma50 = float(close.rolling(50).mean().iloc[-1])
    sma150 = float(close.rolling(150).mean().iloc[-1])
    sma200 = float(close.rolling(200).mean().iloc[-1])
    if any(np.isnan(x) for x in (sma20, sma50, sma150, sma200)):
        return 0.0
    pts = 0.0
    if p > sma200:
        pts += 3
    if sma50 > sma200:
        pts += 3
    if sma20 > sma50:
        pts += 3
    if sma150 > sma200:
        pts += 3
    if p > sma50:
        pts += 3
    return min(15.0, pts)


def compute_composite_score(
    rs_rating: int,
    stage: int,
    stage_confidence: float,
    vcp_quality: float,
    ma_alignment: float,
    pct_from_52w_high: float,
    rs_line_pct: float,
) -> float:
    """
    Composite score 0-100 (xang1234-inspired weighted system).

    Components:
      RS Rating      : 20 pts  (percentile rank in broad universe)
      Stage 2        : 20 pts  (Weinstein stage + confidence)
      MA Alignment   : 15 pts  (SMA cascade quality)
      52W Position   : 15 pts  (proximity to 52-week high)
      VCP Quality    : 20 pts  (contractions + tightening + dry-up + depth)
      RS Line        : 10 pts  (relative strength vs benchmark trend)
    """
    # RS Rating: 0-20
    rs_pts = (rs_rating / 99) * 20

    # Stage: 0-20 (only Stage 2 gets meaningful points)
    if stage == 2:
        stage_pts = (stage_confidence / 100) * 20
    elif stage == 3:
        stage_pts = 5.0
    else:
        stage_pts = 0.0

    # MA Alignment: 0-15 (passed in directly)
    ma_pts = ma_alignment

    # 52W Position: 0-15 (at high = 15, 25% below = 0)
    pct = max(-25.0, min(0.0, pct_from_52w_high))
    position_pts = max(0.0, 15.0 + pct * 0.6)

    # VCP Quality: 0-20 (passed in from detect_vcp)
    vcp_pts = vcp_quality

    # RS Line: 0-10
    if rs_line_pct != rs_line_pct:  # NaN
        rsline_pts = 5.0
    else:
        rsline_pts = max(0.0, min(10.0, 5.0 + rs_line_pct * 0.5))

    total = rs_pts + stage_pts + ma_pts + position_pts + vcp_pts + rsline_pts
    return round(min(100.0, max(0.0, total)), 1)


# =============================================================================
# Composite Score v2 (Minervini SEPA Fundamentals + A1 continuous)
# Phase 1.4-α: additive — existing 100pt + Fundamentals 30pt + A1 5pt = 135pt → normalize ×(100/135)
# KR/HK Fundamentals fallback = 0pt (conservative — no synthetic credit)
# =============================================================================


def compute_fundamentals_score(
    eps_yoy_q: float | None,
    sales_yoy_q: float | None,
    roe: float | None,
    op_inc_growing: bool,
    op_inc_accel: bool,
) -> float:
    """Fundamentals 0~30pt. None → 0pt for that component (conservative)."""
    # EPS YoY 10pt — Minervini: ≥20% baseline, ≥40% strong
    if eps_yoy_q is None:
        eps_pts = 0.0
    elif eps_yoy_q >= 40:
        eps_pts = 10.0
    elif eps_yoy_q >= 18:
        eps_pts = 3.0 + (eps_yoy_q - 18) / 22 * 7
    else:
        eps_pts = 0.0

    # Sales YoY 8pt — Minervini: ≥15% baseline, ≥30% strong
    if sales_yoy_q is None:
        sales_pts = 0.0
    elif sales_yoy_q >= 30:
        sales_pts = 8.0
    elif sales_yoy_q >= 15:
        sales_pts = 2.0 + (sales_yoy_q - 15) / 15 * 6
    else:
        sales_pts = 0.0

    # ROE 7pt — Minervini: ≥17%
    if roe is None:
        roe_pts = 0.0
    elif roe >= 17:
        roe_pts = 7.0
    elif roe >= 12:
        roe_pts = 2.0 + (roe - 12) / 5 * 5
    else:
        roe_pts = 0.0

    # Op income trend 5pt (growing 2 + accelerating 3)
    op_pts = (2.0 if op_inc_growing else 0.0) + (3.0 if op_inc_accel else 0.0)

    return round(eps_pts + sales_pts + roe_pts + op_pts, 2)


def compute_a1_continuous(a1_ratio: float | None) -> float:
    """A1 up/down vol ratio → 0~5pt sliding scale.
    A1 1.0 → 0pt, 1.5 → 2pt, 2.0 → 4pt, 2.25+ → 5pt."""
    if a1_ratio is None:
        return 0.0
    return round(max(0.0, min(5.0, (a1_ratio - 1.0) * 4.0)), 2)


def compute_composite_v2_from_row(row: dict) -> dict:
    """v2 composite from a results-row dict (post rules computation).
    Returns dict with score_v2 (0~100), fundamentals_score, fundamentals_basis, a1_pts.
    KR/HK: fundamentals = 0 (conservative). score_v2 caps at ~77.8 for these markets."""
    score_v1 = row.get("score") or 0.0
    market = row.get("market") or "US"
    rules = row.get("rules") or {}

    def _val(rule_id: str):
        r = rules.get(rule_id) or {}
        return r.get("value")

    def _pass(rule_id: str) -> bool:
        r = rules.get(rule_id) or {}
        return bool(r.get("passed"))

    if market == "US":
        fund_pts = compute_fundamentals_score(
            eps_yoy_q=_val("E1_eps_growth"),
            sales_yoy_q=_val("E3_rev_growth"),
            roe=_val("E7_roe"),
            op_inc_growing=_pass("E5_op_inc_growing"),
            op_inc_accel=_pass("E6_op_inc_yoy_accel"),
        )
        fund_basis = "computed"
    else:
        fund_pts = 0.0
        fund_basis = "fallback_kr_hk"

    a1_pts = compute_a1_continuous(_val("A1_ud_vol_ratio"))

    raw_total = score_v1 + fund_pts + a1_pts  # 0~135 (US) / 0~105 (KR/HK)
    score_v2 = round(raw_total * (100.0 / 135.0), 1)

    return {
        "score_v2": score_v2,
        "fundamentals_score": fund_pts,
        "fundamentals_basis": fund_basis,
        "a1_pts": a1_pts,
    }


# =============================================================================
# Benchmark + RS Line
# =============================================================================


BENCHMARK_TICKERS = {"US": "SPY", "HK": "^HSI", "KR": "^KS11"}


def fetch_benchmark(market: str, period: str = "2y") -> pd.Series | None:
    """Download benchmark close prices for RS Line computation."""
    ticker = BENCHMARK_TICKERS.get(market)
    if not ticker:
        return None
    try:
        data = yf.download(
            ticker, period=period, interval="1d",
            auto_adjust=True, progress=False,
        )
        if data is not None and not data.empty:
            close = data["Close"].dropna()
            if hasattr(close, "squeeze"):
                close = close.squeeze()
            return close
    except Exception as e:
        print(f"  [benchmark {ticker}] {e}")
    return None


def compute_rs_line_pct(stock_close: pd.Series, bench_close: pd.Series) -> float:
    """
    RS Line = stock / benchmark (aligned by date).
    Returns how far the current RS Line is from its 52-week high (%).
    Positive = at or above high; negative = below high.
    """
    s = stock_close.squeeze() if hasattr(stock_close, "squeeze") else stock_close
    b = bench_close.squeeze() if hasattr(bench_close, "squeeze") else bench_close
    aligned = pd.DataFrame({"s": s, "b": b}).dropna()
    if len(aligned) < 60:
        return np.nan
    rs_line = aligned["s"] / aligned["b"]
    last_252 = rs_line.iloc[-252:] if len(rs_line) >= 252 else rs_line
    rs_high = float(last_252.max())
    rs_now = float(rs_line.iloc[-1])
    if rs_high == 0:
        return np.nan
    return (rs_now / rs_high - 1.0) * 100


@dataclass
class VCPResult:
    ticker: str
    detected: bool
    stage: int                  # Weinstein stage 1-4 (2 = ideal)
    stage_name: str
    num_contractions: int
    contractions: list[float]
    last_contraction_pct: float
    base_days: int
    base_depth_pct: float       # max drawdown within the base (high→low)
    pivot_price: float
    current_price: float
    pct_to_pivot: float
    volume_dryup_ratio: float
    vcp_quality: float          # VCP pattern quality 0-20
    score: float                # composite score 0-100 (set by pipeline)
    # Visualization metadata (for chart overlays). All fields optional.
    contraction_ranges: list = None     # [{start,end,high,low,depth_pct}]
    pivot_date: str = None              # YYYY-MM-DD of last swing high
    shakeout_dates: list = None         # ["YYYY-MM-DD", ...]
    dryup_ranges: list = None           # [{start,end}]

    def __post_init__(self):
        # Default to empty list when None for JSON serialization.
        if self.contraction_ranges is None:
            self.contraction_ranges = []
        if self.shakeout_dates is None:
            self.shakeout_dates = []
        if self.dryup_ranges is None:
            self.dryup_ranges = []


# =============================================================================
# Rule-based scoring (CANSLIM-style soft ranking)
# =============================================================================


@dataclass
class RuleResult:
    """Single rule evaluation. value/threshold may be None when N/A."""
    name: str
    passed: bool
    value: float | None = None
    threshold: float | None = None
    note: str = ""

    def __post_init__(self):
        # Coerce numpy types to native Python for JSON serialization.
        self.passed = bool(self.passed)
        if self.value is not None:
            try:
                self.value = float(self.value)
            except (TypeError, ValueError):
                self.value = None
        if self.threshold is not None:
            try:
                self.threshold = float(self.threshold)
            except (TypeError, ValueError):
                self.threshold = None


# Liquidity threshold per market (local currency, daily dollar volume).
# US ~$20M ≈ KR ₩20B ≈ HK$150M (rough parity).
LIQUIDITY_THRESHOLDS = {
    "US": 20_000_000,
    "HK": 150_000_000,
    "KR": 20_000_000_000,
}


def _consecutive_rising(series_values: np.ndarray, days: int = 21) -> tuple[bool, int]:
    """Return (all_rising_for_last `days`, count of rising transitions)."""
    if len(series_values) < days:
        return False, 0
    last = series_values[-days:]
    transitions = 0
    valid_transitions = 0
    for i in range(1, len(last)):
        a, b = last[i - 1], last[i]
        if np.isnan(a) or np.isnan(b):
            continue
        valid_transitions += 1
        if b > a:
            transitions += 1
    all_rising = (valid_transitions > 0 and transitions == valid_transitions)
    return all_rising, transitions


def _hh_hl_check(close: pd.Series, lookback: int = 130, min_pairs: int = 3) -> tuple[bool, int]:
    """
    Check whether last `lookback` bars form Higher Highs / Higher Lows structure.

    Algorithm: detect swing highs/lows via scipy.find_peaks with prominence proportional
    to recent volatility, then verify at least `min_pairs` consecutive HH and HL pairs.

    Returns (passed, n_consecutive_pairs).
    """
    if len(close) < lookback:
        return False, 0
    try:
        from scipy.signal import find_peaks
    except Exception:
        return False, 0
    seg = close.iloc[-lookback:].values
    if len(seg) < 20:
        return False, 0
    # Prominence as a fraction of price range — keeps detection scale-invariant.
    rng = float(np.nanmax(seg) - np.nanmin(seg))
    prom = max(rng * 0.04, 1e-6)
    distance = 5  # minimum bars between swings
    highs_idx, _ = find_peaks(seg, prominence=prom, distance=distance)
    lows_idx, _ = find_peaks(-seg, prominence=prom, distance=distance)
    if len(highs_idx) < 2 or len(lows_idx) < 2:
        return False, 0
    # Count consecutive HH from the most recent backwards
    hh_count = 0
    for i in range(len(highs_idx) - 1, 0, -1):
        if seg[highs_idx[i]] > seg[highs_idx[i - 1]]:
            hh_count += 1
        else:
            break
    hl_count = 0
    for i in range(len(lows_idx) - 1, 0, -1):
        if seg[lows_idx[i]] > seg[lows_idx[i - 1]]:
            hl_count += 1
        else:
            break
    pairs = min(hh_count, hl_count)
    return pairs >= min_pairs, pairs


def evaluate_rules(
    df: pd.DataFrame,
    rs_rating: int,
    market: str,
    vcp: VCPResult | None = None,
    fundamentals: dict | None = None,
    stage: int = 0,
) -> dict[str, RuleResult]:
    """
    Compute all per-stock pass/fail rules. Returns dict of rule_id -> RuleResult.

    Rule pool:
      Volume (1): A1
      Trend — Minervini Trend Template (7 Primary): B1-B7
      Trend — Bonus (3 Secondary): B8-B10
      Relative Strength (3): R1-R3 (70 / 80 / 90)
      Volatility — ATR Contraction (2 Secondary): V1, V2
      Liquidity (1 Primary + 3 Secondary): L1-L4
      VCP Pattern (5): P1-P4 + P6 (P5 Shakeout deferred to chart annotation)
      Earnings (10, US only): E1-E10 (E7 ROE Primary)
      Leadership (3, US only): F1-F3 (F1 1Y outperform Primary)
      Quality (4, US only): H1-H4 (H4 3Y CAGR Primary)
    """
    rules: dict[str, RuleResult] = {}
    close = df["Close"]

    # ---- Volume (IBD U/D Volume Ratio, 50-day daily) ----
    # Industry standard: sum of volume on up days / sum on down days over last 50 trading days.
    # ≥ 1.0 = buying pressure dominates (IBD pass threshold).
    # ≥ 1.25-1.50 = CANSLIM long-setup minimum (handled as separate Secondary rule later).
    if len(df) >= 50 and "Volume" in df.columns:
        c = close.iloc[-50:].values
        v = df["Volume"].iloc[-50:].values
        up_vol = 0.0
        dn_vol = 0.0
        for i in range(1, len(c)):
            if np.isnan(c[i]) or np.isnan(c[i - 1]) or np.isnan(v[i]):
                continue
            if c[i] > c[i - 1]:
                up_vol += float(v[i])
            elif c[i] < c[i - 1]:
                dn_vol += float(v[i])
        if dn_vol > 0:
            ud_ratio = up_vol / dn_vol
            rules["A1_ud_vol_ratio"] = RuleResult(
                "U/D Volume Ratio ≥ 1.0 (50d)",
                ud_ratio >= 1.0,
                round(ud_ratio, 3), 1.0)
        elif up_vol > 0:
            # All up days or no down days — strongly bullish
            rules["A1_ud_vol_ratio"] = RuleResult(
                "U/D Volume Ratio ≥ 1.0 (50d)",
                True, None, 1.0,
                note="no down-day volume in window")

    # ---- Trend — Minervini Trend Template (8 official criteria, plus Stage2/HH-HL bonus) ----
    if len(close) >= 200:
        p = float(close.iloc[-1])
        sma50 = float(close.rolling(50).mean().iloc[-1])
        sma150 = float(close.rolling(150).mean().iloc[-1])
        sma200_series = close.rolling(200).mean()
        sma200 = float(sma200_series.iloc[-1])
        if not any(np.isnan(x) for x in (sma50, sma150, sma200)):
            # B1: Price > SMA150 AND Price > SMA200 (Minervini #1)
            b1_pass = p > sma150 and p > sma200
            b1_val = round(min(p / sma150, p / sma200), 4) if (sma150 and sma200) else None
            rules["B1_price_above_150_200"] = RuleResult(
                "Price > SMA150 & SMA200", b1_pass, b1_val, 1.0)

            # B2: SMA150 > SMA200 (Minervini #2)
            rules["B2_sma150_gt_sma200"] = RuleResult(
                "SMA150 > SMA200", sma150 > sma200,
                round(sma150 / sma200, 4) if sma200 else None, 1.0)

            # B3: SMA50 > SMA150 AND SMA50 > SMA200 (Minervini #4)
            b3_pass = sma50 > sma150 and sma50 > sma200
            b3_val = round(min(sma50 / sma150, sma50 / sma200), 4) if (sma150 and sma200) else None
            rules["B3_sma50_gt_150_200"] = RuleResult(
                "SMA50 > SMA150 & SMA200", b3_pass, b3_val, 1.0)

            # B4: Price > SMA50 (Minervini #5)
            rules["B4_price_above_sma50"] = RuleResult(
                "Price > SMA50", p > sma50,
                round(p / sma50, 4) if sma50 else None, 1.0)

            # B5: 200d SMA rising for 4-5 months (Minervini #3)
            # Standard: minimum 1 month, ideal 4-5 months. We require 100 trading days (~5 months).
            sma200_vals = sma200_series.values
            B5_WINDOW = 100
            b5_pass = False
            b5_rising_days = 0
            if len(sma200_vals) >= B5_WINDOW + 1:
                b5_all_rising, b5_rising_days = _consecutive_rising(sma200_vals, days=B5_WINDOW)
                b5_pass = b5_all_rising
            rules["B5_sma200_rising_5mo"] = RuleResult(
                "200d SMA rising 4-5 months",
                b5_pass, float(b5_rising_days), float(B5_WINDOW - 1))

    # ---- 52W high / low position (Minervini #6, #7) ----
    if len(close) >= 252:
        p = float(close.iloc[-1])
        high52 = float(close.iloc[-252:].max())
        low52 = float(close.iloc[-252:].min())
        pct_below_high = (p / high52 - 1.0) * 100  # negative = below high
        pct_above_low = (p / low52 - 1.0) * 100 if low52 > 0 else 0.0

        # B6: Price >= 30% above 52W low (Minervini #6)
        rules["B6_30pct_above_52w_low"] = RuleResult(
            "≥ 30% above 52W low", pct_above_low >= 30.0,
            round(pct_above_low, 2), 30.0)

        # B7: Price within 25% of 52W high (Minervini #7) — Primary gate
        rules["B7_within_25pct_high"] = RuleResult(
            "Within 25% of 52W high", pct_below_high >= -25.0,
            round(pct_below_high, 2), -25.0)

        # B8: Price within 10% of 52W high — Secondary bonus (closer to pivot)
        rules["B8_within_10pct_high"] = RuleResult(
            "Within 10% of 52W high (bonus)", pct_below_high >= -10.0,
            round(pct_below_high, 2), -10.0)

    # ---- B9: Stage 2 (Weinstein) — already computed by determine_stage() ----
    if stage > 0:
        rules["B9_stage2"] = RuleResult(
            "Weinstein Stage 2 (Advancing)", stage == 2,
            float(stage), 2.0)

    # ---- B10: Higher Highs / Higher Lows (last 6 months swing structure) ----
    if len(close) >= 130:
        b10_pass, b10_pairs = _hh_hl_check(close, lookback=130, min_pairs=3)
        rules["B10_higher_highs_lows"] = RuleResult(
            "Higher Highs / Higher Lows (3+ pairs)",
            b10_pass, float(b10_pairs), 3.0)

    # ---- Relative Strength (3-tier: 70 Minervini gate / 80 CANSLIM Leader / 90 strong) ----
    rules["R1_rs_70"] = RuleResult(
        "RS Rating ≥ 70 (Minervini gate)", rs_rating >= 70, float(rs_rating), 70.0)
    rules["R2_rs_80"] = RuleResult(
        "RS Rating ≥ 80 (CANSLIM Leader)", rs_rating >= 80, float(rs_rating), 80.0)
    rules["R3_rs_90"] = RuleResult(
        "RS Rating ≥ 90 (Strong leader)", rs_rating >= 90, float(rs_rating), 90.0)

    # ---- Volatility (ATR Contraction) ----
    # V1: 50d ATR(14) / 250d ATR(14) < 0.85
    #     Recent quarter's average daily range vs full-year average. Captures VCP-style contraction.
    # V2: 30d return stdev / 60d return stdev < 1.0
    #     Last 6 weeks' daily-return volatility vs prior 12 weeks. Near-term tightening.
    if len(df) >= 250 and {"High", "Low", "Close"}.issubset(df.columns):
        h_arr = df["High"].values
        l_arr = df["Low"].values
        c_arr = df["Close"].values
        prev_close = np.concatenate(([np.nan], c_arr[:-1]))
        tr = np.maximum.reduce([
            h_arr - l_arr,
            np.abs(h_arr - prev_close),
            np.abs(l_arr - prev_close),
        ])
        atr14 = pd.Series(tr).rolling(14).mean()
        if len(atr14) >= 250 and not np.isnan(atr14.iloc[-1]):
            atr_50 = float(atr14.iloc[-50:].mean())
            atr_250 = float(atr14.iloc[-250:].mean())
            if atr_250 > 0:
                v1_ratio = atr_50 / atr_250
                rules["V1_atr_contraction"] = RuleResult(
                    "ATR Contraction (50d/250d < 0.85)",
                    v1_ratio < 0.85, round(v1_ratio, 3), 0.85)

    if len(close) >= 60:
        ret = close.pct_change()
        std30 = float(ret.iloc[-30:].std())
        std60 = float(ret.iloc[-60:].std())
        if std60 > 0 and not np.isnan(std30):
            v2_ratio = std30 / std60
            rules["V2_short_term_tightening"] = RuleResult(
                "Near-term volatility tightening (30d/60d < 1.0)",
                v2_ratio < 1.0, round(v2_ratio, 3), 1.0)

    # ---- Liquidity (4-tier: $20M gate / $50M institutional / 400K shares / $12 floor) ----
    if len(df) >= 50:
        sma50_price = float(close.iloc[-50:].mean())
        sma50_vol = float(df["Volume"].iloc[-50:].mean())
        dollar_vol = sma50_price * sma50_vol
        threshold = LIQUIDITY_THRESHOLDS.get(market, 20_000_000)

        # L1: market-specific gate (Primary). Was V2_liquidity.
        rules["L1_liquidity_gate"] = RuleResult(
            "Daily $ volume ≥ market threshold",
            dollar_vol >= threshold,
            round(dollar_vol, 0), float(threshold))

        # L2: $50M institutional grade (Secondary, US-style threshold scaled by market multiplier)
        l2_threshold = threshold * 2.5
        rules["L2_liquidity_50m"] = RuleResult(
            "Daily $ volume ≥ 2.5× threshold (institutional)",
            dollar_vol >= l2_threshold,
            round(dollar_vol, 0), float(l2_threshold))

        # L3: 400K avg shares per day (Secondary, US only — share counts are not comparable cross-market)
        if market == "US":
            rules["L3_share_volume"] = RuleResult(
                "Avg shares ≥ 400K (50d)",
                sma50_vol >= 400_000,
                round(sma50_vol, 0), 400_000.0)

        # L4: $12 minimum price (Secondary, US only — Minervini penny-stock floor)
        if market == "US":
            current_price = float(close.iloc[-1])
            rules["L4_price_floor"] = RuleResult(
                "Price ≥ $12 (Minervini floor)",
                current_price >= 12.0,
                round(current_price, 2), 12.0)

    # ---- VCP Pattern (from VCPResult) ----
    if vcp is not None:
        recent = vcp.contractions

        # P1: Progressive tightening, now requires n ≥ 3 (Minervini ideal: 18→12→6 pattern).
        is_tightening = (
            len(recent) >= 3 and
            all(recent[i] <= recent[i - 1] * 1.10 for i in range(1, len(recent)))
        )
        rules["P1_tightening"] = RuleResult(
            "Progressive tightening (n≥3)", is_tightening,
            float(len(recent)), 3.0)

        # P2: Last contraction < 6.5% (tightened from 10%).
        last_c = vcp.last_contraction_pct
        last_c_passed = (last_c == last_c) and (last_c < 6.5)
        rules["P2_last_contraction"] = RuleResult(
            "Last contraction < 6.5%", last_c_passed,
            round(last_c, 2) if last_c == last_c else None, 6.5)

        # P3: Volume dry-up.
        vr = vcp.volume_dryup_ratio
        vr_passed = (vr == vr) and (vr < 0.6)
        rules["P3_vol_dryup"] = RuleResult(
            "Volume dry-up < 0.6× SMA50", vr_passed,
            round(vr, 3) if vr == vr else None, 0.6)

        # P4: Base count ≤ 2 (1st-2nd base only — Minervini favors early bases).
        # Heuristic proxy: if last 6m return < 50% AND 6m return > 0% → likely 1-2 bases formed.
        # If 6m return > 100% → likely 3rd+ base (extended).
        base_count_proxy: int | None = None
        if len(close) >= 130:
            p_now = float(close.iloc[-1])
            p_6m = float(close.iloc[-130])
            if p_6m > 0:
                ret_6m = (p_now / p_6m - 1) * 100
                if ret_6m <= 50:
                    base_count_proxy = 1 if ret_6m <= 25 else 2
                elif ret_6m <= 100:
                    base_count_proxy = 3
                else:
                    base_count_proxy = 4
        if base_count_proxy is not None:
            rules["P4_base_count"] = RuleResult(
                "Base count ≤ 2 (early base)",
                base_count_proxy <= 2,
                float(base_count_proxy), 2.0,
                note="proxy from 6m return")

        # P6: Contractions monotonically decreasing — each ≤ 75% of prior (Minervini ideal).
        if len(recent) >= 3:
            mono_pass = all(
                recent[i] <= recent[i - 1] * 0.75 for i in range(1, len(recent))
            )
            ratios = [recent[i] / recent[i - 1] for i in range(1, len(recent)) if recent[i - 1] > 0]
            avg_ratio = float(np.mean(ratios)) if ratios else 1.0
            rules["P6_monotonic_decreasing"] = RuleResult(
                "Contractions monotonic ≤0.75× prior",
                mono_pass, round(avg_ratio, 3), 0.75)

    # ---- Fundamentals (US only; N/A for HK/KR) ----
    if market == "US" and fundamentals:
        # E1: EPS QoQ YoY > 18% (existing F1 threshold preserved per user decision).
        eps_g = fundamentals.get("earningsQuarterlyGrowth")
        if eps_g is not None:
            rules["E1_eps_growth"] = RuleResult(
                "EPS QoQ YoY > 18%", eps_g > 0.18,
                round(eps_g * 100, 2), 18.0)

        # E3: Sales YoY > 25%.
        rev_g = fundamentals.get("revenueGrowth")
        if rev_g is not None:
            rules["E3_rev_growth"] = RuleResult(
                "Sales YoY > 25%", rev_g > 0.25,
                round(rev_g * 100, 2), 25.0)

        # E7: ROE ≥ 17% (Minervini standard) — Primary.
        roe = fundamentals.get("returnOnEquity")
        if roe is not None:
            rules["E7_roe"] = RuleResult(
                "ROE ≥ 17% (Minervini)", roe >= 0.17,
                round(roe * 100, 2), 17.0)

        # E10: Institutional ownership ≥ 5%.
        inst = fundamentals.get("heldPercentInstitutions")
        if inst is not None:
            rules["E10_inst_ownership"] = RuleResult(
                "Institutional own. ≥ 5%", inst >= 0.05,
                round(inst * 100, 2), 5.0)

        # E2: EPS YoY acceleration — last 4 quarters' YoY monotonically increasing.
        eps_yoy_series = fundamentals.get("eps_yoy_4q")  # list of 4 floats (oldest→newest), %
        if eps_yoy_series and len(eps_yoy_series) == 4 and all(v is not None for v in eps_yoy_series):
            accel = all(eps_yoy_series[i] > eps_yoy_series[i - 1] for i in range(1, 4))
            rules["E2_eps_yoy_accel"] = RuleResult(
                "EPS YoY 4Q monotonic acceleration", accel,
                round(eps_yoy_series[-1] - eps_yoy_series[0], 2), 0.0)

        # E4: Sales YoY acceleration.
        rev_yoy_series = fundamentals.get("revenue_yoy_4q")
        if rev_yoy_series and len(rev_yoy_series) == 4 and all(v is not None for v in rev_yoy_series):
            accel = all(rev_yoy_series[i] > rev_yoy_series[i - 1] for i in range(1, 4))
            rules["E4_rev_yoy_accel"] = RuleResult(
                "Sales YoY 4Q monotonic acceleration", accel,
                round(rev_yoy_series[-1] - rev_yoy_series[0], 2), 0.0)

        # E5: Operating income growing across last 4 quarters (QoQ ↑).
        op_inc_4q = fundamentals.get("operating_income_4q")
        if op_inc_4q and len(op_inc_4q) == 4 and all(v is not None for v in op_inc_4q):
            growing = all(op_inc_4q[i] > op_inc_4q[i - 1] for i in range(1, 4))
            rules["E5_op_inc_growing"] = RuleResult(
                "Operating Income 4Q QoQ growing", growing,
                None, None)

        # E6: Operating income YoY acceleration.
        op_inc_yoy_series = fundamentals.get("op_income_yoy_4q")
        if op_inc_yoy_series and len(op_inc_yoy_series) == 4 and all(v is not None for v in op_inc_yoy_series):
            accel = all(op_inc_yoy_series[i] > op_inc_yoy_series[i - 1] for i in range(1, 4))
            rules["E6_op_inc_yoy_accel"] = RuleResult(
                "Op Income YoY 4Q acceleration", accel,
                round(op_inc_yoy_series[-1] - op_inc_yoy_series[0], 2), 0.0)

        # E8: Annual EPS YoY ≥ 25%.
        annual_eps_yoy = fundamentals.get("annual_eps_yoy")
        if annual_eps_yoy is not None:
            rules["E8_annual_eps_growth"] = RuleResult(
                "Annual EPS YoY ≥ 25%", annual_eps_yoy >= 25.0,
                round(annual_eps_yoy, 2), 25.0)

        # E9: EPS breakout — current Q EPS > max of prior 8 quarters.
        eps_breakout = fundamentals.get("eps_breakout")  # bool
        if eps_breakout is not None:
            rules["E9_eps_breakout"] = RuleResult(
                "EPS breakout (>8Q max)", bool(eps_breakout),
                None, None)

        # F1: 1Y outperform NASDAQ — Primary.
        outperform_1y = fundamentals.get("outperform_1y")  # % delta
        if outperform_1y is not None:
            rules["F1_outperform_1y"] = RuleResult(
                "1Y return > NASDAQ", outperform_1y > 0,
                round(outperform_1y, 2), 0.0)

        # F2: 6M outperform NASDAQ.
        outperform_6m = fundamentals.get("outperform_6m")
        if outperform_6m is not None:
            rules["F2_outperform_6m"] = RuleResult(
                "6M return > NASDAQ", outperform_6m > 0,
                round(outperform_6m, 2), 0.0)

        # F3: 1M outperform NASDAQ.
        outperform_1m = fundamentals.get("outperform_1m")
        if outperform_1m is not None:
            rules["F3_outperform_1m"] = RuleResult(
                "1M return > NASDAQ", outperform_1m > 0,
                round(outperform_1m, 2), 0.0)

        # H1: Short Float ≤ 5% (low short = bullish consensus, no shorting pressure).
        short_float = fundamentals.get("shortPercentOfFloat")
        if short_float is not None:
            rules["H1_short_float"] = RuleResult(
                "Short Float ≤ 5%", short_float <= 0.05,
                round(short_float * 100, 2), 5.0)

        # H2: CFPS / EPS ≥ 1.20 (cash flow exceeds accounting earnings by 20%+).
        cfps_eps_ratio = fundamentals.get("cfps_to_eps")
        if cfps_eps_ratio is not None:
            rules["H2_cfps_to_eps"] = RuleResult(
                "CFPS / EPS ≥ 1.20 (cash quality)",
                cfps_eps_ratio >= 1.20,
                round(cfps_eps_ratio, 3), 1.20)

        # H3: TTM net margin at 5-year high.
        net_margin_5y_high = fundamentals.get("net_margin_5y_high")
        if net_margin_5y_high is not None:
            rules["H3_net_margin_high"] = RuleResult(
                "TTM Net Margin = 5Y high",
                bool(net_margin_5y_high),
                None, None)

        # H4: 3-year Net Income CAGR ≥ 25% — Primary.
        ni_cagr_3y = fundamentals.get("ni_cagr_3y")
        if ni_cagr_3y is not None:
            rules["H4_ni_cagr_3y"] = RuleResult(
                "3Y Net Income CAGR ≥ 25%",
                ni_cagr_3y >= 25.0,
                round(ni_cagr_3y, 2), 25.0)

    return rules


def evaluate_market_direction(bench_close: pd.Series | None) -> dict[str, RuleResult]:
    """Index-level rules — computed once per market, displayed as banner."""
    rules: dict[str, RuleResult] = {}
    if bench_close is None or len(bench_close) < 50:
        return rules
    sma21_series = bench_close.rolling(21).mean()
    sma50_series = bench_close.rolling(50).mean()
    sma21 = float(sma21_series.iloc[-1])
    sma50 = float(sma50_series.iloc[-1])
    if not (np.isnan(sma21) or np.isnan(sma50)):
        rules["MD1_idx_sma21_gt_sma50"] = RuleResult(
            "Index SMA21 > SMA50", sma21 > sma50,
            round(sma21 / sma50, 4) if sma50 else None, 1.0)
    all_rising, rising_days = _consecutive_rising(sma50_series.values, days=18)
    rules["MD2_idx_sma50_rising_21d"] = RuleResult(
        "Index 50d SMA rising 17d", all_rising,
        float(rising_days), 17.0)
    return rules


def _row_first(df, *names):
    """Return first matching row from a yfinance income-statement / cashflow DataFrame."""
    if df is None or df.empty:
        return None
    for n in names:
        if n in df.index:
            return df.loc[n]
    return None


def _compute_quarterly_metrics(t: yf.Ticker) -> dict:
    """
    Build quarterly/annual metrics needed by E2/E4/E5/E6/E8/E9/H2/H3/H4.

    Returns flat dict (all keys may be None when data missing). All series are
    ordered oldest→newest (4 quarters or 5 years).
    """
    out: dict = {}
    try:
        q_is = t.quarterly_financials
    except Exception:
        q_is = None
    try:
        a_is = t.financials
    except Exception:
        a_is = None
    try:
        a_cf = t.cashflow
    except Exception:
        a_cf = None

    # ---- Quarterly EPS / Revenue / Operating Income last 8 quarters (newest→oldest in yfinance) ----
    eps_row = _row_first(q_is, "Diluted EPS", "Basic EPS")
    rev_row = _row_first(q_is, "Total Revenue")
    op_row = _row_first(q_is, "Operating Income")

    def _to_list(row, n):
        if row is None:
            return None
        vals = row.values[:n].tolist() if len(row.values) >= n else row.values.tolist() + [None] * (n - len(row.values))
        return [None if (v is None or (isinstance(v, float) and np.isnan(v))) else float(v) for v in vals]

    eps_q = _to_list(eps_row, 8)  # newest first
    rev_q = _to_list(rev_row, 8)
    op_q = _to_list(op_row, 8)

    # ---- E2 / E4 / E6: 4 quarters of YoY growth %, oldest→newest ----
    def _yoy_4q(q):
        if q is None or len(q) < 8:
            return None
        out_yoy = []
        for i in range(4):
            cur = q[i]
            prior = q[i + 4]
            if cur is None or prior is None or prior == 0:
                out_yoy.append(None)
            else:
                out_yoy.append(round((cur / abs(prior) - 1) * 100, 2))
        return list(reversed(out_yoy))  # oldest→newest

    out["eps_yoy_4q"] = _yoy_4q(eps_q)
    out["revenue_yoy_4q"] = _yoy_4q(rev_q)
    out["op_income_yoy_4q"] = _yoy_4q(op_q)

    # ---- E5: Operating income last 4 quarters QoQ (oldest→newest) ----
    if op_q is not None and len(op_q) >= 4:
        out["operating_income_4q"] = list(reversed(op_q[:4]))

    # ---- E9: EPS breakout — most recent Q EPS > max of prior 8 quarters ----
    if eps_q is not None and len(eps_q) >= 8 and eps_q[0] is not None:
        prior = [v for v in eps_q[1:] if v is not None]
        if prior:
            out["eps_breakout"] = bool(eps_q[0] > max(prior))

    # ---- E8 / H4: Annual EPS YoY + Net Income 3-year CAGR ----
    a_eps_row = _row_first(a_is, "Diluted EPS", "Basic EPS")
    a_ni_row = _row_first(a_is, "Net Income", "Net Income Common Stockholders")
    a_rev_row = _row_first(a_is, "Total Revenue")

    def _annual_list(row, n=5):
        if row is None:
            return None
        vals = row.values[:n].tolist()
        return [None if (v is None or (isinstance(v, float) and np.isnan(v))) else float(v) for v in vals]

    eps_y = _annual_list(a_eps_row, 5)  # newest first
    ni_y = _annual_list(a_ni_row, 5)
    rev_y = _annual_list(a_rev_row, 5)

    if eps_y and len(eps_y) >= 2 and eps_y[0] is not None and eps_y[1] not in (None, 0):
        out["annual_eps_yoy"] = round((eps_y[0] / abs(eps_y[1]) - 1) * 100, 2)

    # H4: 3-year Net Income CAGR (year[-1] vs year[-3])
    if ni_y and len(ni_y) >= 4 and ni_y[0] is not None and ni_y[3] not in (None, 0):
        cur, base = ni_y[0], ni_y[3]
        if base > 0 and cur > 0:
            out["ni_cagr_3y"] = round(((cur / base) ** (1 / 3) - 1) * 100, 2)

    # H3: TTM net margin = 5-year high?
    # TTM net margin proxy: most recent annual net_income / revenue compared with 5y series.
    if ni_y and rev_y and len(ni_y) >= 1 and len(rev_y) >= 1:
        margins = []
        for ni, rv in zip(ni_y, rev_y):
            if ni is None or rv in (None, 0):
                margins.append(None)
            else:
                margins.append(ni / rv * 100)
        if margins[0] is not None:
            prior = [m for m in margins[1:] if m is not None]
            if prior:
                out["net_margin_5y_high"] = bool(margins[0] >= max(prior))

    # H2: CFPS / EPS ratio (using TTM Free Cash Flow per share / TTM EPS)
    a_fcf_row = _row_first(a_cf, "Free Cash Flow")
    fcf_y = _annual_list(a_fcf_row, 5) if a_fcf_row is not None else None
    if fcf_y and eps_y and fcf_y[0] is not None and eps_y[0] not in (None, 0):
        try:
            shares = t.info.get("sharesOutstanding")
            if shares and shares > 0:
                cfps = fcf_y[0] / shares
                if abs(eps_y[0]) > 0:
                    out["cfps_to_eps"] = round(cfps / eps_y[0], 3)
        except Exception:
            pass

    return out


# Cache for benchmark (^IXIC NASDAQ Composite) returns — fetched once per run.
_BENCH_RETURNS_CACHE: dict[str, dict] = {}


def _bench_returns_cached() -> dict | None:
    """Return {ret_1m, ret_6m, ret_1y} for ^IXIC. Cached at module level for one run."""
    if "ixic" in _BENCH_RETURNS_CACHE:
        return _BENCH_RETURNS_CACHE["ixic"]
    try:
        bdf = yf.download("^IXIC", period="2y", interval="1d",
                          auto_adjust=True, progress=False)
        if isinstance(bdf.columns, pd.MultiIndex):
            bdf.columns = [c[0] for c in bdf.columns]
        if bdf is None or bdf.empty or "Close" not in bdf.columns:
            _BENCH_RETURNS_CACHE["ixic"] = None
            return None
        c = bdf["Close"].dropna().values
        result = {}
        for label, days in [("ret_1m", 21), ("ret_6m", 126), ("ret_1y", 252)]:
            if len(c) > days:
                result[label] = (c[-1] / c[-1 - days] - 1) * 100
            else:
                result[label] = None
        _BENCH_RETURNS_CACHE["ixic"] = result
        return result
    except Exception:
        _BENCH_RETURNS_CACHE["ixic"] = None
        return None


def _outperform_metrics(close: pd.Series) -> dict:
    """F1/F2/F3: stock return - NASDAQ return for 1Y / 6M / 1M."""
    out: dict = {}
    if close is None or len(close) < 252:
        return out
    bench = _bench_returns_cached()
    if not bench:
        return out
    c = close.dropna().values
    for label_stock, label_bench, days in [
        ("outperform_1m", "ret_1m", 21),
        ("outperform_6m", "ret_6m", 126),
        ("outperform_1y", "ret_1y", 252),
    ]:
        if len(c) > days and bench.get(label_bench) is not None:
            stock_ret = (c[-1] / c[-1 - days] - 1) * 100
            out[label_stock] = round(stock_ret - bench[label_bench], 2)
    return out


def fetch_fundamentals_us(
    tickers: list[str],
    ohlcv: dict[str, pd.DataFrame] | None = None,
    delay: float = 1.0,
) -> dict[str, dict]:
    """
    Fetch fundamentals via yfinance for US tickers (post-RS subset only).

    Builds:
      - info-based: earningsQuarterlyGrowth, revenueGrowth, returnOnEquity,
                    heldPercentInstitutions, shortPercentOfFloat
      - quarterly/annual computed: eps_yoy_4q, revenue_yoy_4q, op_income_yoy_4q,
                                   operating_income_4q, eps_breakout,
                                   annual_eps_yoy, ni_cagr_3y, net_margin_5y_high,
                                   cfps_to_eps
      - outperform: outperform_1m / 6m / 1y vs NASDAQ (^IXIC)

    Sequential with delay to avoid rate limit.
    """
    out: dict[str, dict] = {}
    import time as _t
    for i, t in enumerate(tickers):
        if i > 0:
            _t.sleep(delay)
        try:
            ticker_obj = yf.Ticker(t)
            info = ticker_obj.info or {}
            d: dict = {
                "earningsQuarterlyGrowth": info.get("earningsQuarterlyGrowth"),
                "revenueGrowth": info.get("revenueGrowth"),
                "heldPercentInstitutions": info.get("heldPercentInstitutions"),
                "returnOnEquity": info.get("returnOnEquity"),
                "shortPercentOfFloat": info.get("shortPercentOfFloat"),
            }
            try:
                d.update(_compute_quarterly_metrics(ticker_obj))
            except Exception as e:
                print(f"    [fund {t}] qtrly metrics failed: {e}")
            if ohlcv is not None and t in ohlcv:
                close = ohlcv[t]["Close"] if "Close" in ohlcv[t].columns else None
                if close is not None:
                    try:
                        d.update(_outperform_metrics(close))
                    except Exception as e:
                        print(f"    [fund {t}] outperform failed: {e}")
            out[t] = d
        except Exception as e:
            print(f"  [fund {t}] failed: {e}")
            out[t] = {}
    return out


def rules_to_dict(rules: dict[str, RuleResult]) -> dict:
    """Serialize rules dict for JSON output."""
    return {k: asdict(v) for k, v in rules.items()}


def count_rules_passed(rules: dict[str, RuleResult]) -> tuple[int, int]:
    """Returns (passed_count, total_evaluated)."""
    total = len(rules)
    passed = sum(1 for r in rules.values() if r.passed)
    return passed, total


def _find_swings(
    closes: np.ndarray,
    highs: np.ndarray,
    lows: np.ndarray,
    prominence_pct: float = 0.03,
    distance: int = 5,
):
    h_idx, _ = find_peaks(
        highs, distance=distance, prominence=highs.mean() * prominence_pct
    )
    l_idx, _ = find_peaks(
        -lows, distance=distance, prominence=lows.mean() * prominence_pct
    )
    return h_idx, l_idx


def _idx_to_datestr(df_index, i: int) -> str:
    """Convert a positional index in df.index to YYYY-MM-DD string. Returns '' on failure."""
    try:
        ts = df_index[i]
        if hasattr(ts, "strftime"):
            return ts.strftime("%Y-%m-%d")
        return str(ts)[:10]
    except (IndexError, AttributeError):
        return ""


def _detect_shakeouts(
    df: pd.DataFrame,
    base_start_pos: int,
    base_support: float,
    breach_pct: float = 0.03,
    recover_window: int = 5,
) -> list[str]:
    """
    Shakeout = low briefly breaches the base support level (by `breach_pct`),
    then closes back above support within `recover_window` bars.

    Returns list of YYYY-MM-DD strings (one per shakeout event).
    """
    if base_support <= 0 or np.isnan(base_support):
        return []
    threshold = base_support * (1.0 - breach_pct)
    out: list[str] = []
    lows = df["Low"].values
    closes = df["Close"].values
    n = len(df)
    i = base_start_pos
    while i < n:
        if lows[i] < threshold:
            # Look ahead for recovery (close back above support)
            recovered = False
            end_recover = min(n, i + recover_window + 1)
            for j in range(i + 1, end_recover):
                if closes[j] > base_support:
                    recovered = True
                    break
            if recovered:
                out.append(_idx_to_datestr(df.index, i))
                # Skip past recover window to avoid double-counting
                i = end_recover
                continue
        i += 1
    return out


def _detect_dryup_ranges(
    df: pd.DataFrame,
    base_start_pos: int,
    short_window: int = 5,
    long_window: int = 50,
    threshold: float = 0.7,
    min_run: int = 3,
) -> list[dict]:
    """
    Volume dry-up = `short_window`-day avg < `long_window`-day SMA × threshold,
    sustained for at least `min_run` consecutive bars.

    Returns list of {"start": "YYYY-MM-DD", "end": "YYYY-MM-DD"}.
    """
    vols = df["Volume"].values
    n = len(vols)
    if n < long_window + short_window:
        return []
    short_avg = pd.Series(vols).rolling(short_window).mean().values
    long_avg = pd.Series(vols).rolling(long_window).mean().values

    flags = np.zeros(n, dtype=bool)
    for i in range(base_start_pos, n):
        if np.isnan(short_avg[i]) or np.isnan(long_avg[i]) or long_avg[i] <= 0:
            continue
        if short_avg[i] < long_avg[i] * threshold:
            flags[i] = True

    ranges: list[dict] = []
    i = base_start_pos
    while i < n:
        if flags[i]:
            j = i
            while j + 1 < n and flags[j + 1]:
                j += 1
            run_len = j - i + 1
            if run_len >= min_run:
                ranges.append({
                    "start": _idx_to_datestr(df.index, i),
                    "end": _idx_to_datestr(df.index, j),
                })
            i = j + 1
        else:
            i += 1
    return ranges


def detect_vcp(ticker: str, df: pd.DataFrame, lookback: int = 90) -> VCPResult:
    empty = VCPResult(
        ticker, False, 0, "Unknown", 0, [], np.nan, 0, np.nan, np.nan, np.nan, np.nan, np.nan, 0.0, 0.0
    )
    if len(df) < lookback + 5:
        return empty
    base = df.iloc[-lookback:].copy()
    highs = base["High"].values
    lows = base["Low"].values
    closes = base["Close"].values
    vols = base["Volume"].values

    # Position in the full df where base starts (used for shakeout/dryup detection)
    base_start_pos = len(df) - lookback

    h_idx, l_idx = _find_swings(closes, highs, lows)
    if len(h_idx) < 2 or len(l_idx) < 1:
        return empty

    events = sorted(
        [(i, "H", highs[i]) for i in h_idx] + [(i, "L", lows[i]) for i in l_idx]
    )
    pairs: list[tuple[int, float, int, float]] = []
    last_peak_idx: int | None = None
    last_peak_val: float | None = None
    for idx, kind, val in events:
        if kind == "H":
            last_peak_idx = idx
            last_peak_val = val
        elif kind == "L" and last_peak_val is not None:
            depth = (last_peak_val - val) / last_peak_val
            if depth > 0.005:
                pairs.append((last_peak_idx, last_peak_val, idx, val))
            last_peak_idx = None
            last_peak_val = None

    if len(pairs) < 2:
        return empty

    recent_pairs = pairs[-6:]
    recent = [(p[1] - p[3]) / p[1] for p in recent_pairs]
    n = len(recent)

    tightening = all(recent[i] <= recent[i - 1] * 1.0 for i in range(1, n))
    last_pct = recent[-1] * 100

    base_peaks = [p[1] for p in recent_pairs]
    if last_peak_val is not None:
        base_peaks.append(last_peak_val)
    pivot_price = float(max(base_peaks))
    current_price = float(closes[-1])
    pct_to_pivot = (current_price / pivot_price - 1.0) * 100

    # Volume dry-up: recent 5-day avg vs 50-day SMA of volume, computed
    # on the full df (not just the base window) so the denominator excludes
    # the dry-up period itself. Community consensus: final contraction
    # should show volume 40-60% below the 50-day average (ratio 0.4-0.6).
    all_vols = df["Volume"].values
    avg_recent_vol = float(all_vols[-5:].mean())
    sma50_vol = float(all_vols[-50:].mean()) if len(all_vols) >= 50 else float(all_vols.mean())
    vol_ratio = avg_recent_vol / sma50_vol if sma50_vol > 0 else np.nan

    # Base depth = deepest contraction in the VCP sequence.
    # Minervini: ideal 12-20%, good <35%. Deeper = structurally damaged.
    base_depth_pct = max(recent) * 100 if recent else np.nan

    # Stage Analysis (Weinstein)
    stage_info = determine_stage(df)
    stage = stage_info["stage"]
    stage_name = stage_info["stage_name"]

    # ----- Visualization metadata -----
    # Contraction ranges: each (high_idx, high_val, low_idx, low_val) tuple from recent_pairs
    # is a peak→trough leg. We build {start, end, high, low, depth_pct}.
    # base.index gives positional dates within the base window (h_idx/l_idx are
    # positions inside `base`), so we map via base.index directly.
    contraction_ranges: list[dict] = []
    for (h_pos, h_val, l_pos, l_val) in recent_pairs:
        depth_pct = (h_val - l_val) / h_val * 100 if h_val > 0 else 0
        contraction_ranges.append({
            "start": _idx_to_datestr(base.index, h_pos),
            "end": _idx_to_datestr(base.index, l_pos),
            "high": round(float(h_val), 2),
            "low": round(float(l_val), 2),
            "depth_pct": round(float(depth_pct), 2),
        })

    # Pivot date = position of the swing high that defined pivot_price.
    pivot_date = ""
    pivot_pos_in_base: int | None = None
    # Find which peak in recent_pairs (or last_peak_val) matches pivot_price.
    for (h_pos, h_val, _l_pos, _l_val) in recent_pairs:
        if abs(float(h_val) - pivot_price) < 1e-6:
            pivot_pos_in_base = h_pos
            pivot_date = _idx_to_datestr(base.index, h_pos)
            break
    if not pivot_date and last_peak_idx is not None and last_peak_val is not None:
        if abs(float(last_peak_val) - pivot_price) < 1e-6:
            pivot_pos_in_base = last_peak_idx
            pivot_date = _idx_to_datestr(base.index, last_peak_idx)

    # Base support level for shakeout detection = min low across recent contractions.
    base_support = float(min(p[3] for p in recent_pairs))

    shakeout_dates = _detect_shakeouts(df, base_start_pos, base_support)
    dryup_ranges = _detect_dryup_ranges(df, base_start_pos)

    # Detection requires: VCP pattern criteria + Stage 2
    t1_depth_pct = recent[0] * 100 if n >= 1 else 0.0
    detected = (
        tightening
        and n >= 2
        and t1_depth_pct >= 8.0
        and last_pct < 12.0
        and vol_ratio < 0.7
        and pct_to_pivot > -12.0
        and (base_depth_pct == base_depth_pct and base_depth_pct <= 35.0)
        and stage == 2
    )

    # VCP quality sub-score (0-20): pattern strength independent of fundamentals
    vcp_q = 0.0
    if tightening and n >= 2:
        vcp_q += 4                                          # base
        vcp_q += min(4, n * 1)                              # more contractions
        vcp_q += max(0, 5 - last_pct * 0.4)                 # tighter last contraction
        if last_pct <= 6.0:                                 # Minervini sweet-spot bonus
            vcp_q += 2
        vcp_q += max(0, 3 - vol_ratio * 3)                  # volume dry-up
        vcp_q += max(0, 2 - max(0, base_depth_pct - 15) * 0.08) if base_depth_pct == base_depth_pct else 0
        vcp_q += max(0, 2 + pct_to_pivot * 0.2)             # pivot proximity
        vcp_q = float(min(20, max(0, vcp_q)))

    return VCPResult(
        ticker=ticker,
        detected=detected,
        stage=stage,
        stage_name=stage_name,
        num_contractions=n,
        contractions=[round(c * 100, 2) for c in recent],
        last_contraction_pct=round(last_pct, 2),
        base_days=lookback,
        base_depth_pct=round(base_depth_pct, 2) if base_depth_pct == base_depth_pct else np.nan,
        pivot_price=round(pivot_price, 2),
        current_price=round(current_price, 2),
        pct_to_pivot=round(pct_to_pivot, 2),
        volume_dryup_ratio=round(vol_ratio, 2),
        vcp_quality=round(vcp_q, 1),
        score=0.0,  # set by pipeline via compute_composite_score
        contraction_ranges=contraction_ranges,
        pivot_date=pivot_date or None,
        shakeout_dates=shakeout_dates,
        dryup_ranges=dryup_ranges,
    )


# =============================================================================
# Per-market pipelines
# =============================================================================


def _run_market_us(cfg: dict, min_rs: int, vcp_only: bool) -> list[dict]:
    """US pipeline using Finviz prefilter."""
    exchanges = cfg.get("exchanges", ["NASDAQ", "NYSE"])

    print("  [US 1/5] Finviz Trend Template prefilter...")
    pf = fetch_us_prefilter(exchanges)
    if pf.empty:
        print("  [US] Finviz returned no rows.")
        return []
    tt_tickers = pf["Ticker"].tolist()
    print(f"          {len(tt_tickers)} passed Trend Template")

    print("  [US 2/5] Broad universe (RS denominator)...")
    broad = fetch_us_broad(exchanges)
    if not broad:
        broad = tt_tickers
    universe = sorted(set(broad) | set(tt_tickers))
    print(f"          {len(universe)} in RS universe")

    print("  [US 3/5] Downloading 2y OHLCV...")
    ohlcv = fetch_ohlcv(universe, period="2y")
    print(f"          {len(ohlcv)} with history")

    print("  [US 4/5] RS Rating...")
    rs = compute_rs_scores(ohlcv)
    survivors = [t for t in tt_tickers if t in rs.index and rs[t] >= min_rs]
    print(f"          {len(survivors)} survivors RS >= {min_rs} (N={len(rs)})")

    cfg_global = load_config()
    max_drop = cfg_global.get("max_single_day_drop_pct", 10.0)
    lookback = cfg_global.get("drawdown_lookback_days", 5)
    if max_drop > 0:
        before = len(survivors)
        survivors = [
            t for t in survivors
            if t in ohlcv and passes_drawdown_filter(ohlcv[t], max_drop, lookback)
        ]
        print(f"          {len(survivors)} after drawdown filter (-{max_drop}% in last {lookback}d, dropped {before - len(survivors)})")

    print("  [US 5/7] Downloading benchmark (SPY)...")
    bench = fetch_benchmark("US")

    print(f"  [US 6/7] Fetching fundamentals for {len(survivors)} survivors...")
    fundamentals = fetch_fundamentals_us(survivors, ohlcv=ohlcv, delay=1.0)

    print("  [US 7/7] VCP detection + Rule eval + Composite Score...")
    rows: list[dict] = []
    for t in survivors:
        if t not in ohlcv:
            continue
        r = detect_vcp(t, ohlcv[t])
        if vcp_only and not r.detected:
            continue
        d = asdict(r)
        d["rs_rating"] = int(rs[t])
        d["market"] = "US"
        # RS Line
        rs_line_pct = np.nan
        if bench is not None:
            rs_line_pct = compute_rs_line_pct(ohlcv[t]["Close"], bench)
        d["rs_line_pct_from_high"] = (
            round(rs_line_pct, 2) if rs_line_pct == rs_line_pct else None
        )
        # 52W high position
        close_series = ohlcv[t]["Close"]
        high52 = float(close_series.iloc[-252:].max()) if len(close_series) >= 252 else float(close_series.max())
        pct_from_52w = (float(close_series.iloc[-1]) / high52 - 1.0) * 100
        # MA alignment
        ma_align = compute_ma_alignment(ohlcv[t])
        # Composite score
        stage_info = determine_stage(ohlcv[t])
        d["score"] = compute_composite_score(
            rs_rating=int(rs[t]),
            stage=stage_info["stage"],
            stage_confidence=stage_info["confidence"],
            vcp_quality=r.vcp_quality,
            ma_alignment=ma_align,
            pct_from_52w_high=pct_from_52w,
            rs_line_pct=rs_line_pct,
        )
        # Rule evaluation (CANSLIM-style soft ranking)
        rules = evaluate_rules(
            ohlcv[t], int(rs[t]), "US",
            vcp=r, fundamentals=fundamentals.get(t, {}),
            stage=stage_info["stage"],
        )
        passed, total = count_rules_passed(rules)
        d["rules"] = rules_to_dict(rules)
        d["rules_passed"] = passed
        d["rules_total"] = total
        meta = pf[pf["Ticker"] == t]
        if not meta.empty:
            m = meta.iloc[0]
            d["company"] = str(m.get("Company", ""))
            d["sector"] = str(m.get("Sector", ""))
            d["industry"] = str(m.get("Industry", ""))
        else:
            d["company"] = d["sector"] = d["industry"] = ""
        rows.append(d)
    return rows


def _run_market_intl(
    market_key: str,
    universe_tickers: list[str],
    names: dict[str, str],
    min_rs: int,
    vcp_only: bool,
) -> list[dict]:
    """Generic pipeline for non-US markets (HK, KR)."""
    if not universe_tickers:
        print(f"  [{market_key}] No tickers.")
        return []

    print(f"  [{market_key} 1/4] Downloading 2y OHLCV ({len(universe_tickers)} tickers)...")
    ohlcv = fetch_ohlcv(universe_tickers, period="2y")
    print(f"          {len(ohlcv)} with history")

    print(f"  [{market_key} 2/4] Trend Template filter (Python)...")
    tt_tickers = [t for t in ohlcv if passes_trend_template(ohlcv[t])]
    print(f"          {len(tt_tickers)} passed Trend Template")

    print(f"  [{market_key} 3/4] RS Rating...")
    rs = compute_rs_scores(ohlcv)
    survivors = [t for t in tt_tickers if t in rs.index and rs[t] >= min_rs]
    print(f"          {len(survivors)} survivors RS >= {min_rs} (N={len(rs)})")

    cfg_global = load_config()
    max_drop = cfg_global.get("max_single_day_drop_pct", 10.0)
    lookback = cfg_global.get("drawdown_lookback_days", 5)
    if max_drop > 0:
        before = len(survivors)
        survivors = [
            t for t in survivors
            if t in ohlcv and passes_drawdown_filter(ohlcv[t], max_drop, lookback)
        ]
        print(f"          {len(survivors)} after drawdown filter (-{max_drop}% in last {lookback}d, dropped {before - len(survivors)})")

    print(f"  [{market_key} 4/5] Downloading benchmark ({BENCHMARK_TICKERS.get(market_key, '?')})...")
    bench = fetch_benchmark(market_key)

    print(f"  [{market_key} 5/5] VCP detection + Stage + Composite Score...")
    rows: list[dict] = []
    for t in survivors:
        if t not in ohlcv:
            continue
        r = detect_vcp(t, ohlcv[t])
        if vcp_only and not r.detected:
            continue
        d = asdict(r)
        d["rs_rating"] = int(rs[t])
        d["market"] = market_key
        rs_line_pct = np.nan
        if bench is not None:
            rs_line_pct = compute_rs_line_pct(ohlcv[t]["Close"], bench)
        d["rs_line_pct_from_high"] = (
            round(rs_line_pct, 2) if rs_line_pct == rs_line_pct else None
        )
        close_series = ohlcv[t]["Close"]
        high52 = float(close_series.iloc[-252:].max()) if len(close_series) >= 252 else float(close_series.max())
        pct_from_52w = (float(close_series.iloc[-1]) / high52 - 1.0) * 100
        ma_align = compute_ma_alignment(ohlcv[t])
        stage_info = determine_stage(ohlcv[t])
        d["score"] = compute_composite_score(
            rs_rating=int(rs[t]),
            stage=stage_info["stage"],
            stage_confidence=stage_info["confidence"],
            vcp_quality=r.vcp_quality,
            ma_alignment=ma_align,
            pct_from_52w_high=pct_from_52w,
            rs_line_pct=rs_line_pct,
        )
        # Rule evaluation (no fundamentals for non-US)
        rules = evaluate_rules(
            ohlcv[t], int(rs[t]), market_key, vcp=r, fundamentals=None,
            stage=stage_info["stage"],
        )
        passed, total = count_rules_passed(rules)
        d["rules"] = rules_to_dict(rules)
        d["rules_passed"] = passed
        d["rules_total"] = total
        d["company"] = names.get(t, "")
        d["sector"] = ""
        d["industry"] = ""
        rows.append(d)
    return rows


# =============================================================================
# Multi-market pipeline
# =============================================================================


def run_screener(
    min_rs: int | None = None, vcp_only: bool = True
) -> tuple[pd.DataFrame, dict]:
    """
    Multi-market pipeline. Reads config.json for market selection.

    Returns (results_df, market_meta) where market_meta =
      {market: {"direction_rules": {...}, "direction_passed": int, "direction_total": int}}
    """
    config = load_config()
    if min_rs is None:
        min_rs = config.get("min_rs", 70)
    markets = config.get("markets", DEFAULT_CONFIG["markets"])
    all_rows: list[dict] = []
    market_meta: dict = {}

    def _add_direction(mkt: str):
        bench = fetch_benchmark(mkt)
        dir_rules = evaluate_market_direction(bench)
        passed = sum(1 for r in dir_rules.values() if r.passed)
        market_meta[mkt] = {
            "direction_rules": rules_to_dict(dir_rules),
            "direction_passed": passed,
            "direction_total": len(dir_rules),
        }

    # ---- US ----
    us_cfg = markets.get("US", {})
    if us_cfg.get("enabled", False):
        print(f"\n{'='*50}")
        print("  MARKET: US")
        print(f"{'='*50}")
        rows = _run_market_us(us_cfg, min_rs, vcp_only)
        detected = sum(1 for r in rows if r.get("detected"))
        print(f"  [US] {detected} VCP detected / {len(rows)} total")
        all_rows.extend(rows)
        _add_direction("US")

    # ---- HK ----
    hk_cfg = markets.get("HK", {})
    if hk_cfg.get("enabled", False):
        print(f"\n{'='*50}")
        print("  MARKET: HK (Hang Seng)")
        print(f"{'='*50}")
        hk_tickers, hk_names = fetch_hk_universe()
        print(f"  [HK] {len(hk_tickers)} HSI constituents")
        rows = _run_market_intl("HK", hk_tickers, hk_names, min_rs, vcp_only)
        detected = sum(1 for r in rows if r.get("detected"))
        print(f"  [HK] {detected} VCP detected / {len(rows)} total")
        all_rows.extend(rows)
        _add_direction("HK")

    # ---- KR ----
    kr_cfg = markets.get("KR", {})
    if kr_cfg.get("enabled", False):
        print(f"\n{'='*50}")
        print("  MARKET: KR (KOSPI/KOSDAQ)")
        print(f"{'='*50}")
        indices = kr_cfg.get("indices", ["KOSPI", "KOSDAQ"])
        kr_tickers, kr_names = fetch_kr_universe(indices)
        print(f"  [KR] {len(kr_tickers)} tickers from {indices}")
        rows = _run_market_intl("KR", kr_tickers, kr_names, min_rs, vcp_only)
        detected = sum(1 for r in rows if r.get("detected"))
        print(f"  [KR] {detected} VCP detected / {len(rows)} total")
        all_rows.extend(rows)
        _add_direction("KR")

    if not all_rows:
        return pd.DataFrame(), market_meta
    df = (
        pd.DataFrame(all_rows)
        .sort_values(["rules_passed", "score"], ascending=[False, False])
        .reset_index(drop=True)
    )
    return df, market_meta


if __name__ == "__main__":
    result, _ = run_screener(vcp_only=True)
    print(f"\n=== {len(result)} VCP candidates ===")
    if not result.empty:
        cols = [
            "market", "ticker", "company", "score", "rs_rating",
            "num_contractions", "last_contraction_pct",
            "base_depth_pct", "pct_to_pivot", "volume_dryup_ratio",
        ]
        print(result[[c for c in cols if c in result.columns]].to_string())

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


def evaluate_rules(
    df: pd.DataFrame,
    rs_rating: int,
    market: str,
    vcp: VCPResult | None = None,
    fundamentals: dict | None = None,
) -> dict[str, RuleResult]:
    """
    Compute all per-stock pass/fail rules. Returns dict of rule_id -> RuleResult.

    Rule pool:
      Trend (4): T1-T4
      Momentum (2): M1-M2
      Relative Strength (2): R1-R2
      Volatility/Liquidity (2): V1-V2
      VCP Pattern (3): P1-P3
      Fundamentals (3, US only): F1-F3
    """
    rules: dict[str, RuleResult] = {}
    close = df["Close"]

    # ---- Trend (MA cascade + 200d slope) ----
    if len(close) >= 200:
        sma20 = float(close.rolling(20).mean().iloc[-1])
        sma50 = float(close.rolling(50).mean().iloc[-1])
        sma150 = float(close.rolling(150).mean().iloc[-1])
        sma200_series = close.rolling(200).mean()
        sma200 = float(sma200_series.iloc[-1])
        if not any(np.isnan(x) for x in (sma20, sma50, sma150, sma200)):
            rules["T1_sma50_gt_sma150"] = RuleResult(
                "SMA50 > SMA150", sma50 > sma150,
                round(sma50 / sma150, 4) if sma150 else None, 1.0)
            rules["T2_sma150_gt_sma200"] = RuleResult(
                "SMA150 > SMA200", sma150 > sma200,
                round(sma150 / sma200, 4) if sma200 else None, 1.0)
            rules["T3_sma20_gt_sma50"] = RuleResult(
                "SMA20 > SMA50", sma20 > sma50,
                round(sma20 / sma50, 4) if sma50 else None, 1.0)
            all_rising, rising_days = _consecutive_rising(sma200_series.values, days=21)
            rules["T4_sma200_rising_21d"] = RuleResult(
                "200d SMA rising 21 days", all_rising,
                float(rising_days), 20.0)

    # ---- Momentum ----
    if len(close) >= 252:
        p = float(close.iloc[-1])
        high52 = float(close.iloc[-252:].max())
        pct_below = (p / high52 - 1.0) * 100
        rules["M1_near_52w_high"] = RuleResult(
            "Within 10% of 52W high", pct_below >= -10.0,
            round(pct_below, 2), -10.0)
    if len(close) >= 64:
        p = float(close.iloc[-1])
        q_ago = float(close.iloc[-64])
        if q_ago > 0:
            qperf = (p / q_ago - 1.0) * 100
            rules["M2_quarter_positive"] = RuleResult(
                "Quarter perf > 0", qperf > 0, round(qperf, 2), 0.0)

    # ---- Relative Strength ----
    rules["R1_rs_70"] = RuleResult(
        "RS Rating ≥ 70", rs_rating >= 70, float(rs_rating), 70.0)
    rules["R2_rs_90"] = RuleResult(
        "RS Rating ≥ 90", rs_rating >= 90, float(rs_rating), 90.0)

    # ---- Volatility (52W span) ----
    if len(close) >= 252:
        h = float(close.iloc[-252:].max())
        l = float(close.iloc[-252:].min())
        if l > 0:
            passed = 0.75 * h > 1.25 * l
            ratio = (0.75 * h) / (1.25 * l)
            rules["V1_52w_span"] = RuleResult(
                "52W span (0.75H > 1.25L)", passed, round(ratio, 3), 1.0)

    # ---- Liquidity ----
    if len(df) >= 50:
        sma50_price = float(close.iloc[-50:].mean())
        sma50_vol = float(df["Volume"].iloc[-50:].mean())
        dollar_vol = sma50_price * sma50_vol
        threshold = LIQUIDITY_THRESHOLDS.get(market, 20_000_000)
        rules["V2_liquidity"] = RuleResult(
            "Daily $ volume ≥ market threshold",
            dollar_vol >= threshold,
            round(dollar_vol, 0), float(threshold))

    # ---- VCP Pattern (from VCPResult) ----
    if vcp is not None:
        recent = vcp.contractions
        is_tightening = (
            len(recent) >= 2 and
            all(recent[i] <= recent[i - 1] * 1.10 for i in range(1, len(recent)))
        )
        rules["P1_tightening"] = RuleResult(
            "Progressive tightening (n≥2)", is_tightening,
            float(len(recent)), 2.0)

        last_c = vcp.last_contraction_pct
        last_c_passed = (last_c == last_c) and (last_c < 10.0)
        rules["P2_last_contraction"] = RuleResult(
            "Last contraction < 10%", last_c_passed,
            round(last_c, 2) if last_c == last_c else None, 10.0)

        vr = vcp.volume_dryup_ratio
        vr_passed = (vr == vr) and (vr < 0.6)
        rules["P3_vol_dryup"] = RuleResult(
            "Volume dry-up < 0.6× SMA50", vr_passed,
            round(vr, 3) if vr == vr else None, 0.6)

    # ---- Fundamentals (US only; N/A for HK/KR) ----
    if market == "US" and fundamentals:
        eps_g = fundamentals.get("earningsQuarterlyGrowth")
        rev_g = fundamentals.get("revenueGrowth")
        inst = fundamentals.get("heldPercentInstitutions")
        if eps_g is not None:
            rules["F1_eps_growth"] = RuleResult(
                "EPS QoQ YoY > 18%", eps_g > 0.18,
                round(eps_g * 100, 2), 18.0)
        if rev_g is not None:
            rules["F2_rev_growth"] = RuleResult(
                "Sales YoY > 25%", rev_g > 0.25,
                round(rev_g * 100, 2), 25.0)
        if inst is not None:
            rules["F3_inst_ownership"] = RuleResult(
                "Institutional own. ≥ 5%", inst >= 0.05,
                round(inst * 100, 2), 5.0)

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
    all_rising, rising_days = _consecutive_rising(sma50_series.values, days=21)
    rules["MD2_idx_sma50_rising_21d"] = RuleResult(
        "Index 50d SMA rising 21d", all_rising,
        float(rising_days), 20.0)
    return rules


def fetch_fundamentals_us(tickers: list[str], delay: float = 1.0) -> dict[str, dict]:
    """
    Fetch fundamentals via yfinance .info for US tickers (post-RS subset only).
    Sequential with delay to avoid rate limit. Returns {ticker: {eps_g, rev_g, inst}}.
    """
    out: dict[str, dict] = {}
    import time as _t
    for i, t in enumerate(tickers):
        if i > 0:
            _t.sleep(delay)
        try:
            info = yf.Ticker(t).info or {}
            out[t] = {
                "earningsQuarterlyGrowth": info.get("earningsQuarterlyGrowth"),
                "revenueGrowth": info.get("revenueGrowth"),
                "heldPercentInstitutions": info.get("heldPercentInstitutions"),
            }
        except Exception:
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

    tightening = all(recent[i] <= recent[i - 1] * 1.10 for i in range(1, n))
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

    # Detection requires: VCP pattern criteria + Stage 2
    detected = (
        tightening
        and n >= 2
        and last_pct < 10.0
        and vol_ratio < 0.6
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

    print("  [US 5/7] Downloading benchmark (SPY)...")
    bench = fetch_benchmark("US")

    print(f"  [US 6/7] Fetching fundamentals for {len(survivors)} survivors...")
    fundamentals = fetch_fundamentals_us(survivors, delay=1.0)

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

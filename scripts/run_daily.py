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
    compute_composite_v2_from_row,
)
import pandas as pd  # noqa: E402

import numpy as np  # noqa: E402
import yfinance as yf  # noqa: E402

DATA_DIR = ROOT / "web" / "public" / "data"
CHARTS_DIR = DATA_DIR / "charts"
FIN_DIR = DATA_DIR / "financials"
SNAPSHOT_DIR = DATA_DIR / "score_snapshots"
HISTORY_PATH = DATA_DIR / "detection_history.json"
DATA_DIR.mkdir(parents=True, exist_ok=True)
CHARTS_DIR.mkdir(parents=True, exist_ok=True)
FIN_DIR.mkdir(parents=True, exist_ok=True)
SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)

TOP_CHART_N = 50


# =============================================================================
# Financial data collection (IS/BS/CF + CANSLIM metrics)
# =============================================================================

def _safe(v) -> float | None:
    """Convert numpy/pandas value to JSON-safe float or None."""
    if v is None:
        return None
    try:
        f = float(v)
        return None if (np.isnan(f) or np.isinf(f)) else round(f, 2)
    except (ValueError, TypeError):
        return None


def _extract_row(df, row_name, periods: int = 5) -> list[float | None]:
    """Extract a row from yfinance financials DataFrame, up to `periods` columns."""
    if df is None or df.empty or row_name not in df.index:
        return [None] * periods
    vals = df.loc[row_name].values[:periods]
    return [_safe(v) for v in vals]


def _period_labels(df, periods: int = 5) -> list[str]:
    """Get date labels from yfinance financials DataFrame columns."""
    if df is None or df.empty:
        return [""] * periods
    return [c.strftime("%Y-%m-%d") if hasattr(c, "strftime") else str(c) for c in df.columns[:periods]]


def _ratio(num: float | None, den: float | None, pct: bool = False, ndigits: int = 2) -> float | None:
    """Safely divide num/den. Returns None on missing/zero. If pct=True, multiply by 100."""
    if num is None or den is None:
        return None
    try:
        if den == 0:
            return None
        r = num / den
        if pct:
            r *= 100
        return round(r, ndigits)
    except (ValueError, TypeError, ZeroDivisionError):
        return None


def _yoy_growth(vals: list[float | None], lag: int = 4) -> list[float | None]:
    """YoY growth: vals[i] vs vals[i+lag]. yfinance order is newest-first."""
    out: list[float | None] = []
    n = len(vals)
    for i in range(n):
        if i + lag < n and vals[i] is not None and vals[i + lag] is not None and vals[i + lag] != 0:
            try:
                out.append(round((vals[i] / vals[i + lag] - 1) * 100, 1))
            except (ValueError, TypeError, ZeroDivisionError):
                out.append(None)
        else:
            out.append(None)
    return out


def _compute_dividend_yield_series(t, periods: list[str], freq: str = "Q") -> list[float | None]:
    """
    For each period label (date string), compute dividend yield as:
       (sum of dividends paid in that period) / (avg close price in that period) * 100

    freq:
      "Q" — quarterly periods (3 months ending at period date)
      "A" — annual periods (12 months ending at period date)

    Returns list aligned with periods (same length, None where no data).
    """
    n = len(periods)
    out: list[float | None] = [None] * n
    if not periods or not any(periods):
        return out

    try:
        divs = t.dividends  # pandas Series indexed by datetime
        hist = t.history(period="6y", auto_adjust=False)
    except Exception:
        return out

    if hist is None or hist.empty:
        return out
    if divs is None or len(divs) == 0:
        return out

    # Strip timezone for comparison consistency
    try:
        if divs.index.tz is not None:
            divs.index = divs.index.tz_localize(None)
    except Exception:
        pass
    try:
        if hist.index.tz is not None:
            hist.index = hist.index.tz_localize(None)
    except Exception:
        pass

    months_back = 3 if freq == "Q" else 12
    for i, p in enumerate(periods):
        if not p:
            continue
        try:
            end = pd.Timestamp(p)
        except Exception:
            continue
        start = end - pd.DateOffset(months=months_back)
        try:
            div_sum = divs[(divs.index > start) & (divs.index <= end)].sum()
        except Exception:
            div_sum = 0
        try:
            mask = (hist.index > start) & (hist.index <= end)
            avg_close = hist.loc[mask, "Close"].mean()
        except Exception:
            avg_close = None
        if div_sum and avg_close and not pd.isna(avg_close) and avg_close != 0:
            try:
                # Annualize quarterly dividend (× 4) for comparability
                annual_div = float(div_sum) * (4 if freq == "Q" else 1)
                out[i] = round((annual_div / float(avg_close)) * 100, 2)
            except Exception:
                pass
        else:
            # If no dividend in the period but ticker has dividends elsewhere, leave None
            pass
    return out


def fetch_ticker_financials(ticker: str) -> dict | None:
    """
    Fetch IS/BS/CF + key metrics for a single ticker via yfinance.
    Returns a dict ready for JSON serialization, or None on failure.
    """
    try:
        t = yf.Ticker(ticker)
        info = t.info or {}
    except Exception as e:
        print(f"    [fin {ticker}] info failed: {e}")
        return None

    # Key metrics (Minervini / O'Neil focus)
    metrics = {
        "eps_ttm": _safe(info.get("trailingEps")),
        "eps_forward": _safe(info.get("forwardEps")),
        "pe_ttm": _safe(info.get("trailingPE")),
        "pe_forward": _safe(info.get("forwardPE")),
        "market_cap": _safe(info.get("marketCap")),
        "roe": _safe(info.get("returnOnEquity")),
        "roa": _safe(info.get("returnOnAssets")),
        "profit_margin": _safe(info.get("profitMargins")),
        "gross_margin": _safe(info.get("grossMargins")),
        "operating_margin": _safe(info.get("operatingMargins")),
        "revenue_growth": _safe(info.get("revenueGrowth")),
        "earnings_growth": _safe(info.get("earningsGrowth")),
        "dividend_yield": _safe(info.get("dividendYield")),
        "payout_ratio": _safe(info.get("payoutRatio")),
        "currency": info.get("currency", "USD"),
        "sector": info.get("sector", ""),
        "industry": info.get("industry", ""),
        "name": info.get("shortName") or info.get("longName", ""),
    }

    # --- Annual financials (IS / BS / CF) — 5 years ---
    try:
        ann_is = t.financials
        ann_bs = t.balance_sheet
        ann_cf = t.cashflow
    except Exception:
        ann_is = ann_bs = ann_cf = None

    a_periods = _period_labels(ann_is, 5)
    a_revenue = _extract_row(ann_is, "Total Revenue", 5)
    a_op_income = _extract_row(ann_is, "Operating Income", 5)
    a_net_income = _extract_row(ann_is, "Net Income", 5)
    a_total_assets = _extract_row(ann_bs, "Total Assets", 5)
    a_total_liab = _extract_row(ann_bs, "Total Liabilities Net Minority Interest", 5)
    a_equity = _extract_row(ann_bs, "Stockholders Equity", 5)
    a_cash = _extract_row(ann_bs, "Cash And Cash Equivalents", 5)
    a_total_debt = _extract_row(ann_bs, "Total Debt", 5)
    a_current_assets = _extract_row(ann_bs, "Current Assets", 5)
    a_current_liab = _extract_row(ann_bs, "Current Liabilities", 5)
    a_op_cf = _extract_row(ann_cf, "Operating Cash Flow", 5)
    a_capex = _extract_row(ann_cf, "Capital Expenditure", 5)
    a_free_cf = _extract_row(ann_cf, "Free Cash Flow", 5)

    # Derived: operating margin = op_income / revenue * 100
    a_op_margin = [_ratio(oi, rv, pct=True, ndigits=2) for oi, rv in zip(a_op_income, a_revenue)]
    # Derived: debt/equity, current ratio, cash ratio
    a_debt_to_equity = [_ratio(d, e) for d, e in zip(a_total_debt, a_equity)]
    a_current_ratio = [_ratio(ca, cl) for ca, cl in zip(a_current_assets, a_current_liab)]
    a_cash_ratio = [_ratio(c, cl) for c, cl in zip(a_cash, a_current_liab)]
    # Derived: ROE/ROA per period (pct)
    a_roe = [_ratio(ni, eq, pct=True, ndigits=2) for ni, eq in zip(a_net_income, a_equity)]
    a_roa = [_ratio(ni, ta, pct=True, ndigits=2) for ni, ta in zip(a_net_income, a_total_assets)]
    # Annual dividend yield series
    a_div_yield = _compute_dividend_yield_series(t, a_periods, freq="A")

    annual = {
        "periods": a_periods,
        "revenue": a_revenue,
        "gross_profit": _extract_row(ann_is, "Gross Profit", 5),
        "operating_income": a_op_income,
        "operating_margin": a_op_margin,
        "net_income": a_net_income,
        "eps": _extract_row(ann_is, "Diluted EPS", 5),
        "total_assets": a_total_assets,
        "total_liabilities": a_total_liab,
        "equity": a_equity,
        "cash": a_cash,
        "total_debt": a_total_debt,
        "current_assets": a_current_assets,
        "current_liabilities": a_current_liab,
        "debt_to_equity": a_debt_to_equity,
        "current_ratio": a_current_ratio,
        "cash_ratio": a_cash_ratio,
        "roe": a_roe,
        "roa": a_roa,
        "dividend_yield": a_div_yield,
        "operating_cf": a_op_cf,
        "capex": a_capex,
        "free_cf": a_free_cf,
    }

    # --- Quarterly financials — 12 quarters (3 years) ---
    try:
        q_is = t.quarterly_financials
        q_bs = t.quarterly_balance_sheet
        q_cf = t.quarterly_cashflow
    except Exception:
        q_is = q_bs = q_cf = None

    Q = 12
    q_periods = _period_labels(q_is, Q)
    q_revenue = _extract_row(q_is, "Total Revenue", Q)
    q_net_income = _extract_row(q_is, "Net Income", Q)
    q_eps = _extract_row(q_is, "Diluted EPS", Q)
    q_gross_profit = _extract_row(q_is, "Gross Profit", Q)
    q_op_income = _extract_row(q_is, "Operating Income", Q)

    # Quarterly BS
    q_total_debt = _extract_row(q_bs, "Total Debt", Q)
    q_equity = _extract_row(q_bs, "Stockholders Equity", Q)
    q_current_assets = _extract_row(q_bs, "Current Assets", Q)
    q_current_liab = _extract_row(q_bs, "Current Liabilities", Q)
    q_cash = _extract_row(q_bs, "Cash And Cash Equivalents", Q)
    q_total_assets = _extract_row(q_bs, "Total Assets", Q)

    # Quarterly CF
    q_op_cf = _extract_row(q_cf, "Operating Cash Flow", Q)
    q_capex = _extract_row(q_cf, "Capital Expenditure", Q)
    q_free_cf = _extract_row(q_cf, "Free Cash Flow", Q)

    # Derived ratios
    q_op_margin = [_ratio(oi, rv, pct=True, ndigits=2) for oi, rv in zip(q_op_income, q_revenue)]
    q_debt_to_equity = [_ratio(d, e) for d, e in zip(q_total_debt, q_equity)]
    q_current_ratio = [_ratio(ca, cl) for ca, cl in zip(q_current_assets, q_current_liab)]
    q_cash_ratio = [_ratio(c, cl) for c, cl in zip(q_cash, q_current_liab)]
    q_roe = [_ratio(ni, eq, pct=True, ndigits=2) for ni, eq in zip(q_net_income, q_equity)]
    q_roa = [_ratio(ni, ta, pct=True, ndigits=2) for ni, ta in zip(q_net_income, q_total_assets)]
    q_div_yield = _compute_dividend_yield_series(t, q_periods, freq="Q")

    quarterly = {
        "periods": q_periods,
        "revenue": q_revenue,
        "net_income": q_net_income,
        "eps": q_eps,
        "gross_profit": q_gross_profit,
        "operating_income": q_op_income,
        "operating_margin": q_op_margin,
        "total_debt": q_total_debt,
        "equity": q_equity,
        "current_assets": q_current_assets,
        "current_liabilities": q_current_liab,
        "cash": q_cash,
        "total_assets": q_total_assets,
        "debt_to_equity": q_debt_to_equity,
        "current_ratio": q_current_ratio,
        "cash_ratio": q_cash_ratio,
        "roe": q_roe,
        "roa": q_roa,
        "dividend_yield": q_div_yield,
        "operating_cf": q_op_cf,
        "capex": q_capex,
        "free_cf": q_free_cf,
        "eps_yoy": _yoy_growth(q_eps),
        "revenue_yoy": _yoy_growth(q_revenue),
        "operating_income_yoy": _yoy_growth(q_op_income),
    }

    # Annual YoY for IS items (lag=1)
    annual["revenue_yoy"] = _yoy_growth(a_revenue, lag=1)
    annual["operating_income_yoy"] = _yoy_growth(a_op_income, lag=1)
    annual["eps_yoy"] = _yoy_growth(annual["eps"], lag=1)
    annual["free_cf_yoy"] = _yoy_growth(a_free_cf, lag=1)

    return {
        "ticker": ticker,
        "metrics": metrics,
        "annual": annual,
        "quarterly": quarterly,
    }


def _is_soft_gate(r: dict) -> bool:
    """Trend-template-strong tickers that haven't formed a VCP pattern today
    but are still in Stage 2 + RS≥70 + Primary ≥ market-specific threshold.
    v1.2: market-aware — US uses 13 rules, non-US uses 10 (E7/F1/H4 dropped)."""
    rules = r.get("rules") or {}
    market = r.get("market")
    ids = _soft_gate_ids(market)
    passed = sum(1 for rid in ids if (rules.get(rid) or {}).get("passed"))
    if passed < _soft_gate_threshold(market):
        return False
    if SOFT_GATE_REQUIRE_STAGE2 and (r.get("stage") or 0) != 2:
        return False
    if (r.get("rs_rating") or 0) < SOFT_GATE_REQUIRE_RS:
        return False
    return True


def _update_detection_history(rows: list[dict], today: str) -> dict:
    """
    Maintain first-detection history for permanent backtest tracking.

    Design:
      - First detection date = Day 1 (only set on hard-gate VCP detection).
      - current_price is refreshed daily for ALL history tickers (even after
        they drop out of the screener), so return_pct tracks the full holding
        period from detection date.
      - last_seen updated when ticker is in detected ∪ soft-gate (T2 — keep
        Stage 2 winners alive across VCP-pattern noise days).
      - soft_gate_streak counts consecutive runs in soft-gate (T3 re-entry).

    Returns the updated history dict.
    """
    history: dict = {}
    if HISTORY_PATH.exists():
        try:
            history = json.loads(HISTORY_PATH.read_text(encoding="utf-8"))
        except Exception:
            history = {}

    detected = {r["ticker"]: r for r in rows if r.get("detected")}
    soft_gate = {r["ticker"]: r for r in rows if (not r.get("detected")) and _is_soft_gate(r)}

    # Step 1: register new detections (first_detected = today, entry price)
    for ticker, r in detected.items():
        if ticker not in history:
            history[ticker] = {
                "first_detected": today,
                "detection_price": r.get("current_price"),
                "detection_score": r.get("score"),
                "market": r.get("market", "US"),
                "company": r.get("company", ""),
            }
        history[ticker]["last_seen"] = today
        history[ticker]["current_score"] = r.get("score")
        history[ticker]["rs_rating"] = r.get("rs_rating")
        history[ticker]["stage"] = r.get("stage")
        history[ticker]["soft_gate_streak"] = (history[ticker].get("soft_gate_streak") or 0) + 1

    # Step 1b (T2): soft-gate touch — keep last_seen fresh, refresh RS/Stage,
    # increment streak. Does NOT create a new history entry; only updates if
    # the ticker was already detected before (active or exited).
    for ticker, r in soft_gate.items():
        if ticker not in history:
            continue
        history[ticker]["last_seen"] = today
        history[ticker]["rs_rating"] = r.get("rs_rating")
        history[ticker]["stage"] = r.get("stage")
        history[ticker]["soft_gate_streak"] = (history[ticker].get("soft_gate_streak") or 0) + 1

    # Reset streak for tickers neither detected nor in soft-gate this run.
    in_view = set(detected.keys()) | set(soft_gate.keys())
    for ticker, h in history.items():
        if ticker not in in_view:
            h["soft_gate_streak"] = 0

    # Step 2: refresh current_price + recent OHLCV for ALL active history tickers.
    # OHLCV is needed for 50-day MA break detection (EX4).
    active_tickers = [t for t, h in history.items() if not h.get("exited")]
    active_ohlcv: dict[str, pd.DataFrame] = {}
    if active_tickers:
        print(f"\nRefreshing prices+OHLCV for {len(active_tickers)} active history tickers...")
        active_ohlcv = fetch_ohlcv(active_tickers, period="6mo")
        updated = 0
        for t in active_tickers:
            df = active_ohlcv.get(t)
            if df is None or df.empty or "Close" not in df.columns:
                continue
            try:
                close = df["Close"].dropna()
                if len(close) > 0:
                    history[t]["current_price"] = round(float(close.iloc[-1]), 2)
                    updated += 1
            except Exception:
                pass
        print(f"  {updated}/{len(active_tickers)} prices refreshed")

    # Step 2b: update peak return tracking + profit-taking signals (display only)
    _update_peak_metrics(history)

    # Step 3: check exit rules for active tickers (T2-aware EX6)
    _check_exits(history, detected, soft_gate, today, active_ohlcv)

    # Step 3b (T3): re-enter previously exited tickers that have rebuilt strength.
    _check_reentry(history, soft_gate, detected, today)

    HISTORY_PATH.write_text(
        json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return history


def _check_reentry(
    history: dict,
    soft_gate: dict,
    detected: dict,
    today: str,
) -> None:
    """T3: un-exit a ticker if it has been in detected or soft-gate for
    RE_ENTRY_STREAK_DAYS consecutive runs. Preserves max_return_pct and
    first_detected (audit trail); records re_entry_date + reason."""
    re_entered = 0
    for ticker, h in history.items():
        if not h.get("exited"):
            continue
        if ticker not in detected and ticker not in soft_gate:
            continue
        streak = h.get("soft_gate_streak") or 0
        if streak < RE_ENTRY_STREAK_DAYS:
            continue
        # Un-exit
        h["exited"] = False
        h.pop("exit_date", None)
        h.pop("exit_price", None)
        prev_reasons = h.pop("exit_reasons", None)
        h["re_entry_date"] = today
        h["re_entry_reason"] = (
            f"soft-gate streak {streak}d · Stage 2 + RS≥70"
            + (f" (was: {', '.join(prev_reasons)})" if prev_reasons else "")
        )
        re_entered += 1
    if re_entered:
        print(f"  {re_entered} tickers re-entered (T3)")


# ---- Exit / signal thresholds (Minervini + O'Neil / IBD standard) ----------
EXIT_INITIAL_STOP_PCT = -8.0       # O'Neil/Minervini "ironclad" -7~-8% stop
EXIT_TRAILING_FROM_PEAK_PCT = -15.0  # protective trailing stop (after some gain)
EXIT_TRAILING_KICK_IN_PCT = 10.0   # trailing only kicks in once peak gain ≥ +10%
EXIT_50DMA_VOLUME_MULT = 1.5       # 50d MA break must coincide with vol ≥ 1.5× SMA50
EXIT_RS_BELOW = 40                 # RS Rating collapse
EXIT_ABSENT_DAYS = 20              # 20 consecutive days not in detected/soft-gate
EXIT_SINGLE_DAY_DROP_PCT = -10.0   # single-session catastrophic drop (gap-down / earnings miss)

# ---- Soft-gate "still tracked" (T2) — keeps Stage 2 winners alive when VCP
# pattern temporarily breaks but the trend is intact. Aligned with
# `web/app/screener/[ticker]/page.tsx` PRIMARY_IDS.
# v1.2: market-aware — E7/F1/H4 are US-only (yfinance fundamentals
# unavailable for KR/HK). Non-US uses 10-rule gate at 9-pass minimum.
SOFT_GATE_PRIMARY_IDS = [
    "A1_ud_vol_ratio", "B1_price_above_150_200", "B2_sma150_gt_sma200",
    "B3_sma50_gt_150_200", "B4_price_above_sma50", "B5_sma200_rising_5mo",
    "B6_30pct_above_52w_low", "B7_within_25pct_high", "R1_rs_70",
    "L1_liquidity_gate", "E7_roe", "F1_outperform_1y", "H4_ni_cagr_3y",
]
SOFT_GATE_US_ONLY = {"E7_roe", "F1_outperform_1y", "H4_ni_cagr_3y"}
SOFT_GATE_MIN_PASSED_US = 12
SOFT_GATE_MIN_PASSED_NON_US = 9
SOFT_GATE_REQUIRE_STAGE2 = True
SOFT_GATE_REQUIRE_RS = 70


def _soft_gate_ids(market: str | None) -> list[str]:
    if (market or "US") == "US":
        return SOFT_GATE_PRIMARY_IDS
    return [rid for rid in SOFT_GATE_PRIMARY_IDS if rid not in SOFT_GATE_US_ONLY]


def _soft_gate_threshold(market: str | None) -> int:
    return SOFT_GATE_MIN_PASSED_US if (market or "US") == "US" else SOFT_GATE_MIN_PASSED_NON_US

# ---- Re-entry (T3) — exited tickers can re-enter when they regain strength
RE_ENTRY_STREAK_DAYS = 3           # must be in soft-gate this many runs in a row

# Display-only signals (do NOT trigger exit — let 10-baggers run)
PROFIT_SIGNAL_PCT_PARTIAL = 20.0   # +20% — "partial take signal"
PROFIT_SIGNAL_PCT_FULL = 25.0      # +25% — "full take signal"


def _update_peak_metrics(history: dict) -> None:
    """Track max return reached + profit-taking signals (display only, no exits)."""
    for h in history.values():
        if h.get("exited"):
            continue
        det_px = h.get("detection_price")
        cur_px = h.get("current_price")
        if not det_px or not cur_px:
            continue
        ret = (cur_px - det_px) / det_px * 100
        prev_peak = h.get("max_return_pct", -999.0)
        if ret > prev_peak:
            h["max_return_pct"] = round(ret, 2)
            h["peak_price"] = cur_px
        h["return_pct"] = round(ret, 2)
        # Profit-taking flags (display only)
        h["profit_signal_partial"] = h.get("max_return_pct", 0) >= PROFIT_SIGNAL_PCT_PARTIAL
        h["profit_signal_full"] = h.get("max_return_pct", 0) >= PROFIT_SIGNAL_PCT_FULL


def _check_single_day_drop(df: "pd.DataFrame") -> tuple[bool, dict]:
    """
    EX7 — single-session catastrophic drop (≤ -10% close-to-close).
    Catches earnings-miss gap-downs that would otherwise stay "detected" until
    EX1 (-8% from entry) or EX5 (trailing) eventually fire from a stale signal.
    """
    if df is None or df.empty or len(df) < 2 or "Close" not in df.columns:
        return False, {}
    try:
        close = df["Close"].dropna()
        if len(close) < 2:
            return False, {}
        prev = float(close.iloc[-2])
        last = float(close.iloc[-1])
        if prev <= 0:
            return False, {}
        pct = (last - prev) / prev * 100
        return (pct <= EXIT_SINGLE_DAY_DROP_PCT), {
            "prev": round(prev, 2),
            "last": round(last, 2),
            "pct": round(pct, 2),
        }
    except Exception:
        return False, {}


def _check_50dma_break(df: pd.DataFrame) -> tuple[bool, dict]:
    """
    Returns (broken, meta).
    Break = today's close < 50d SMA AND today's volume > 1.5× 50d avg volume.
    Source: O'Neil/Minervini "circuit breaker" sell signal.
    """
    if df is None or df.empty or len(df) < 50 or "Close" not in df.columns or "Volume" not in df.columns:
        return False, {}
    try:
        close = df["Close"].dropna()
        vol = df["Volume"].dropna()
        if len(close) < 50 or len(vol) < 50:
            return False, {}
        sma50 = float(close.iloc[-50:].mean())
        sma50_vol = float(vol.iloc[-50:].mean())
        last_close = float(close.iloc[-1])
        last_vol = float(vol.iloc[-1])
        broke = last_close < sma50
        heavy_vol = sma50_vol > 0 and last_vol >= EXIT_50DMA_VOLUME_MULT * sma50_vol
        return (broke and heavy_vol), {
            "close": round(last_close, 2),
            "sma50": round(sma50, 2),
            "vol_ratio": round(last_vol / sma50_vol, 2) if sma50_vol > 0 else None,
        }
    except Exception:
        return False, {}


def _check_exits(
    history: dict,
    detected: dict,
    soft_gate: dict,
    today: str,
    ohlcv_map: dict[str, "pd.DataFrame"] | None = None,
) -> None:
    """
    Mark tickers as exited if any auto-exit criterion fires.
    Auto exits (frozen on hit):
      EX1  Initial stop -8% from detection
      EX3  RS Rating < 40
      EX4  50d MA break + heavy volume (≥1.5× SMA50 vol)
      EX5  Trailing stop -15% from peak (only after peak gain ≥ +10%)
      EX6  Absent ≥ 20 days from both detected AND soft-gate (T1+T2 —
           Stage 2 + RS≥70 + Primary 12+ tickers stay in regardless of
           VCP-pattern noise; only true trend breakdown triggers EX6)

    Profit-taking signals (+20% / +25%) are display-only — do NOT exit
    so 10-bagger candidates can keep running.
    """
    in_view = set(detected.keys()) | set(soft_gate.keys())
    exit_count = 0
    for ticker, h in history.items():
        if h.get("exited"):
            continue
        reasons: list[str] = []

        det_px = h.get("detection_price")
        cur_px = h.get("current_price")
        ret = None
        if det_px and cur_px:
            ret = ((cur_px - det_px) / det_px) * 100

        # EX1: -8% initial stop (Minervini/O'Neil ironclad rule)
        if ret is not None and ret <= EXIT_INITIAL_STOP_PCT:
            reasons.append(f"EX1 stop -{abs(EXIT_INITIAL_STOP_PCT):.0f}% (ret {ret:.1f}%)")

        # EX5: trailing -15% from peak (only after some cushion built up)
        peak = h.get("max_return_pct")
        if peak is not None and peak >= EXIT_TRAILING_KICK_IN_PCT and ret is not None:
            drawdown_from_peak = ret - peak
            if drawdown_from_peak <= EXIT_TRAILING_FROM_PEAK_PCT:
                reasons.append(
                    f"EX5 trailing {drawdown_from_peak:.1f}% from peak +{peak:.1f}%"
                )

        # EX4: 50d MA break + heavy volume
        if ohlcv_map is not None and ticker in ohlcv_map:
            broke, meta = _check_50dma_break(ohlcv_map[ticker])
            if broke:
                reasons.append(
                    f"EX4 50d MA break (close {meta.get('close')} < SMA50 {meta.get('sma50')}, vol {meta.get('vol_ratio')}×)"
                )

        # EX7: single-day catastrophic drop (≤ -10% close-to-close)
        if ohlcv_map is not None and ticker in ohlcv_map:
            crashed, meta7 = _check_single_day_drop(ohlcv_map[ticker])
            if crashed:
                reasons.append(
                    f"EX7 single-day {meta7.get('pct')}% drop ({meta7.get('prev')}→{meta7.get('last')})"
                )

        # EX3: RS rating collapse
        rs = h.get("rs_rating")
        if rs is not None and rs < EXIT_RS_BELOW:
            reasons.append(f"EX3 RS {rs} < {EXIT_RS_BELOW}")

        # EX6: extended absence — only fires when ticker is absent from BOTH
        # the hard-gate (detected) and the soft-gate (Stage 2 + RS≥70 + 12+
        # primary rules). last_seen is now refreshed by soft-gate touches, so
        # a Stage 2 winner with no VCP pattern stays alive.
        last_seen = h.get("last_seen", "")
        if last_seen and ticker not in in_view:
            days_absent = (
                datetime.strptime(today, "%Y-%m-%d")
                - datetime.strptime(last_seen, "%Y-%m-%d")
            ).days
            if days_absent >= EXIT_ABSENT_DAYS:
                reasons.append(f"EX6 absent {days_absent}d (no detected/soft-gate)")

        if reasons:
            h["exited"] = True
            h["exit_date"] = today
            h["exit_price"] = cur_px
            h["exit_reasons"] = reasons
            exit_count += 1

    if exit_count:
        print(f"  {exit_count} tickers exited")


def _fetch_latest_prices(tickers: list[str]) -> dict[str, float]:
    """
    Batch fetch latest close for a list of tickers via yfinance.
    Returns {ticker: close_price}. Missing tickers are omitted.
    """
    if not tickers:
        return {}
    out: dict[str, float] = {}
    try:
        data = yf.download(
            tickers=" ".join(tickers),
            period="5d",
            interval="1d",
            group_by="ticker",
            auto_adjust=True,
            progress=False,
            threads=True,
        )
    except Exception as e:
        print(f"  [latest prices] download failed: {e}")
        return out
    if len(tickers) == 1:
        t = tickers[0]
        try:
            close = data["Close"].dropna()
            if len(close) > 0:
                out[t] = round(float(close.iloc[-1]), 2)
        except (KeyError, AttributeError):
            pass
        return out
    for t in tickers:
        try:
            close = data[t]["Close"].dropna()
            if len(close) > 0:
                out[t] = round(float(close.iloc[-1]), 2)
        except (KeyError, AttributeError):
            continue
    return out


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
    result_df, market_direction = run_screener(vcp_only=False)

    if result_df.empty:
        print("\nERROR: No results from any market.")
        sys.exit(1)

    rows = result_df.to_dict(orient="records")

    # NaN -> None for JSON
    for r in rows:
        for k, v in r.items():
            if isinstance(v, float) and v != v:
                r[k] = None

    # ---- Composite Score v2 (Phase 1.4-α) ----
    # Preserve v1 in `score_v1`, replace `score` with v2 for downstream consumers.
    # KR/HK fundamentals fallback = 0 (conservative). UI surfaces via `fundamentals_basis`.
    for r in rows:
        r["score_v1"] = r.get("score") or 0.0
        v2 = compute_composite_v2_from_row(r)
        r["score"] = v2["score_v2"]
        r["fundamentals_score"] = v2["fundamentals_score"]
        r["fundamentals_basis"] = v2["fundamentals_basis"]
        r["a1_pts"] = v2["a1_pts"]
        r["qualifies_strict"] = v2["qualifies_strict"]
        r["extended_penalty"] = v2["extended_penalty"]

    # ---- Phase 2-3: Trend Template 8/8 hard precondition for `detected` ----
    # Detection previously relied on stage==2 alone, which permitted stocks where
    # SMA200 was not yet rising 5mo (B5 fail) or base showed lower highs/lows
    # (B10 fail). Minervini doctrine treats Trend Template as binary all-or-nothing.
    # Incident: SILA on 2026-05-14 (B5 ✗, B10 ✗, but pct_to_pivot +16.6% Extended).
    TT_REQUIRED_US = [
        "B1_price_above_150_200",
        "B2_sma150_gt_sma200",
        "B3_sma50_gt_150_200",
        "B4_price_above_sma50",
        "B5_sma200_rising_5mo",
        "B6_30pct_above_52w_low",
        "B7_within_25pct_high",
        "R1_rs_70",
    ]
    # Base structure: higher-highs/lower-lows (B10) is a separate pattern integrity
    # check — required additionally to avoid descending bases qualifying as VCP.
    TT_REQUIRED_PATTERN = ["B10_higher_highs_lows"]

    demoted = 0
    for r in rows:
        if not r.get("detected"):
            continue
        rules = r.get("rules") or {}
        tt_fail = [
            rid for rid in TT_REQUIRED_US
            if not (rules.get(rid) or {}).get("passed", False)
        ]
        pattern_fail = [
            rid for rid in TT_REQUIRED_PATTERN
            if not (rules.get(rid) or {}).get("passed", False)
        ]
        if tt_fail or pattern_fail:
            r["detected"] = False
            r["detection_demoted_reason"] = (
                f"Trend Template / pattern incomplete: "
                f"{','.join(tt_fail + pattern_fail)}"
            )
            demoted += 1
    if demoted:
        print(f"  Phase 2-3: demoted {demoted} detections (Trend Template incomplete)")

    # Sort: rules_passed desc, then composite score (v2) desc
    rows.sort(key=lambda x: (-(x.get("rules_passed") or 0), -(x.get("score") or 0)))

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

    # ---- Score Snapshot (Phase 1.4-α — forward backtest data) ----
    # Capture v1/v2 scores + price for ALL candidates today so 30/60/90d returns
    # can be backtested in the future (N=426 vs detection_history N=11~36).
    snapshot = {
        "date": today,
        "ticker_count": len(rows),
        "tickers": {
            r["ticker"]: {
                "score_v1": r.get("score_v1"),
                "score_v2": r.get("score"),
                "fundamentals_score": r.get("fundamentals_score"),
                "fundamentals_basis": r.get("fundamentals_basis"),
                "a1_pts": r.get("a1_pts"),
                "current_price": r.get("current_price"),
                "market": r.get("market"),
                "rules_passed": r.get("rules_passed"),
                "detected": bool(r.get("detected")),
            }
            for r in rows
        },
    }
    (SNAPSHOT_DIR / f"{today}.json").write_text(
        json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8"
    )
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
        "market_direction": market_direction,
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
            # Flatten yfinance MultiIndex columns (occurs intermittently when batch-downloading)
            if isinstance(df.columns, pd.MultiIndex):
                df = df.copy()
                df.columns = [c[0] if isinstance(c, tuple) else c for c in df.columns]
            if "Close" not in df.columns:
                continue
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

    # Financial data for detected (hard gate) + Primary 12+ (soft gate) tickers.
    # Soft-gate tickers also get full financial cards so /screener/[ticker]
    # and /research/[ticker] both have data without on-demand fetches.
    PRIMARY_IDS_FOR_FIN = [
        "A1_ud_vol_ratio", "B1_price_above_150_200", "B2_sma150_gt_sma200",
        "B3_sma50_gt_150_200", "B4_price_above_sma50", "B5_sma200_rising_5mo",
        "B6_30pct_above_52w_low", "B7_within_25pct_high", "R1_rs_70",
        "L1_liquidity_gate", "E7_roe",
        "F1_outperform_1y", "H4_ni_cagr_3y",
    ]
    softgate_tickers = []
    for r in rows:
        rules_dict = r.get("rules") or {}
        passed = sum(
            1 for rid in PRIMARY_IDS_FOR_FIN
            if rules_dict.get(rid, {}).get("passed")
        )
        if passed >= 12 and r["ticker"] not in detected_tickers:
            softgate_tickers.append(r["ticker"])

    fin_targets = detected_tickers + softgate_tickers
    if fin_targets:
        print(f"\nFetching financials for {len(fin_targets)} tickers "
              f"({len(detected_tickers)} detected + {len(softgate_tickers)} soft-gate, "
              f"with rate limit delay)...")
        fin_count = 0
        for i, t in enumerate(fin_targets):
            if i > 0:
                time.sleep(2)  # 2s delay between requests to avoid Yahoo rate limit
            fin = fetch_ticker_financials(t)
            if fin:
                fname = _safe_chart_filename(t)
                (FIN_DIR / f"{fname}.json").write_text(
                    json.dumps(fin, ensure_ascii=False, indent=2), encoding="utf-8"
                )
                fin_count += 1
        print(f"  {fin_count} financial profiles saved")
        # Clean up old
        fin_keep = set(_safe_chart_filename(t) for t in fin_targets)
        for f in FIN_DIR.glob("*.json"):
            if f.stem not in fin_keep:
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

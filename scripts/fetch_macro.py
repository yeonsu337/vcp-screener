"""
Macro / Sentiment / Liquidity dashboard data fetcher.

Pulls free-tier data from:
  - yfinance: VIX, DXY, treasury yields, KRW/USD, S&P500, KOSPI
  - CNN: Fear & Greed Index (no key, public JSON)
  - FRED CSV: M2, Fed assets (CSV no-key endpoints)
  - FinanceDataReader: KOSPI/KOSDAQ index history

Outputs single file `web/public/data/macro.json` consumed by the /macro page.

Schema:
{
  "updated_at": ISO,
  "us": {
    "sentiment": [Indicator, ...],
    "liquidity": [Indicator, ...],
    "macro":     [Indicator, ...]
  },
  "kr": {
    "sentiment": [Indicator, ...],
    "liquidity": [Indicator, ...],
    "macro":     [Indicator, ...]
  }
}
where Indicator = {
  id, name, value, prev, change_pct, unit, source, asof,
  series: [{time, value}, ...],   // last 12mo daily, optional
  signal: "bullish" | "neutral" | "bearish",
  note: "human-readable interpretation"
}
"""
from __future__ import annotations
import json
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

import requests
import yfinance as yf
import pandas as pd

PROJ_DIR = Path(__file__).parent.parent
DATA_DIR = PROJ_DIR / "web" / "public" / "data"
OUT = DATA_DIR / "macro.json"

UA = {"User-Agent": "VCP-Screener macro-fetch ysialm1472@gmail.com"}


# =============================================================================
# Helper utilities
# =============================================================================
def _series_from_df(df: "pd.DataFrame", col: str = "Close", days: int = 365) -> list[dict]:
    """Convert a yfinance OHLCV DataFrame into a [{time, value}] list."""
    if df is None or df.empty or col not in df.columns:
        return []
    sub = df[[col]].dropna().tail(days)
    return [
        {"time": idx.strftime("%Y-%m-%d"), "value": round(float(v), 4)}
        for idx, v in zip(sub.index, sub[col].values.flatten())
    ]


def _change_pct(cur: float | None, prev: float | None) -> float | None:
    if cur is None or prev is None or prev == 0:
        return None
    return round((cur - prev) / abs(prev) * 100, 2)


def _signal(value: float, bullish_above: float | None = None, bearish_below: float | None = None) -> str:
    if bullish_above is not None and value >= bullish_above:
        return "bullish"
    if bearish_below is not None and value <= bearish_below:
        return "bearish"
    return "neutral"


def _yf_history(ticker: str, period: str = "1y") -> "pd.DataFrame":
    try:
        return yf.Ticker(ticker).history(period=period, auto_adjust=True)
    except Exception as e:
        print(f"  [yf {ticker}] {e}")
        return pd.DataFrame()


# =============================================================================
# Indicator fetchers — US
# =============================================================================
def vix() -> dict | None:
    """CBOE Volatility Index. >30 = fear, <15 = complacency."""
    df = _yf_history("^VIX", "1y")
    if df.empty:
        return None
    last = float(df["Close"].iloc[-1])
    prev = float(df["Close"].iloc[-2]) if len(df) >= 2 else None
    # Inverted signal: high VIX = bearish for risk
    sig = "bullish" if last < 15 else "bearish" if last > 30 else "neutral"
    note_parts = []
    if last > 30:
        note_parts.append("패닉 영역 (>30) — 단기 바닥 신호일 가능성")
    elif last < 15:
        note_parts.append("자만 영역 (<15) — 변동성 폭발 경계")
    else:
        note_parts.append("정상 범위 (15~30)")
    return {
        "id": "us_vix",
        "name": "VIX (S&P500 변동성지수)",
        "value": round(last, 2),
        "prev": round(prev, 2) if prev else None,
        "change_pct": _change_pct(last, prev),
        "unit": "pt",
        "source": "Yahoo Finance ^VIX",
        "asof": df.index[-1].strftime("%Y-%m-%d"),
        "series": _series_from_df(df, "Close"),
        "signal": sig,
        "note": " · ".join(note_parts),
    }


def cnn_fear_greed() -> dict | None:
    """CNN Fear & Greed Index (0=Extreme Fear, 100=Extreme Greed)."""
    url = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata"
    # CNN's CDN blocks bot user-agents (returns 418). Use a realistic browser UA.
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/126.0.0.0 Safari/537.36"
        ),
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://www.cnn.com/markets/fear-and-greed",
        "Origin": "https://www.cnn.com",
    }
    try:
        r = requests.get(url, headers=headers, timeout=15)
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        print(f"  [cnn fg] {e}")
        return None
    fg = data.get("fear_and_greed", {})
    score = fg.get("score")
    if score is None:
        return None
    rating = fg.get("rating", "")
    prev_close = fg.get("previous_close")
    history = data.get("fear_and_greed_historical", {}).get("data", [])
    series = []
    if history:
        for pt in history[-365:]:
            ts = pt.get("x")
            v = pt.get("y")
            if ts is None or v is None:
                continue
            d = datetime.fromtimestamp(ts / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
            series.append({"time": d, "value": round(float(v), 2)})
    sig = "bullish" if score < 25 else "bearish" if score > 75 else "neutral"
    note = (
        f"{rating} — "
        + ("극단적 공포 = 역발상 매수 영역" if score < 25
           else "극단적 탐욕 = 과열 경계 영역" if score > 75
           else "중립 — 추세 추종")
    )
    # CNN 'timestamp' is now an ISO8601 string (was epoch ms previously). Handle both.
    ts_raw = fg.get("timestamp")
    asof = ""
    if isinstance(ts_raw, str) and ts_raw:
        try:
            asof = ts_raw[:10]
        except Exception:
            asof = ""
    elif isinstance(ts_raw, (int, float)):
        try:
            asof = datetime.fromtimestamp(ts_raw / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
        except Exception:
            asof = ""
    return {
        "id": "us_fg",
        "name": "CNN Fear & Greed Index",
        "value": round(float(score), 1),
        "prev": round(float(prev_close), 1) if prev_close else None,
        "change_pct": _change_pct(score, prev_close),
        "unit": "0-100",
        "source": "CNN Business",
        "asof": asof,
        "series": series,
        "signal": sig,
        "note": note,
    }


def treasury_spread() -> dict | None:
    """10Y-2Y treasury yield spread. <0 = inversion = recession warning."""
    df10 = _yf_history("^TNX", "1y")
    df2 = _yf_history("^TYX", "1y")  # ^TYX is 30Y; for 2Y use a proxy
    # Better: try ^IRX (13-week T-bill) as short proxy. But true 2Y not on yahoo by default.
    # Use FRED CSV for T10Y2Y series.
    return _fred_csv(
        series_id="T10Y2Y",
        ind_id="us_yieldspread",
        name="10Y-2Y 국채 스프레드",
        unit="%p",
        bullish_above=0.5,
        bearish_below=0.0,
        invert_signal=False,
        note_fn=lambda v: (
            "역전 (음수) — 경기침체 선행 신호" if v < 0
            else "정상 (0.5%↑)" if v >= 0.5
            else "수축 (0~0.5%) — 경계"
        ),
    )


def _fred_csv(
    series_id: str,
    ind_id: str,
    name: str,
    unit: str,
    bullish_above: float | None = None,
    bearish_below: float | None = None,
    invert_signal: bool = False,
    note_fn=None,
    days: int = 730,
) -> dict | None:
    """
    Fetch FRED data via the no-API-key CSV endpoint.
    Format: https://fred.stlouisfed.org/graph/fredgraph.csv?id=<SERIES>
    """
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}"
    try:
        r = requests.get(url, headers=UA, timeout=20)
        r.raise_for_status()
    except Exception as e:
        print(f"  [fred {series_id}] {e}")
        return None
    from io import StringIO
    try:
        df = pd.read_csv(StringIO(r.text))
    except Exception as e:
        print(f"  [fred {series_id} parse] {e}")
        return None
    if df.empty or len(df.columns) < 2:
        return None
    df.columns = [df.columns[0]] + ["value"]
    df["time"] = pd.to_datetime(df.iloc[:, 0], errors="coerce")
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    df = df.dropna(subset=["time", "value"]).sort_values("time")
    if df.empty:
        return None
    df = df.tail(days)
    last = float(df["value"].iloc[-1])
    prev = float(df["value"].iloc[-2]) if len(df) >= 2 else None
    sig = _signal(last, bullish_above, bearish_below)
    if invert_signal:
        sig = {"bullish": "bearish", "bearish": "bullish", "neutral": "neutral"}[sig]
    series = [
        {"time": t.strftime("%Y-%m-%d"), "value": round(float(v), 4)}
        for t, v in zip(df["time"], df["value"])
    ]
    note = note_fn(last) if note_fn else ""
    return {
        "id": ind_id,
        "name": name,
        "value": round(last, 4),
        "prev": round(prev, 4) if prev is not None else None,
        "change_pct": _change_pct(last, prev),
        "unit": unit,
        "source": f"FRED {series_id}",
        "asof": df["time"].iloc[-1].strftime("%Y-%m-%d"),
        "series": series,
        "signal": sig,
        "note": note,
    }


def fed_funds_rate() -> dict | None:
    return _fred_csv(
        series_id="DFF", ind_id="us_fedfunds",
        name="Fed Funds Rate (실효금리)", unit="%",
        bullish_above=None, bearish_below=None,
        note_fn=lambda v: (
            "긴축 영역 (>4.5%)" if v >= 4.5
            else "중립 (2.5~4.5%)" if v >= 2.5
            else "완화 영역 (<2.5%)"
        ),
    )


def m2() -> dict | None:
    """US M2 Money Stock — proxy for total liquidity."""
    return _fred_csv(
        series_id="M2SL", ind_id="us_m2",
        name="M2 통화량 (조 USD)", unit="$B",
        note_fn=lambda v: "유동성 확장 추세 모니터링" if v > 20000 else "—",
    )


def fed_assets() -> dict | None:
    """Fed Total Assets (h41) — Quantitative Tightening tracker."""
    return _fred_csv(
        series_id="WALCL", ind_id="us_fed_balance",
        name="Fed 자산 (QT 트래커)", unit="$M",
        note_fn=lambda v: "—",
    )


def reverse_repo() -> dict | None:
    """Overnight Reverse Repo facility — short-term liquidity gauge."""
    return _fred_csv(
        series_id="RRPONTSYD", ind_id="us_rrp",
        name="ON Reverse Repo (단기 유동성)", unit="$B",
        note_fn=lambda v: "축소 = MMF 자금 → 단기국채로 이동 신호" if v < 100 else "—",
    )


def dxy() -> dict | None:
    """US Dollar Index — strong dollar = headwind for EM/risk."""
    df = _yf_history("DX-Y.NYB", "1y")
    if df.empty:
        df = _yf_history("DXY", "1y")
    if df.empty:
        return None
    last = float(df["Close"].iloc[-1])
    prev = float(df["Close"].iloc[-2]) if len(df) >= 2 else None
    sig = "bearish" if last > 105 else "bullish" if last < 100 else "neutral"
    return {
        "id": "us_dxy",
        "name": "DXY 달러 인덱스",
        "value": round(last, 2),
        "prev": round(prev, 2) if prev else None,
        "change_pct": _change_pct(last, prev),
        "unit": "pt",
        "source": "ICE Futures",
        "asof": df.index[-1].strftime("%Y-%m-%d"),
        "series": _series_from_df(df, "Close"),
        "signal": sig,
        "note": "강달러(>105) = 위험자산·이머징 헤드윈드" if last > 105 else "약달러(<100) = 위험자산 우호" if last < 100 else "중립 (100~105)",
    }


def sp500_vs_sma200() -> dict | None:
    """S&P 500 vs SMA200 — trend regime indicator."""
    df = _yf_history("^GSPC", "2y")
    if df.empty or len(df) < 200:
        return None
    df["SMA200"] = df["Close"].rolling(200).mean()
    last_close = float(df["Close"].iloc[-1])
    last_sma = float(df["SMA200"].iloc[-1])
    pct = (last_close / last_sma - 1) * 100
    sig = "bullish" if pct > 0 else "bearish"
    return {
        "id": "us_sp500_trend",
        "name": "S&P500 vs SMA200",
        "value": round(pct, 2),
        "prev": None,
        "change_pct": None,
        "unit": "% 격차",
        "source": "Yahoo Finance ^GSPC",
        "asof": df.index[-1].strftime("%Y-%m-%d"),
        "series": [
            {"time": t.strftime("%Y-%m-%d"), "value": round(float(c), 2)}
            for t, c in zip(df.index[-365:], df["Close"].iloc[-365:].values.flatten())
        ],
        "signal": sig,
        "note": ("SMA200 위 = Stage 2 추세" if pct > 0 else "SMA200 아래 = Stage 4 하락"),
    }


# =============================================================================
# Indicator fetchers — KR
# =============================================================================
def kospi_vs_sma200() -> dict | None:
    """KOSPI vs SMA200 — KR market trend regime."""
    df = _yf_history("^KS11", "2y")
    if df.empty or len(df) < 200:
        return None
    df["SMA200"] = df["Close"].rolling(200).mean()
    last_close = float(df["Close"].iloc[-1])
    last_sma = float(df["SMA200"].iloc[-1])
    pct = (last_close / last_sma - 1) * 100
    sig = "bullish" if pct > 0 else "bearish"
    return {
        "id": "kr_kospi_trend",
        "name": "KOSPI vs SMA200",
        "value": round(pct, 2),
        "prev": None,
        "change_pct": None,
        "unit": "% 격차",
        "source": "Yahoo Finance ^KS11",
        "asof": df.index[-1].strftime("%Y-%m-%d"),
        "series": [
            {"time": t.strftime("%Y-%m-%d"), "value": round(float(c), 2)}
            for t, c in zip(df.index[-365:], df["Close"].iloc[-365:].values.flatten())
        ],
        "signal": sig,
        "note": ("SMA200 위 = Stage 2 추세" if pct > 0 else "SMA200 아래 = Stage 4 하락"),
    }


def kospi_realized_vol() -> dict | None:
    """
    KOSPI 21-day realized volatility (annualized) — VKOSPI proxy.
    VKOSPI not on Yahoo; this is the closest free alternative.
    """
    df = _yf_history("^KS11", "1y")
    if df.empty or len(df) < 30:
        return None
    rets = df["Close"].pct_change().dropna()
    if len(rets) < 21:
        return None
    last_vol = float(rets.tail(21).std() * (252 ** 0.5) * 100)
    prev_vol = float(rets.tail(42).head(21).std() * (252 ** 0.5) * 100) if len(rets) >= 42 else None
    sig = "bullish" if last_vol < 15 else "bearish" if last_vol > 30 else "neutral"
    # Build a rolling series for chart
    vol_series = (rets.rolling(21).std() * (252 ** 0.5) * 100).dropna().tail(365)
    series = [
        {"time": t.strftime("%Y-%m-%d"), "value": round(float(v), 2)}
        for t, v in zip(vol_series.index, vol_series.values)
    ]
    return {
        "id": "kr_kospi_vol",
        "name": "KOSPI 21일 변동성 (연환산)",
        "value": round(last_vol, 2),
        "prev": round(prev_vol, 2) if prev_vol else None,
        "change_pct": _change_pct(last_vol, prev_vol),
        "unit": "% (연환산)",
        "source": "yfinance ^KS11 derived",
        "asof": df.index[-1].strftime("%Y-%m-%d"),
        "series": series,
        "signal": sig,
        "note": "패닉 영역 (>30%)" if last_vol > 30 else "저변동 (<15%) — 변동성 폭발 경계" if last_vol < 15 else "정상 (15~30%)",
    }


def usdkrw() -> dict | None:
    """USD/KRW — KR risk-off barometer (>1400 = stress)."""
    df = _yf_history("KRW=X", "1y")
    if df.empty:
        return None
    last = float(df["Close"].iloc[-1])
    prev = float(df["Close"].iloc[-2]) if len(df) >= 2 else None
    sig = "bearish" if last > 1400 else "bullish" if last < 1300 else "neutral"
    return {
        "id": "kr_usdkrw",
        "name": "USD/KRW 환율",
        "value": round(last, 2),
        "prev": round(prev, 2) if prev else None,
        "change_pct": _change_pct(last, prev),
        "unit": "₩",
        "source": "Yahoo Finance KRW=X",
        "asof": df.index[-1].strftime("%Y-%m-%d"),
        "series": _series_from_df(df, "Close"),
        "signal": sig,
        "note": "원화 약세 (>1400) = 외인 자금 이탈 압력" if last > 1400 else "원화 강세 (<1300) = 외인 유입 우호" if last < 1300 else "중립 (1300~1400)",
    }


def kospi_breadth_proxy() -> dict | None:
    """
    KOSPI 200 breadth proxy: ratio of KS200 vs KOSPI (large vs broad).
    True breadth requires daily constituent count above SMA — out of free scope.
    Return KOSPI/KOSDAQ ratio as risk-on/off proxy instead.
    """
    df_kp = _yf_history("^KS11", "1y")
    df_kq = _yf_history("^KQ11", "1y")
    if df_kp.empty or df_kq.empty:
        return None
    # Normalize each to start=100 then take ratio
    kp = df_kp["Close"] / df_kp["Close"].iloc[0] * 100
    kq = df_kq["Close"] / df_kq["Close"].iloc[0] * 100
    common_idx = kp.index.intersection(kq.index)
    if len(common_idx) < 21:
        return None
    ratio = (kq.loc[common_idx] / kp.loc[common_idx]).dropna()
    last = float(ratio.iloc[-1])
    prev = float(ratio.iloc[-2]) if len(ratio) >= 2 else None
    # >1 means KOSDAQ outperforming = risk-on (small cap leadership)
    sig = "bullish" if last > 1.0 else "bearish"
    series = [
        {"time": t.strftime("%Y-%m-%d"), "value": round(float(v), 4)}
        for t, v in zip(ratio.index[-365:], ratio.values[-365:])
    ]
    return {
        "id": "kr_kosdaq_kospi_ratio",
        "name": "KOSDAQ/KOSPI 상대강도 (1년 정규화)",
        "value": round(last, 3),
        "prev": round(prev, 3) if prev else None,
        "change_pct": _change_pct(last, prev),
        "unit": "비율",
        "source": "yfinance derived",
        "asof": ratio.index[-1].strftime("%Y-%m-%d"),
        "series": series,
        "signal": sig,
        "note": "코스닥 우위 (>1.0) = 위험선호" if last > 1.0 else "코스피 우위 (<1.0) = 안전선호",
    }


def kr_3m_interbank() -> dict | None:
    """한국 3개월 은행간 금리 (BoK 기준금리 프록시) — FRED IR3TIB01KRM156N."""
    return _fred_csv(
        series_id="IR3TIB01KRM156N", ind_id="kr_3m_interbank",
        name="한국 3M 은행간 금리 (기준금리 프록시)", unit="%",
        note_fn=lambda v: (
            "긴축 영역 (>3.5%)" if v >= 3.5
            else "중립 (2.0~3.5%)" if v >= 2.0
            else "완화 영역 (<2.0%)"
        ),
    )


# =============================================================================
# Build + write
# =============================================================================
def safe(fn, *args):
    try:
        return fn(*args)
    except Exception as e:
        print(f"  [safe] {fn.__name__} failed: {e}")
        return None


def build() -> dict:
    print("== Macro fetcher ==")
    out: dict[str, Any] = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "us": {"sentiment": [], "liquidity": [], "macro": []},
        "kr": {"sentiment": [], "liquidity": [], "macro": []},
    }

    print("\n[US sentiment]")
    for fn in (vix, cnn_fear_greed):
        r = safe(fn)
        if r:
            out["us"]["sentiment"].append(r)
            print(f"  {r['name']}: {r['value']} {r['unit']} [{r['signal']}]")

    print("\n[US liquidity]")
    for fn in (fed_funds_rate, m2, fed_assets, reverse_repo):
        r = safe(fn)
        if r:
            out["us"]["liquidity"].append(r)
            print(f"  {r['name']}: {r['value']} {r['unit']} [{r['signal']}]")

    print("\n[US macro]")
    for fn in (treasury_spread, dxy, sp500_vs_sma200):
        r = safe(fn)
        if r:
            out["us"]["macro"].append(r)
            print(f"  {r['name']}: {r['value']} {r['unit']} [{r['signal']}]")

    print("\n[KR sentiment]")
    for fn in (kospi_realized_vol, kospi_breadth_proxy):
        r = safe(fn)
        if r:
            out["kr"]["sentiment"].append(r)
            print(f"  {r['name']}: {r['value']} {r['unit']} [{r['signal']}]")

    print("\n[KR liquidity]")
    for fn in (kr_3m_interbank,):
        r = safe(fn)
        if r:
            out["kr"]["liquidity"].append(r)
            print(f"  {r['name']}: {r['value']} {r['unit']} [{r['signal']}]")

    print("\n[KR macro]")
    for fn in (kospi_vs_sma200, usdkrw):
        r = safe(fn)
        if r:
            out["kr"]["macro"].append(r)
            print(f"  {r['name']}: {r['value']} {r['unit']} [{r['signal']}]")

    return out


def main(argv: list[str]) -> int:
    data = build()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    indicator_count = sum(
        len(data[r][s]) for r in ("us", "kr") for s in ("sentiment", "liquidity", "macro")
    )
    print(f"\nWrote {indicator_count} indicators to {OUT.relative_to(PROJ_DIR)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

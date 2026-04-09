"""
VCP Screener — Streamlit UI
Run: streamlit run app.py
"""
from __future__ import annotations
import time
from pathlib import Path

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from screener import (
    fetch_finviz_prefilter,
    fetch_ohlcv,
    compute_rs_scores,
    detect_vcp,
)

CACHE_DIR = Path(__file__).parent / ".cache"
CACHE_DIR.mkdir(exist_ok=True)
RESULTS_CACHE = CACHE_DIR / "last_results.parquet"

st.set_page_config(page_title="VCP Screener", layout="wide")

st.title("VCP Screener")
st.caption("Mark Minervini Trend Template + Volatility Contraction Pattern · NASDAQ/NYSE/AMEX")

# -----------------------------------------------------------------------------
# Sidebar
# -----------------------------------------------------------------------------
with st.sidebar:
    st.header("Filters")
    min_rs = st.slider("Min RS Rating (IBD)", 0, 99, 70)
    min_score = st.slider("Min VCP Score", 0, 100, 40)
    vcp_only = st.checkbox("VCP detected only", value=True)
    st.divider()
    run_btn = st.button("▶ Run Screener", type="primary", use_container_width=True)
    st.caption("Run takes ~1-3 min (Finviz prefilter + yfinance batch).")
    if RESULTS_CACHE.exists():
        ts = time.strftime("%Y-%m-%d %H:%M",
                           time.localtime(RESULTS_CACHE.stat().st_mtime))
        st.caption(f"Last run: {ts}")


# -----------------------------------------------------------------------------
# Cached pipeline
# -----------------------------------------------------------------------------
@st.cache_data(show_spinner=False, ttl=3600)
def _prefilter_cached() -> pd.DataFrame:
    return fetch_finviz_prefilter()


@st.cache_data(show_spinner=False, ttl=3600)
def _ohlcv_cached(tickers: tuple[str, ...]) -> dict:
    return fetch_ohlcv(list(tickers), period="2y")


def run_pipeline(min_rs: int) -> pd.DataFrame:
    progress = st.progress(0.0, text="Finviz prefilter…")
    pf = _prefilter_cached()
    if pf.empty:
        st.error("Finviz returned no rows. Check filters or rate limit.")
        return pd.DataFrame()
    progress.progress(0.25, text=f"{len(pf)} tickers passed Trend Template — downloading OHLCV…")

    tickers = tuple(pf["Ticker"].tolist())
    ohlcv = _ohlcv_cached(tickers)
    progress.progress(0.55, text=f"{len(ohlcv)} tickers with history — computing RS…")

    rs = compute_rs_scores(ohlcv)
    survivors = [t for t in ohlcv if t in rs.index and rs[t] >= min_rs]
    progress.progress(0.75, text=f"{len(survivors)} tickers passed RS filter — detecting VCP…")

    rows = []
    for t in survivors:
        r = detect_vcp(t, ohlcv[t])
        d = r.__dict__.copy()
        d["rs_rating"] = int(rs[t])
        meta = pf[pf["Ticker"] == t].iloc[0]
        d["company"] = meta.get("Company", "")
        d["sector"] = meta.get("Sector", "")
        d["industry"] = meta.get("Industry", "")
        rows.append(d)
    progress.progress(1.0, text="Done")
    progress.empty()

    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows).sort_values("score", ascending=False).reset_index(drop=True)
    return df


# -----------------------------------------------------------------------------
# Run
# -----------------------------------------------------------------------------
if run_btn:
    with st.spinner("Running pipeline…"):
        result = run_pipeline(min_rs)
    if not result.empty:
        try:
            result.to_parquet(RESULTS_CACHE)
        except Exception:
            result.to_pickle(RESULTS_CACHE.with_suffix(".pkl"))
    st.session_state["result"] = result

# Load from cache if no fresh run
if "result" not in st.session_state:
    if RESULTS_CACHE.exists():
        try:
            st.session_state["result"] = pd.read_parquet(RESULTS_CACHE)
        except Exception:
            try:
                st.session_state["result"] = pd.read_pickle(
                    RESULTS_CACHE.with_suffix(".pkl"))
            except Exception:
                st.session_state["result"] = pd.DataFrame()
    else:
        st.session_state["result"] = pd.DataFrame()

result = st.session_state["result"]

# -----------------------------------------------------------------------------
# Filter & display
# -----------------------------------------------------------------------------
if result.empty:
    st.info("Click **Run Screener** in the sidebar to start.")
    st.stop()

view = result.copy()
if vcp_only:
    view = view[view["detected"] == True]
view = view[view["score"] >= min_score]
view = view[view["rs_rating"] >= min_rs]

st.subheader(f"Candidates: {len(view)}")
display_cols = [
    "ticker", "company", "sector", "score", "rs_rating",
    "num_contractions", "contractions", "last_contraction_pct",
    "current_price", "pivot_price", "pct_to_pivot", "volume_dryup_ratio",
]
display_cols = [c for c in display_cols if c in view.columns]
st.dataframe(
    view[display_cols],
    use_container_width=True,
    hide_index=True,
    column_config={
        "score": st.column_config.ProgressColumn(
            "Score", min_value=0, max_value=100, format="%.0f"),
        "rs_rating": st.column_config.NumberColumn("RS", format="%d"),
        "pct_to_pivot": st.column_config.NumberColumn("→ Pivot %", format="%.1f%%"),
        "last_contraction_pct": st.column_config.NumberColumn("Last Contr %", format="%.1f%%"),
        "volume_dryup_ratio": st.column_config.NumberColumn("Vol Ratio", format="%.2f"),
    },
)

st.divider()

# -----------------------------------------------------------------------------
# Chart for selected ticker
# -----------------------------------------------------------------------------
st.subheader("Chart")
if not view.empty:
    sel = st.selectbox("Ticker", view["ticker"].tolist())
    if sel:
        with st.spinner(f"Loading {sel}…"):
            data = fetch_ohlcv([sel], period="2y").get(sel)
        if data is not None and not data.empty:
            row = view[view["ticker"] == sel].iloc[0]
            data = data.copy()
            data["SMA50"] = data["Close"].rolling(50).mean()
            data["SMA150"] = data["Close"].rolling(150).mean()
            data["SMA200"] = data["Close"].rolling(200).mean()

            fig = go.Figure()
            fig.add_trace(go.Candlestick(
                x=data.index, open=data["Open"], high=data["High"],
                low=data["Low"], close=data["Close"], name=sel,
            ))
            for ma, color in [("SMA50", "#2962ff"),
                              ("SMA150", "#ff9100"),
                              ("SMA200", "#d50000")]:
                fig.add_trace(go.Scatter(
                    x=data.index, y=data[ma], name=ma,
                    line=dict(color=color, width=1.2),
                ))
            # Pivot line
            fig.add_hline(
                y=row["pivot_price"], line_dash="dash",
                annotation_text=f"Pivot {row['pivot_price']}",
                annotation_position="top right",
                line_color="green",
            )
            fig.update_layout(
                height=550,
                xaxis_rangeslider_visible=False,
                margin=dict(l=10, r=10, t=30, b=10),
                title=f"{sel} — {row.get('company', '')}",
            )
            st.plotly_chart(fig, use_container_width=True)

            c1, c2, c3, c4 = st.columns(4)
            c1.metric("Score", f"{row['score']:.0f}")
            c2.metric("RS", int(row["rs_rating"]))
            c3.metric("Contractions", row["num_contractions"],
                      delta=f"last {row['last_contraction_pct']:.1f}%")
            c4.metric("→ Pivot", f"{row['pct_to_pivot']:+.1f}%")
            st.write(f"**Contractions sequence (%):** {row['contractions']}")

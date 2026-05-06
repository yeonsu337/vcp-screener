"""
Company Research generator — runs after daily VCP scan.

Selects tickers passing 12+ Primary rules → builds 5-Tier research card
(BM / Financials / Market·Competitive / Investment Thesis / Risks).

Free-tier stack only:
  - SEC EDGAR (10-K) — free government API
  - yfinance — free
  - Wikipedia REST — free
  - Gemini 2.0 Flash Free Tier (1500 RPD) — free with API key

Output: web/public/data/research/<ticker>.json (one per qualifying ticker).
Skips re-generation if the cached file is < REFRESH_DAYS old.

Usage:
    python scripts/company_research.py            # process today's Primary 12+ list
    python scripts/company_research.py AAPL NVDA  # explicit tickers
"""
from __future__ import annotations
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
import yfinance as yf

PROJ_DIR = Path(__file__).parent.parent
DATA_DIR = PROJ_DIR / "web" / "public" / "data"
RESEARCH_DIR = DATA_DIR / "research"
RESEARCH_DIR.mkdir(parents=True, exist_ok=True)

# Refresh cadence
REFRESH_DAYS = 7

# ---- Primary rule IDs (must mirror screener.py + frontend) ----------------
PRIMARY_IDS: list[str] = [
    "A1_ud_vol_ratio",
    "B1_price_above_150_200",
    "B2_sma150_gt_sma200",
    "B3_sma50_gt_150_200",
    "B4_price_above_sma50",
    "B5_sma200_rising_5mo",
    "B6_30pct_above_52w_low",
    "B7_within_25pct_high",
    "R1_rs_70",
    "L1_liquidity_gate",
    "P6_monotonic_decreasing",
    "E7_roe",
    "F1_outperform_1y",
    "H4_ni_cagr_3y",
]
PRIMARY_PASS_THRESHOLD = 12

# ---- HTTP defaults --------------------------------------------------------
SEC_UA = "VCP-Screener research-bot ysialm1472@gmail.com"
WIKI_UA = "VCP-Screener research-bot (https://vcp-screener.vercel.app)"


# =============================================================================
# Selection of qualifying tickers
# =============================================================================


def load_results() -> list[dict]:
    p = DATA_DIR / "results.json"
    if not p.exists():
        return []
    return json.loads(p.read_text(encoding="utf-8"))


def count_primary_passed(rules: dict) -> int:
    return sum(1 for rid in PRIMARY_IDS if rules.get(rid, {}).get("passed"))


def select_qualifying(rows: list[dict], min_primary: int = PRIMARY_PASS_THRESHOLD) -> list[dict]:
    out: list[dict] = []
    for r in rows:
        rules = r.get("rules") or {}
        if count_primary_passed(rules) >= min_primary:
            out.append(r)
    return out


def is_fresh(ticker: str) -> bool:
    p = RESEARCH_DIR / f"{_safe(ticker)}.json"
    if not p.exists():
        return False
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        gen = data.get("generated_at")
        if not gen:
            return False
        ts = datetime.fromisoformat(gen.replace("Z", "+00:00"))
        delta_days = (datetime.now(timezone.utc) - ts).days
        return delta_days < REFRESH_DAYS
    except Exception:
        return False


def _safe(t: str) -> str:
    return t.replace(".", "_").replace("/", "_").replace(":", "_")


# =============================================================================
# SEC EDGAR — 10-K extraction (US tickers only)
# =============================================================================


def sec_cik_lookup(ticker: str) -> str | None:
    """Resolve ticker → 10-digit CIK via SEC's company_tickers.json."""
    url = "https://www.sec.gov/files/company_tickers.json"
    try:
        r = requests.get(url, headers={"User-Agent": SEC_UA}, timeout=15)
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        print(f"  [sec cik] {e}")
        return None
    needle = ticker.upper()
    for _, entry in data.items():
        if str(entry.get("ticker", "")).upper() == needle:
            return f"{int(entry['cik_str']):010d}"
    return None


def sec_latest_10k(cik: str) -> dict | None:
    """Return {accession, primary_doc, filing_date} for the most recent 10-K."""
    url = f"https://data.sec.gov/submissions/CIK{cik}.json"
    try:
        r = requests.get(url, headers={"User-Agent": SEC_UA}, timeout=20)
        r.raise_for_status()
        sub = r.json()
    except Exception as e:
        print(f"  [sec sub {cik}] {e}")
        return None
    rec = sub.get("filings", {}).get("recent", {})
    forms = rec.get("form", [])
    accs = rec.get("accessionNumber", [])
    docs = rec.get("primaryDocument", [])
    dates = rec.get("filingDate", [])
    for i, f in enumerate(forms):
        if f == "10-K":
            return {
                "accession": accs[i].replace("-", ""),
                "primary_doc": docs[i],
                "filing_date": dates[i],
                "cik": cik,
            }
    return None


def sec_fetch_10k_text(filing: dict, max_chars: int = 200_000) -> str:
    """Download 10-K HTML and convert to plain text (truncated)."""
    cik_int = int(filing["cik"])
    url = (
        f"https://www.sec.gov/Archives/edgar/data/{cik_int}/"
        f"{filing['accession']}/{filing['primary_doc']}"
    )
    try:
        r = requests.get(url, headers={"User-Agent": SEC_UA}, timeout=30)
        r.raise_for_status()
    except Exception as e:
        print(f"  [sec 10k fetch] {e}")
        return ""
    html = r.text
    # Strip HTML tags + collapse whitespace.
    txt = re.sub(r"<script[\s\S]*?</script>", " ", html, flags=re.I)
    txt = re.sub(r"<style[\s\S]*?</style>", " ", txt, flags=re.I)
    txt = re.sub(r"<[^>]+>", " ", txt)
    txt = re.sub(r"&nbsp;|&#160;", " ", txt)
    txt = re.sub(r"&amp;", "&", txt)
    txt = re.sub(r"&lt;", "<", txt)
    txt = re.sub(r"&gt;", ">", txt)
    txt = re.sub(r"\s+", " ", txt).strip()
    return txt[:max_chars]


def sec_extract_sections(text: str) -> dict:
    """
    Heuristic split of 10-K into Item 1 (Business), 1A (Risk), 7 (MD&A).

    10-K HTML usually contains both a TOC (with item references) and the actual
    section bodies. We pick the LAST occurrence of each anchor to skip TOC.
    """
    out = {"business": "", "risk_factors": "", "mda": ""}
    if not text:
        return out
    # Allow varied formatting: "Item 1.", "ITEM 1 -", "I T E M 1", etc.
    patterns = {
        "business": r"item\s*1\b\s*[\.\-:\s]*\s*business",
        "risk_factors": r"item\s*1a\b\s*[\.\-:\s]*\s*risk\s+factors",
        "mda": r"item\s*7\b\s*[\.\-:\s]*\s*management",
        "_quant": r"item\s*7a\b\s*[\.\-:\s]*\s*quantitative",
        "_financials": r"item\s*8\b\s*[\.\-:\s]*\s*financial\s+statements",
    }
    positions: dict[str, int] = {}
    for key, pat in patterns.items():
        # Use the LAST match — TOC entries appear earlier than actual section bodies
        matches = list(re.finditer(pat, text, flags=re.I))
        if matches:
            positions[key] = matches[-1].start()
    ordered = sorted(positions.items(), key=lambda x: x[1])
    keep = {"business", "risk_factors", "mda"}
    for i, (key, start) in enumerate(ordered):
        if key not in keep:
            continue
        end = ordered[i + 1][1] if i + 1 < len(ordered) else min(start + 50_000, len(text))
        out[key] = text[start:end].strip()[:30_000]
    return out


# =============================================================================
# Wikipedia summary
# =============================================================================


def wiki_summary(name: str) -> str:
    """Fetch Wikipedia REST API summary for a company name."""
    if not name:
        return ""
    title = name.replace(" ", "_")
    url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{title}"
    try:
        r = requests.get(url, headers={"User-Agent": WIKI_UA}, timeout=10)
        if r.status_code != 200:
            return ""
        data = r.json()
        return str(data.get("extract", ""))
    except Exception:
        return ""


# =============================================================================
# yfinance enrichment
# =============================================================================


def yf_company_data(ticker: str) -> dict:
    """Fetch yfinance .info + summary fields for the research card."""
    out: dict = {"ticker": ticker}
    try:
        t = yf.Ticker(ticker)
        info = t.info or {}
        out.update(
            {
                "name": info.get("longName") or info.get("shortName") or "",
                "sector": info.get("sector", ""),
                "industry": info.get("industry", ""),
                "country": info.get("country", ""),
                "website": info.get("website", ""),
                "market_cap": info.get("marketCap"),
                "shares_outstanding": info.get("sharesOutstanding"),
                "summary": info.get("longBusinessSummary", ""),
                "employees": info.get("fullTimeEmployees"),
                "trailing_pe": info.get("trailingPE"),
                "forward_pe": info.get("forwardPE"),
                "peg_ratio": info.get("trailingPegRatio") or info.get("pegRatio"),
                "price_to_sales": info.get("priceToSalesTrailing12Months"),
                "price_to_book": info.get("priceToBook"),
                "ev_to_ebitda": info.get("enterpriseToEbitda"),
                "dividend_yield": info.get("dividendYield"),
                "beta": info.get("beta"),
            }
        )
    except Exception as e:
        print(f"  [yf {ticker}] info failed: {e}")
    return out


# =============================================================================
# Category B / D — fully automatic computation from existing JSON outputs
# =============================================================================


def load_financials_json(ticker: str) -> dict | None:
    p = DATA_DIR / "financials" / f"{_safe(ticker)}.json"
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None


def compute_category_b(candidate: dict, financials: dict | None) -> dict:
    """Auto-fill Category B (Financials) from existing data. No LLM needed."""
    out: dict[str, Any] = {}
    if financials:
        m = financials.get("metrics", {})
        a = financials.get("annual", {})
        q = financials.get("quarterly", {})
        out["roe"] = m.get("roe")
        out["roa"] = m.get("roa")
        out["profit_margin"] = m.get("profit_margin")
        out["operating_margin"] = m.get("operating_margin")
        out["gross_margin"] = m.get("gross_margin")
        out["revenue_growth_ttm"] = m.get("revenue_growth")
        out["earnings_growth_ttm"] = m.get("earnings_growth")
        out["dividend_yield"] = m.get("dividend_yield")
        out["payout_ratio"] = m.get("payout_ratio")
        # 5y annual series for chart hints
        out["annual_revenue"] = a.get("revenue")
        out["annual_operating_income"] = a.get("operating_income")
        out["annual_eps"] = a.get("eps")
        out["annual_free_cf"] = a.get("free_cf")
        out["annual_total_debt"] = a.get("total_debt")
        out["annual_equity"] = a.get("equity")
        out["annual_periods"] = a.get("periods")
        # Quarterly trend
        out["quarterly_eps"] = q.get("eps")
        out["quarterly_revenue"] = q.get("revenue")
        out["quarterly_periods"] = q.get("periods")
    # Composite from candidate (already evaluated)
    rules = candidate.get("rules") or {}
    if "E1_eps_growth" in rules:
        out["eps_qoq_yoy_pct"] = rules["E1_eps_growth"]["value"]
    if "E3_rev_growth" in rules:
        out["sales_yoy_pct"] = rules["E3_rev_growth"]["value"]
    if "H4_ni_cagr_3y" in rules:
        out["ni_cagr_3y_pct"] = rules["H4_ni_cagr_3y"]["value"]
    if "E7_roe" in rules:
        out["roe_pct"] = rules["E7_roe"]["value"]
    return out


def compute_category_d(candidate: dict, yf_data: dict) -> dict:
    """Auto-fill Category D (Investment Thesis) — quantitative parts only."""
    out: dict[str, Any] = {
        "rs_rating": candidate.get("rs_rating"),
        "score": candidate.get("score"),
        "vcp_quality": candidate.get("vcp_quality"),
        "stage": candidate.get("stage"),
        "stage_name": candidate.get("stage_name"),
        "peg_ratio": yf_data.get("peg_ratio"),
        "trailing_pe": yf_data.get("trailing_pe"),
        "forward_pe": yf_data.get("forward_pe"),
        "ev_to_ebitda": yf_data.get("ev_to_ebitda"),
        "price_to_sales": yf_data.get("price_to_sales"),
        "stop_loss_pct": -7.0,  # O'Neil rule
    }
    rules = candidate.get("rules") or {}
    out["outperform_1y_vs_nasdaq"] = rules.get("F1_outperform_1y", {}).get("value")
    out["outperform_6m_vs_nasdaq"] = rules.get("F2_outperform_6m", {}).get("value")
    out["outperform_1m_vs_nasdaq"] = rules.get("F3_outperform_1m", {}).get("value")
    # Lynch category heuristic
    rev_g = (yf_data.get("revenue_growth_ttm") if isinstance(yf_data.get("revenue_growth_ttm"), (int, float)) else None) or rules.get("E3_rev_growth", {}).get("value")
    market_cap = yf_data.get("market_cap")
    if rev_g is not None and market_cap is not None:
        rg = rev_g if abs(rev_g) > 1.0 else rev_g * 100  # normalize to %
        if rg >= 25 and market_cap < 5e9:
            out["lynch_category"] = "Fast Grower"
        elif rg >= 10:
            out["lynch_category"] = "Stalwart"
        elif rg >= 0:
            out["lynch_category"] = "Slow Grower"
        else:
            out["lynch_category"] = "Cyclical / Turnaround?"
    return out


# =============================================================================
# Gemini 2.0 Flash — Free Tier
# =============================================================================


# gemini-2.0-flash free tier had limit:0 on a freshly-created project. 2.5-flash works.
# Free tier 2.5-flash: 10 RPM / 250 RPD / 1M TPM (plenty for daily VCP screen).
GEMINI_MODEL = "gemini-2.5-flash"
GEMINI_URL = (
    f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
)


class LLMUnavailable(Exception):
    pass


def gemini_call(prompt: str, max_output_tokens: int = 1500, temperature: float = 0.3) -> str:
    """Call Gemini 2.0 Flash Free Tier. Raises LLMUnavailable on missing key / quota."""
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise LLMUnavailable("GEMINI_API_KEY not set")
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": max_output_tokens,
            "responseMimeType": "text/plain",
            # 2.5-flash thinks by default; disable to keep latency low.
            "thinkingConfig": {"thinkingBudget": 0},
        },
    }
    try:
        r = requests.post(
            f"{GEMINI_URL}?key={api_key}",
            json=body,
            headers={"Content-Type": "application/json"},
            timeout=60,
        )
    except Exception as e:
        raise LLMUnavailable(f"network error: {e}")
    if r.status_code == 429:
        raise LLMUnavailable("rate-limited (429)")
    if r.status_code in (500, 502, 503, 504):
        raise LLMUnavailable(f"server-busy ({r.status_code})")
    if r.status_code != 200:
        raise LLMUnavailable(f"HTTP {r.status_code}: {r.text[:200]}")
    try:
        data = r.json()
        return data["candidates"][0]["content"]["parts"][0]["text"]
    except Exception as e:
        raise LLMUnavailable(f"parse error: {e}")


# =============================================================================
# LLM-driven sections (Categories A, C, E, and qualitative D)
# =============================================================================


def _truncate(s: str, n: int) -> str:
    return s if len(s) <= n else s[:n] + "..."


def llm_section_a(ticker: str, yf_data: dict, sec_business: str, wiki: str) -> dict:
    """Category A — BM / History (LLM-summarized)."""
    prompt = f"""You are a senior equity research analyst. Produce a structured JSON
summary for {ticker} ({yf_data.get('name')}) covering Business Model & History.
Respond ONLY with valid JSON matching this schema:
{{
  "overview": "1-paragraph company overview (≤ 80 words)",
  "milestones": ["YYYY: event", ...],   // 5-8 key events
  "business_model": "How the company makes money (≤ 60 words)",
  "revenue_streams": ["stream 1", "stream 2", ...],  // 3-6 items
  "value_chain_position": "Upstream / midstream / downstream + 1-line explanation",
  "products": ["product/service 1", ...],   // 3-6
  "channels": ["B2B / B2C / D2C / wholesale ...", ...],
  "key_customers": "concentration assessment (e.g., 'Top 5 customers = 35% of sales')"
}}

Source data (truncated):
- yfinance summary: {_truncate(yf_data.get('summary',''), 1200)}
- 10-K Item 1 (Business): {_truncate(sec_business, 5000)}
- Wikipedia: {_truncate(wiki, 1000)}

Return raw JSON only — no markdown fences, no commentary."""
    text = gemini_call(prompt, max_output_tokens=2000)
    return _parse_json(text)


def llm_section_c(ticker: str, yf_data: dict, sec_business: str, sec_mda: str) -> dict:
    """Category C — Market & Competitive."""
    prompt = f"""You are a competitive strategy analyst. Produce JSON for {ticker} ({yf_data.get('name')}).
Schema:
{{
  "tam_estimate_usd_b": "current TAM in USD billion + source/method",
  "tam_cagr_pct": "expected 3-5Y CAGR with reasoning",
  "growth_drivers": ["driver 1 (1-line)", ...],   // 3-5
  "market_share_pct": "company's est. market share",
  "competitors": [
    {{"name": "Comp1", "differentiation": "..."}},
    ...
  ],   // top 3-5
  "porter_five_forces": {{
    "new_entrants": "low/medium/high + 1-line",
    "substitutes": "...",
    "buyer_power": "...",
    "supplier_power": "...",
    "rivalry": "..."
  }},
  "competitive_advantages": ["advantage 1", ...],
  "competitive_weaknesses": ["weakness 1", ...]
}}

Sector: {yf_data.get('sector')}, Industry: {yf_data.get('industry')}.

Source: 10-K Business + MD&A excerpts:
{_truncate(sec_business, 4000)}
{_truncate(sec_mda, 3000)}

Return JSON only. Where numbers are uncertain, use ranges and tag with 'estimate'."""
    text = gemini_call(prompt, max_output_tokens=2200)
    return _parse_json(text)


def llm_section_d_qualitative(
    ticker: str, yf_data: dict, sec_business: str, sec_mda: str, b: dict, d_quant: dict
) -> dict:
    """Category D — qualitative parts (moat, new trigger, scenarios)."""
    prompt = f"""You are an investment thesis writer for {ticker} ({yf_data.get('name')}).
Quantitative anchors:
- ROE: {b.get('roe_pct')}%, OPM: {b.get('operating_margin')}, NPM: {b.get('profit_margin')}
- Revenue growth (TTM): {b.get('revenue_growth_ttm')}, EPS QoQ YoY: {b.get('eps_qoq_yoy_pct')}
- 3Y NI CAGR: {b.get('ni_cagr_3y_pct')}%
- PEG: {d_quant.get('peg_ratio')}, FwdPE: {d_quant.get('forward_pe')}
- 1Y outperform NASDAQ: {d_quant.get('outperform_1y_vs_nasdaq')}%
- Lynch category (heuristic): {d_quant.get('lynch_category')}

Schema:
{{
  "moat_type": "Intangible Assets | Switching Costs | Network Effect | Cost Advantage | None",
  "moat_evidence": ["evidence 1 from filings", ...],   // 2-4
  "moat_durability_years": "estimate (e.g., '5-10y')",
  "new_trigger": "Recent 12M product/management/industry catalyst (≤ 50 words)",
  "bull_case": "3Y bull scenario with key drivers (≤ 80 words)",
  "base_case": "...",
  "bear_case": "...",
  "key_metrics_to_watch": ["metric 1", ...]   // 3-5
}}

10-K excerpts:
{_truncate(sec_business, 3500)}
{_truncate(sec_mda, 3500)}

Return JSON only."""
    text = gemini_call(prompt, max_output_tokens=2000)
    return _parse_json(text)


def llm_section_e(ticker: str, yf_data: dict, sec_risk: str) -> dict:
    """Category E — Risks (LLM-extracted from 10-K Item 1A)."""
    prompt = f"""Extract structured risks for {ticker} ({yf_data.get('name')}).
Schema:
{{
  "top_risks": [
    {{"category": "Customer concentration | Supply chain | Regulation | Competition | Financial | Governance | Macro",
      "description": "1-2 sentences",
      "severity": "low | medium | high"}}
  ],   // 5-8 risks
  "inversion_scenarios": ["how the company could fail (≤ 1 line each)"],   // 3-4
  "exit_signals": ["specific events that would invalidate the long thesis"]   // 3-4
}}

10-K Item 1A excerpt:
{_truncate(sec_risk, 8000)}

Return JSON only."""
    text = gemini_call(prompt, max_output_tokens=2000)
    return _parse_json(text)


def _parse_json(text: str) -> dict:
    """Extract JSON from LLM response (handles ```json fences and stray prose)."""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"```\s*$", "", text)
    # Find outermost {...}
    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        return {"error": "no json", "raw": text[:500]}
    try:
        return json.loads(m.group(0))
    except Exception as e:
        return {"error": f"parse: {e}", "raw": text[:500]}


# =============================================================================
# Main pipeline
# =============================================================================


def build_research(candidate: dict) -> dict:
    """Build full research card for a single candidate."""
    ticker = candidate["ticker"]
    print(f"\n[research] {ticker} ({candidate.get('company','')})...")

    yf_data = yf_company_data(ticker)
    fin = load_financials_json(ticker)

    # Category B (auto, no LLM)
    cat_b = compute_category_b(candidate, fin)
    # Category D quantitative
    cat_d_quant = compute_category_d(candidate, yf_data)

    # SEC 10-K (US tickers only)
    sec_sections = {"business": "", "risk_factors": "", "mda": ""}
    market = candidate.get("market", "US")
    if market == "US":
        cik = sec_cik_lookup(ticker)
        if cik:
            filing = sec_latest_10k(cik)
            if filing:
                txt = sec_fetch_10k_text(filing)
                sec_sections = sec_extract_sections(txt)
                print(f"  10-K {filing['filing_date']}: business {len(sec_sections['business'])}, risk {len(sec_sections['risk_factors'])}, mda {len(sec_sections['mda'])} chars")
            else:
                print("  no 10-K found")
        else:
            print("  CIK not found")

    wiki = wiki_summary(yf_data.get("name", ""))

    # LLM sections — wrapped in try/except so missing key = template fallback
    cat_a: dict = {}
    cat_c: dict = {}
    cat_d_qual: dict = {}
    cat_e: dict = {}
    llm_status = "ok"
    # 15 RPM free-tier limit → 5s gap = 12 RPM (safe margin).
    # Also retry once on 429 with extra backoff.
    def _llm_with_retry(fn, *args, **kwargs):
        for attempt in range(3):
            try:
                return fn(*args, **kwargs)
            except LLMUnavailable as e:
                msg = str(e)
                retry_after = 30 if "429" in msg else 15
                if attempt == 2:
                    raise
                print(f"  [llm retry {attempt + 1}/3 after {retry_after}s] {e}")
                time.sleep(retry_after)
        raise LLMUnavailable("max retries exceeded")
    try:
        cat_a = _llm_with_retry(
            llm_section_a, ticker, yf_data, sec_sections["business"], wiki
        )
        time.sleep(7)  # 10 RPM limit on 2.5-flash free → 7s gap = ~8 RPM safe
        cat_c = _llm_with_retry(
            llm_section_c, ticker, yf_data, sec_sections["business"], sec_sections["mda"]
        )
        time.sleep(7)
        cat_d_qual = _llm_with_retry(
            llm_section_d_qualitative,
            ticker,
            yf_data,
            sec_sections["business"],
            sec_sections["mda"],
            cat_b,
            cat_d_quant,
        )
        time.sleep(7)
        cat_e = _llm_with_retry(llm_section_e, ticker, yf_data, sec_sections["risk_factors"])
    except LLMUnavailable as e:
        print(f"  [llm fallback] {e}")
        llm_status = f"unavailable: {e}"

    return {
        "ticker": ticker,
        "company": yf_data.get("name") or candidate.get("company", ""),
        "market": market,
        "sector": yf_data.get("sector") or candidate.get("sector", ""),
        "industry": yf_data.get("industry") or candidate.get("industry", ""),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "primary_passed": count_primary_passed(candidate.get("rules") or {}),
        "primary_total": len(PRIMARY_IDS),
        "llm_status": llm_status,
        "yf_metadata": {
            "market_cap": yf_data.get("market_cap"),
            "shares_outstanding": yf_data.get("shares_outstanding"),
            "employees": yf_data.get("employees"),
            "country": yf_data.get("country"),
            "website": yf_data.get("website"),
            "beta": yf_data.get("beta"),
        },
        "category_a_business": cat_a,
        "category_b_financials": cat_b,
        "category_c_market": cat_c,
        "category_d_thesis": {**cat_d_quant, **cat_d_qual},
        "category_e_risks": cat_e,
        "wikipedia_summary": wiki,
    }


def save_research(ticker: str, data: dict) -> Path:
    p = RESEARCH_DIR / f"{_safe(ticker)}.json"
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return p


def main(argv: list[str]) -> int:
    explicit = [a.upper() for a in argv if not a.startswith("-")]
    rows = load_results()

    if explicit:
        targets = [r for r in rows if r["ticker"].upper() in explicit]
        if not targets:
            # Allow research even if not in latest results (manual one-off)
            targets = [{"ticker": t, "rules": {}, "company": "", "market": "US"} for t in explicit]
    else:
        targets = select_qualifying(rows)
        print(f"Primary {PRIMARY_PASS_THRESHOLD}+ pass: {len(targets)} ticker(s)")

    if not targets:
        print("No qualifying candidates today.")
        return 0

    fresh_skip = 0
    written = 0
    for cand in targets:
        ticker = cand["ticker"]
        if not explicit and is_fresh(ticker):
            fresh_skip += 1
            continue
        try:
            data = build_research(cand)
            p = save_research(ticker, data)
            written += 1
            print(f"  → {p.relative_to(PROJ_DIR)}")
        except Exception as e:
            print(f"  [error] {ticker}: {e}")

    # Index file (lightweight summary for /research landing page)
    index = []
    for f in sorted(RESEARCH_DIR.glob("*.json")):
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
            index.append({
                "ticker": d.get("ticker"),
                "company": d.get("company"),
                "market": d.get("market"),
                "sector": d.get("sector"),
                "primary_passed": d.get("primary_passed"),
                "primary_total": d.get("primary_total"),
                "generated_at": d.get("generated_at"),
                "llm_status": d.get("llm_status"),
            })
        except Exception:
            pass
    (RESEARCH_DIR / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"\nDone: {written} written, {fresh_skip} skipped (fresh).")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

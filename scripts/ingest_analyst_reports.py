r"""
Analyst Report Ingestion -- extracts insights from sell-side PDFs and merges
them into the Company Research cards.

Source: filesystem directory (configurable via env REPORTS_DIR or --dir).
Default: \\10.227.31.220\backup\산업 2 - 엔터 JH\_기업분석 (Bloomberg downloads).

Pipeline per PDF:
  1. Parse filename → broker + ticker + title
  2. pdfplumber → text (first ~30 pages)
  3. Gemini call → structured JSON (Korean summary, catalysts, risks, PT, rating)
  4. Merge into web/public/data/research/<TICKER>.json under "analyst_reports" array

Idempotent - keyed by (filename, mtime). Skip if already ingested with same mtime.

Usage:
    python scripts/ingest_analyst_reports.py            # all reports
    python scripts/ingest_analyst_reports.py ECVT CAT   # only these tickers
    python scripts/ingest_analyst_reports.py --dir "D:/path/to/reports"
"""
from __future__ import annotations
import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import pdfplumber
import requests

# Force UTF-8 output on Windows cp949 consoles
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

PROJ_DIR = Path(__file__).parent.parent
RESEARCH_DIR = PROJ_DIR / "web" / "public" / "data" / "research"

DEFAULT_REPORTS_DIR = r"\\10.227.31.220\backup\산업 2 - 엔터 JH\_기업분석"

# Brokers we recognize (first 1-2 tokens of filename)
KNOWN_BROKERS = [
    "Mizuho Securities", "Mizuho",
    "Wells Fargo",
    "Deutsche Bank",
    "JP Morgan", "JPMorgan",
    "Barclays",
    "UBS",
    "Freedom Broker", "Freedom",
    "Financial AI",
    "Goldman Sachs", "Goldman",
    "Morgan Stanley",
    "BofA", "BAML",
    "Citi", "Citigroup",
    "Jefferies",
    "Bernstein",
    "Evercore", "Evercore ISI",
    "RBC", "Raymond James",
]


GEMINI_MODEL = "gemini-2.5-flash"
GEMINI_URL = (
    f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
)
# Groq fallback — free 14400 RPD (vs Gemini's 250 RPD), much higher headroom
GROQ_MODEL = "llama-3.3-70b-versatile"
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"


class LLMUnavailable(Exception):
    pass


def _gemini_call(prompt: str, max_output_tokens: int) -> str:
    api_key = (os.environ.get("GEMINI_API_KEY") or "").strip().lstrip("﻿")
    if not api_key:
        raise LLMUnavailable("GEMINI_API_KEY not set")
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": max_output_tokens,
        },
    }
    r = requests.post(
        GEMINI_URL,
        headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
        json=body,
        timeout=60,
    )
    if r.status_code == 429:
        raise LLMUnavailable("gemini rate-limited (429)")
    if r.status_code >= 400:
        raise LLMUnavailable(f"gemini http {r.status_code}")
    j = r.json()
    cands = j.get("candidates") or []
    if not cands:
        raise LLMUnavailable("gemini no candidates")
    parts = cands[0].get("content", {}).get("parts") or []
    text = "".join(p.get("text", "") for p in parts)
    if not text.strip():
        raise LLMUnavailable("gemini empty response")
    return text


def _groq_call(prompt: str, max_output_tokens: int) -> str:
    api_key = (os.environ.get("GROQ_API_KEY") or "").strip().lstrip("﻿")
    if not api_key:
        raise LLMUnavailable("GROQ_API_KEY not set")
    body = {
        "model": GROQ_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.2,
        "max_tokens": max_output_tokens,
        "response_format": {"type": "json_object"},
    }
    r = requests.post(
        GROQ_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=body,
        timeout=60,
    )
    if r.status_code == 429:
        raise LLMUnavailable("groq rate-limited (429)")
    if r.status_code >= 400:
        raise LLMUnavailable(f"groq http {r.status_code}: {r.text[:200]}")
    j = r.json()
    choices = j.get("choices") or []
    if not choices:
        raise LLMUnavailable("groq no choices")
    return choices[0].get("message", {}).get("content", "")


def gemini_call(prompt: str, max_output_tokens: int = 1500) -> str:
    """Try Gemini first, fall back to Groq if unavailable. Both are free tiers."""
    try:
        return _gemini_call(prompt, max_output_tokens)
    except LLMUnavailable as e:
        # Only fall back when Gemini quota/availability fails — not for missing key
        # if Groq key also missing (re-raise the Gemini error).
        if not os.environ.get("GROQ_API_KEY"):
            raise
        print(f"  [gemini -> groq fallback] {e}")
        return _groq_call(prompt, max_output_tokens)


def parse_filename(name: str) -> dict | None:
    """
    Extract {broker, ticker, title} from filename.

    Examples:
      "JP Morgan CAT Caterpillar Inc. 1Q26 Alert..."
      → broker="JP Morgan", ticker="CAT", title="Caterpillar Inc. 1Q26 Alert..."

      "Freedom Broker CAT-US CAT Demonstrating..."
      → broker="Freedom Broker", ticker="CAT", title="CAT Demonstrating..."

      "Mizuho Securities AMZN 1Q26 Ecommerce Preview..."
      → broker="Mizuho Securities", ticker="AMZN", title="1Q26 Ecommerce Preview..."
    """
    stem = Path(name).stem
    matched_broker = None
    rest = stem
    # Try longest broker names first
    for b in sorted(KNOWN_BROKERS, key=len, reverse=True):
        if stem.startswith(b + " "):
            matched_broker = b
            rest = stem[len(b) + 1:]
            break
    if not matched_broker:
        return None
    # Next token = ticker (uppercase 1-5 chars, optional -US suffix)
    m = re.match(r"^([A-Z]{1,5})(?:-US)?\s+(.*)$", rest)
    if not m:
        return None
    ticker = m.group(1)
    title = m.group(2).strip()
    return {"broker": matched_broker, "ticker": ticker, "title": title}


def extract_pdf_text(path: Path, max_pages: int = 30, max_chars: int = 60_000) -> str:
    try:
        with pdfplumber.open(path) as pdf:
            chunks = []
            for i, page in enumerate(pdf.pages):
                if i >= max_pages:
                    break
                try:
                    t = page.extract_text() or ""
                except Exception:
                    t = ""
                if t:
                    chunks.append(t)
            text = "\n".join(chunks)
    except Exception as e:
        print(f"  [pdf err] {path.name}: {e}")
        return ""
    # Collapse whitespace, truncate
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text[:max_chars]


REPORT_PROMPT = """Sell-side analyst report 분석. 핵심을 한국어로 추출.

[메타]
브로커: {broker}
티커: {ticker}
제목: {title}

[리포트 본문 (앞 {n_chars}자)]
{text}

다음 JSON 스키마로만 응답 (한국어). 파일 본문에 명시된 내용만 사용 - 추측 금지.
필드 없으면 빈 문자열 또는 빈 배열.

{{
  "summary": "리포트 핵심 1~2문장 (60자 이내씩, 명사형 종결)",
  "rating": "BUY/HOLD/SELL/Outperform/Neutral/Underperform/N/A",
  "price_target": "$X.XX 또는 N/A",
  "prior_price_target": "직전 PT (있으면) 또는 빈 문자열",
  "thesis": ["핵심 투자 논거 3~5개 (각 50자 이내)"],
  "catalysts": ["향후 주요 이벤트·드라이버 2~4개"],
  "risks": ["리스크 2~4개"],
  "key_numbers": ["언급된 핵심 수치 2~4개 (예: '1Q26 EPS $1.23, 컨센 $1.10 대비 +12%')"],
  "report_date": "YYYY-MM-DD 또는 'YYYY-MM' 또는 빈 문자열 (본문에서 식별 가능 시)"
}}

JSON만 반환. 코드펜스·전후설명 금지."""


def _parse_json_response(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"```\s*$", "", text)
    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        return {"_error": "no json", "_raw": text[:300]}
    try:
        return json.loads(m.group(0))
    except Exception as e:
        return {"_error": f"parse: {e}", "_raw": text[:300]}


def analyze_report(parsed: dict, text: str) -> dict:
    if not text:
        return {"_error": "empty pdf text"}
    prompt = REPORT_PROMPT.format(
        broker=parsed["broker"],
        ticker=parsed["ticker"],
        title=parsed["title"],
        n_chars=len(text),
        text=text,
    )
    raw = gemini_call(prompt, max_output_tokens=1800)
    return _parse_json_response(raw)


def merge_into_research(ticker: str, report_entry: dict) -> bool:
    """Append report_entry to research/<TICKER>.json under analyst_reports.
    Dedup by source_filename. Returns True if file changed."""
    safe = ticker.replace(".", "_")
    p = RESEARCH_DIR / f"{safe}.json"
    if not p.exists():
        # Create minimal stub so the report still surfaces in /research/<T>
        stub = {
            "ticker": ticker,
            "company": "",
            "market": "US",
            "sector": "",
            "industry": "",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "primary_passed": 0,
            "primary_total": 14,
            "llm_status": "report-only",
            "yf_metadata": {},
            "category_a_business": {},
            "category_b_financials": {},
            "category_c_market": {},
            "category_d_thesis": {},
            "category_e_risks": {},
            "analyst_reports": [],
        }
        p.write_text(json.dumps(stub, ensure_ascii=False, indent=2), encoding="utf-8")
    data = json.loads(p.read_text(encoding="utf-8"))
    reports = data.get("analyst_reports") or []
    fname = report_entry.get("source_filename")
    # Replace existing entry with same filename
    reports = [r for r in reports if r.get("source_filename") != fname]
    reports.append(report_entry)
    # Sort newest first by ingested_at
    reports.sort(key=lambda r: r.get("ingested_at", ""), reverse=True)
    data["analyst_reports"] = reports
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return True


def is_already_ingested(ticker: str, fname: str, mtime: float) -> bool:
    safe = ticker.replace(".", "_")
    p = RESEARCH_DIR / f"{safe}.json"
    if not p.exists():
        return False
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return False
    for r in data.get("analyst_reports") or []:
        if r.get("source_filename") == fname and abs(r.get("source_mtime", 0) - mtime) < 1:
            return True
    return False


def update_index() -> None:
    """Refresh web/public/data/research/index.json from current files."""
    index = []
    for f in sorted(RESEARCH_DIR.glob("*.json")):
        if f.name == "index.json":
            continue
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
                "report_count": len(d.get("analyst_reports") or []),
            })
        except Exception:
            pass
    (RESEARCH_DIR / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("tickers", nargs="*", help="Only ingest reports for these tickers")
    ap.add_argument("--dir", default=os.environ.get("REPORTS_DIR", DEFAULT_REPORTS_DIR))
    ap.add_argument("--force", action="store_true", help="Re-ingest even if mtime unchanged")
    ap.add_argument("--dry-run", action="store_true", help="Parse + extract but skip LLM call")
    args = ap.parse_args(argv)

    src = Path(args.dir)
    if not src.exists():
        print(f"[err] reports directory not found: {src}")
        return 1

    pdfs = sorted(src.glob("*.pdf"))
    print(f"Found {len(pdfs)} PDFs in {src}")

    target_tickers = {t.upper() for t in args.tickers} or None

    processed = 0
    skipped_unparsed = 0
    skipped_filtered = 0
    skipped_fresh = 0
    failed_llm = 0

    for pdf in pdfs:
        parsed = parse_filename(pdf.name)
        if not parsed:
            print(f"  [skip-unparsed] {pdf.name}")
            skipped_unparsed += 1
            continue
        ticker = parsed["ticker"]
        if target_tickers and ticker not in target_tickers:
            skipped_filtered += 1
            continue
        mtime = pdf.stat().st_mtime
        if not args.force and is_already_ingested(ticker, pdf.name, mtime):
            skipped_fresh += 1
            continue

        print(f"\n[{ticker}] {parsed['broker']} - {parsed['title'][:60]}...")
        text = extract_pdf_text(pdf)
        if not text:
            print(f"  [skip-emptytext]")
            continue
        print(f"  pdf text: {len(text)} chars")

        if args.dry_run:
            print(f"  [dry-run] would call LLM")
            continue

        try:
            analysis = analyze_report(parsed, text)
        except LLMUnavailable as e:
            print(f"  [llm err] {e}")
            failed_llm += 1
            time.sleep(8)
            continue

        if analysis.get("_error"):
            print(f"  [llm parse err] {analysis['_error']}")
            failed_llm += 1
            continue

        report_entry = {
            "source_filename": pdf.name,
            "source_broker": parsed["broker"],
            "source_title": parsed["title"],
            "source_mtime": mtime,
            "ingested_at": datetime.now(timezone.utc).isoformat(),
            **analysis,
        }
        merge_into_research(ticker, report_entry)
        processed += 1
        print(f"  → research/{ticker}.json updated (rating={analysis.get('rating')}, PT={analysis.get('price_target')})")
        # 7s gap respects 10 RPM free-tier
        time.sleep(7)

    update_index()

    print(f"\n=== Summary ===")
    print(f"Processed:        {processed}")
    print(f"Skipped (fresh):  {skipped_fresh}")
    print(f"Skipped (other ticker): {skipped_filtered}")
    print(f"Skipped (parse fail):   {skipped_unparsed}")
    print(f"Failed (LLM):     {failed_llm}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

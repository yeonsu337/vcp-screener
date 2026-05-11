"""
Translate existing research cards (web/public/data/research/*.json) to Korean.

Older cards were generated when company_research.py emitted English output.
The current prompt asks for Korean, so all NEW cards arrive in Korean — but
the back-catalog still mixes languages. This one-shot script walks every
research file, detects English prose fields, and translates them in-place.

Strategy:
  - Use deep-translator's GoogleTranslator (free, no API key, web-scrape based).
  - Falls back to Gemini API if GEMINI_API_KEY is set (better fidelity).
  - Skip technical fields (ticker, sector, industry, currency codes, etc).
  - Skip already-Korean strings (heuristic: ≥10% Hangul codepoints).
  - Idempotent: re-running on a Korean file is a no-op.

Usage:
    python scripts/translate_research.py            # all files
    python scripts/translate_research.py CRS ECVT   # specific tickers
"""
from __future__ import annotations
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

PROJ_DIR = Path(__file__).parent.parent
RESEARCH_DIR = PROJ_DIR / "web" / "public" / "data" / "research"

# Field paths to translate (dotted JSON pointers, * = list element).
# yf_metadata + ticker/sector/industry/wikipedia_summary intentionally NOT translated.
TRANSLATE_FIELDS = [
    "category_a_business.overview",
    "category_a_business.business_model",
    "category_a_business.value_chain_position",
    "category_a_business.key_customers",
    "category_a_business.products.*",
    "category_a_business.channels.*",
    "category_a_business.milestones.*",
    "category_a_business.revenue_streams.*",
    "category_a_business.wikipedia_excerpt",
    "category_c_market.tam_estimate_usd_b",
    "category_c_market.tam_cagr_pct",
    "category_c_market.market_share_pct",
    "category_c_market.growth_drivers.*",
    "category_c_market.competitors.*.differentiation",
    "category_c_market.porter_five_forces.new_entrants",
    "category_c_market.porter_five_forces.substitutes",
    "category_c_market.porter_five_forces.buyer_power",
    "category_c_market.porter_five_forces.supplier_power",
    "category_c_market.porter_five_forces.rivalry",
    "category_c_market.competitive_advantages.*",
    "category_c_market.competitive_weaknesses.*",
    "category_d_thesis.moat_evidence.*",
    "category_d_thesis.moat_durability_years",
    "category_d_thesis.new_trigger",
    "category_d_thesis.bull_case",
    "category_d_thesis.base_case",
    "category_d_thesis.bear_case",
    "category_d_thesis.key_metrics_to_watch.*",
    "category_e_risks.top_risks.*.description",
    "category_e_risks.inversion_scenarios.*",
    "category_e_risks.exit_signals.*",
]


def is_korean(text: str) -> bool:
    """Heuristic: 10%+ Hangul codepoints means already Korean."""
    if not text or len(text) < 4:
        return True  # too short to translate meaningfully
    hangul = sum(1 for c in text if "가" <= c <= "힣")
    return hangul / len(text) >= 0.10


def looks_translatable(text: str) -> bool:
    """Skip pure-numeric, pure-symbol, or already-Korean strings."""
    if not isinstance(text, str):
        return False
    text = text.strip()
    if len(text) < 4:
        return False
    if is_korean(text):
        return False
    # Skip if looks like a number/percentage/dash
    if re.fullmatch(r"[\d\.\-+%, ]+", text):
        return False
    if text in ("—", "-", "—", "N/A", "n/a", "None"):
        return False
    return True


# =============================================================================
# Translator backends
# =============================================================================
class Translator:
    def translate(self, text: str) -> str:
        raise NotImplementedError


class GoogleWebTranslator(Translator):
    """deep-translator's GoogleTranslator — free, no API key, web-scrape based."""

    def __init__(self):
        from deep_translator import GoogleTranslator
        self._gt = GoogleTranslator(source="en", target="ko")

    def translate(self, text: str) -> str:
        # Google web limit: ~5000 chars per call. Chunk if needed.
        if len(text) <= 4500:
            return self._gt.translate(text) or text
        chunks = []
        # Split on sentence boundary near 4000 chars.
        i = 0
        while i < len(text):
            j = min(i + 4000, len(text))
            if j < len(text):
                # Find nearest sentence end.
                end = text.rfind(". ", i, j)
                if end > i + 1000:
                    j = end + 1
            chunk = text[i:j]
            try:
                chunks.append(self._gt.translate(chunk) or chunk)
            except Exception as e:
                print(f"    [chunk fail] {e}")
                chunks.append(chunk)
            i = j
        return "".join(chunks)


class GeminiTranslator(Translator):
    """Use Gemini 2.5-flash for higher-fidelity translation when key is available."""

    def __init__(self, api_key: str):
        import requests
        self._requests = requests
        self._key = api_key
        self._url = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            "gemini-2.5-flash:generateContent"
        )

    def translate(self, text: str) -> str:
        prompt = (
            "다음 영어 텍스트를 한국어로 자연스럽게 번역하세요. "
            "투자 리서치 톤 유지, 업계 약어(ROE, EPS, EBITDA 등)는 원문 유지. "
            "번역 결과만 출력하세요. 원문:\n\n" + text
        )
        body = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": 0.1,
                "maxOutputTokens": 1500,
                "thinkingConfig": {"thinkingBudget": 0},
            },
        }
        r = self._requests.post(
            self._url,
            json=body,
            headers={
                "Content-Type": "application/json",
                "x-goog-api-key": self._key,
            },
            timeout=45,
        )
        if r.status_code != 200:
            raise RuntimeError(f"gemini {r.status_code}: {r.text[:120]}")
        data = r.json()
        return data["candidates"][0]["content"]["parts"][0]["text"].strip()


def make_translator() -> Translator:
    key = os.environ.get("GEMINI_API_KEY")
    if key:
        try:
            print("[translator] Gemini API (high fidelity)")
            return GeminiTranslator(key)
        except Exception as e:
            print(f"[translator] Gemini init failed ({e}) -- falling back to Google web")
    print("[translator] Google web (deep-translator, free)")
    return GoogleWebTranslator()


# =============================================================================
# JSON path traversal
# =============================================================================
def _get_paths(obj: Any, prefix: str = "") -> list[tuple[str, str]]:
    """Yield (path, value) for every string leaf — used for diagnostics only."""
    out: list[tuple[str, str]] = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            out.extend(_get_paths(v, f"{prefix}.{k}" if prefix else k))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            out.extend(_get_paths(v, f"{prefix}.[{i}]"))
    elif isinstance(obj, str):
        out.append((prefix, obj))
    return out


def _walk_set(obj: Any, parts: list[str], fn) -> None:
    """Walk dotted path with `*` wildcard for lists, applying fn to leaf strings."""
    if not parts:
        return
    head, rest = parts[0], parts[1:]
    if head == "*":
        if not isinstance(obj, list):
            return
        for i, v in enumerate(obj):
            if not rest:
                if isinstance(v, str):
                    obj[i] = fn(v)
            else:
                _walk_set(v, rest, fn)
        return
    if isinstance(obj, dict):
        if head not in obj:
            return
        if not rest:
            v = obj[head]
            if isinstance(v, str):
                obj[head] = fn(v)
            elif isinstance(v, list):
                obj[head] = [fn(x) if isinstance(x, str) else x for x in v]
        else:
            _walk_set(obj[head], rest, fn)


# =============================================================================
# Main
# =============================================================================
def translate_file(path: Path, t: Translator) -> tuple[int, int]:
    data = json.loads(path.read_text(encoding="utf-8"))
    translated = 0
    skipped = 0

    def _do(s: str) -> str:
        nonlocal translated, skipped
        if not looks_translatable(s):
            skipped += 1
            return s
        try:
            out = t.translate(s)
            translated += 1
            time.sleep(0.4)  # gentle throttle to avoid Google web rate-limit
            return out
        except Exception as e:
            print(f"    [fail] {e} -- keeping original")
            return s

    for field_path in TRANSLATE_FIELDS:
        _walk_set(data, field_path.split("."), _do)

    # Mark translation pass for traceability.
    data["translated_at"] = data.get("translated_at") or {}
    if not isinstance(data["translated_at"], dict):
        data["translated_at"] = {}
    from datetime import datetime, timezone
    data["translated_at"][type(t).__name__] = datetime.now(timezone.utc).isoformat()

    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return translated, skipped


def main(argv: list[str]) -> int:
    explicit = [a.upper() for a in argv if not a.startswith("-")]
    if explicit:
        files = [RESEARCH_DIR / f"{t}.json" for t in explicit]
        files = [p for p in files if p.exists()]
    else:
        files = sorted(p for p in RESEARCH_DIR.glob("*.json") if p.name != "index.json")

    if not files:
        print("No research files to translate.")
        return 0

    t = make_translator()
    print(f"Translating {len(files)} file(s)...")
    total_t, total_s = 0, 0
    for f in files:
        print(f"\n[{f.stem}]")
        try:
            tr, sk = translate_file(f, t)
            total_t += tr
            total_s += sk
            print(f"  translated {tr}, skipped (already KR / non-translatable) {sk}")
        except Exception as e:
            print(f"  [error] {e}")
    print(f"\nDone: {total_t} fields translated, {total_s} skipped across {len(files)} files.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

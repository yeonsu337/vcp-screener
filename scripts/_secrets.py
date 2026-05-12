"""Utility — bulletproof API key sanitizer.

GitHub Actions environment variables can carry stray BOM bytes (UTF-8/16),
zero-width unicode chars, or whitespace from the secret's source. These
break latin-1 HTTP header encoding (which API keys ride on) and yield
opaque "network error '\\ufeff'" failures.

clean_api_key strips everything that isn't ASCII-printable (0x21-0x7E)
— covers UTF-8 BOM (0xFEFF), zero-width chars (0x200B-0x200D), all
whitespace (0x09-0x20), control chars (0x00-0x1F, 0x7F), and any non-
ASCII. API keys are always ASCII so this is safe and bulletproof against
future BOM regressions at the secret-storage layer.
"""
from __future__ import annotations
import os


def clean_api_key(env_name: str) -> str:
    """Return ASCII-printable-only API key from env var, '' if unset.

    Pipeline (defense in depth):
      1. utf-8-sig decode strips leading UTF-8 BOM (0xEF 0xBB 0xBF) bytes
         if the runtime exposed them as escaped chars.
      2. ASCII-printable filter (0x21-0x7E) removes any remaining BOM
         (0xFEFF), zero-width chars, whitespace, control chars, and
         non-ASCII garbage.

    Keeps the standard API-key alphabet [A-Za-z0-9._\\-~] intact.
    """
    raw = os.environ.get(env_name) or ""
    try:
        raw = raw.encode("utf-8", errors="replace").decode(
            "utf-8-sig", errors="replace"
        )
    except Exception:
        pass
    return "".join(c for c in raw if 0x21 <= ord(c) <= 0x7E)

# KR Universe Drop Analysis (2026-05-14)

## Symptom

KR market candidate count dropped 179 → 63 (-65%) overnight between
2026-05-13 and 2026-05-14 scheduled cron runs. HK and US showed minor
fluctuation (US -10%, HK -16%) while KR collapsed.

## Diagnostic Evidence

| Metric | 5/13 cron | 5/14 dispatch | Δ |
|---|---|---|---|
| KR total | 179 | 63 | -116 (-65%) |
| KR Stage 2 candidates | ~170 | 56 | -114 |
| Dropped KR tickers | — | 129 | — |
| Added KR tickers | — | 13 | — |
| Pipeline runtime | 1021s | 1330s | +30% |

### Dropped Ticker Profile

121 / 129 dropped tickers were **Stage 2** (uptrend) on 5/13 with healthy
RS Ratings:

| Ticker | Company | 5/13 RS | 5/13 v1 Score |
|---|---|---|---|
| 011070.KS | LG이노텍 | 96 | 74 |
| 010120.KS | LS ELECTRIC | 97 | 65 |
| 007810.KS | 코리아써키트 | 98 | 67 |
| 034730.KS | SK | 91 | 70 |
| 008060.KS | 대덕 | 90 | 82 |
| 189300.KQ | 인텔리안테크 | 94 | 84 |
| 160980.KQ | 싸이맥스 | 90 | 74 |
| 086790.KS | 하나금융지주 | 72 | 74 |
| 950160.KQ | 코오롱티슈진 | 91 | 68 |
| 356860.KQ | 티엘비 | 92 | 66 |

These are not "stocks that legitimately broke trend overnight" — they
include blue-chip large caps with RS in the 90s. A single trading day
cannot produce this scale of legitimate Trend Template failures.

## Root Cause

**yfinance KR batch download rate-limiting / partial failure.**

Evidence:
1. Pipeline runtime increased 30% (1021 → 1330 sec) — consistent with
   retry/backoff behavior under rate limits
2. Stage 2 distribution of dropped tickers (121 / 129 = 94%) — random
   sampling would not target Stage 2 specifically; failure is at the
   OHLCV fetch level, not the analysis level
3. Tickers can't be evaluated (no price data) → dropped from `results`
   silently
4. KR uses `.KS` / `.KQ` suffixes via Yahoo — historically more flaky
   than US tickers

## Impact

- KR `meta.markets.KR.total` unreliable as universe size
- Composite v2 ranking for KR market unaffected (the surviving 63 are
  still scored correctly), but `detected` count is degraded
- Soft-gate Primary 12+ pipeline misses real KR candidates
- Minervini bot calls for missing KR tickers stop updating until they
  re-enter the universe

## Mitigation Options

| # | Approach | Risk | Effort |
|---|---|---|---|
| 1 | Wait & monitor — next cron may self-heal | 🟢 Low | 0 |
| 2 | Increase yfinance retry count + jittered backoff | 🟡 Med | 30min |
| 3 | Switch KR OHLCV to FinanceDataReader direct (skip yfinance) | 🟡 Med | 1h |
| 4 | Cache prior day's OHLCV → fallback when fetch fails | 🟢 Low | 45min |

**Current decision**: Option 1 (monitor 3 cron cycles). If pattern
persists, escalate to Option 4 (cache fallback) — preserves universe
continuity without rewriting the KR pipeline.

## Tracking

Compare KR `total` across the next 3 scheduled cron runs:
- 5/14 23:00 UTC (today's scheduled, post Phase 2-2 deploy)
- 5/15 23:00 UTC
- 5/16 not scheduled (Saturday)
- 5/18 23:00 UTC (Monday)

If KR total stays < 100 across 3 runs → escalate to Option 4.

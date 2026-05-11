# VCP Screener — Rule Governance

운영 룰의 안정성을 확보하기 위한 변경 정책 + 변경 이력.

---

## Rule Lock-in Policy (90-day window)

룰 변경 후 **최소 90일 동안 동결**한다. 이유:

1. **백테스트 표본 누적**: 단일 변경의 효과를 판별하려면 30+ 거래 표본 필요. 현재 일별 검출 0-15건 → 90일이면 100건 안팎 누적
2. **변수 격리**: 동시 다중 변경 시 어느 변경이 효과를 냈는지 인과 분리 불가
3. **데이터 리셋 효과**: 룰 변경 시점 이전 백테스트 결과는 새 룰셋에 무의미 → 매 변경마다 baseline 재시작

### 변경 절차

1. **제안**: `Tasks/inbox/` 또는 GitHub Issue에 변경안 + 근거 (백테스트 수치 또는 기준일 시뮬레이션)
2. **얼라인**: 영향받는 PRIMARY/SECONDARY 분류, 임계, 종속 파일(8개 PRIMARY_IDS 리스트, threshold) 전체 영향 분석
3. **단일 commit으로 배포** + `RULES.md` 변경 이력 append
4. **다음 변경은 90일 후** (긴급 버그 fix 제외 — 단, 룰 의미를 바꾸는 변경은 동결 대상)

### 동결 예외 (긴급 변경 허용)

- 데이터 소스 변경으로 인한 룰 데이터 부재 (예: yfinance가 ROE 필드명 변경)
- 명백한 코드 버그 (논리 오류, 임계 입력 실수)
- Universe 정제 (delisted 종목 제거 등) — 룰 자체가 아닌 입력 데이터 변경

---

## 변경 이력

| 일자 | 변경 | 적용 ID·임계 | 영향 | 다음 동결 해제 |
|---|---|---|---|---|
| 2026-05-11 | P6 Primary → Secondary 강등 | `P6_monotonic_decreasing` PRIMARY_IDS 리스트 8곳에서 제거, RuleScorecard/ScreenerTable에서 SECONDARY로 이동. 임계(0.75) 불변 | US 11종 신규 12+/13 후보 부상 (KEYS, MLI, VRT, MTZ, YOU, THR, PWR, JBL, OII, WT, MD) | 2026-08-09 |
| 2026-05-11 | MD2 임계 완화 | `_consecutive_rising(days=18)`, threshold 20.0 → 17.0, 표시명 "rising 17d" | US gate 5/8 18/17 → 즉시 PASS (이전 17/20 FAIL) | 2026-08-09 |
| 2026-05-05 | 14 Primary 룰 overhaul (commit 645c688) | A1/B1-7/R1/L1/P6/E7/F1/H4 14개 Primary 신정의 | 직후 검출 0건 (P6 99% cutoff) | (해제 완료) |

---

## 현 Primary 룰 (13개, 2026-05-11 기준)

| ID | 룰 | 임계 | 카테고리 |
|---|---|---|---|
| A1 | U/D Vol Ratio | ≥ 1.0 | 수급 |
| B1 | Price > 150d & 200d SMA | — | 추세 |
| B2 | 150d SMA > 200d SMA | — | 추세 |
| B3 | 50d SMA > 150d & 200d SMA | — | 추세 |
| B4 | Price > 50d SMA | — | 추세 |
| B5 | 200d SMA 5개월 상승 | — | 추세 |
| B6 | Price ≥ 30% above 52w low | 30% | 추세 |
| B7 | Price within 25% of 52w high | 25% | 추세 |
| R1 | RS Rating | ≥ 70 | 상대강도 |
| L1 | Liquidity Gate (시장별) | 시장별 | 유동성 |
| E7 | ROE (US only) | ≥ 17% | 수익성 |
| F1 | 1Y outperform NASDAQ (US only) | > 0 | 상대성과 |
| H4 | 3Y NI CAGR (US only) | ≥ 25% | 성장 |

Primary Pass Threshold: **12 of 13** (≈ 92% pass rate 요구)

## 현 Market Direction 룰

| ID | 룰 | 임계 |
|---|---|---|
| MD1 | Index SMA21 > SMA50 | ratio > 1.0 |
| MD2 | Index 50d SMA 연속 상승 | **17일** (2026-05-11 변경, 이전 20일) |

Gate Pass = MD1 ∧ MD2 모두 PASS.

## P6 (Bonus)

`P6_monotonic_decreasing` (연속 수축 ≤ 0.75× prior)는 Primary에서 제외되었으나 Secondary/Bonus 룰로 유지. VCP Quality Score (api/search/route.ts:805) 계산에는 +25점 가산 그대로 유지.

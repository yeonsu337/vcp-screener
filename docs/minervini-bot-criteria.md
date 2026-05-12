# Minervini Bot — 기준 및 매수·매도 판단 근거 (v1.2)

> Mark Minervini의 SEPA(Specific Entry Point Analysis) + VCP(Volatility Contraction Pattern) + Trend Template 프레임을 기반으로 한 결정 엔진. 종목 상세 페이지에 표시되는 한국어 4~5줄 매매 권고를 자동 생성.
>
> **본 문서**: 봇이 어떤 룰로 어떤 판단을 내리는지 한 곳에 정리. 상세 페르소나 정의는 `minervini-bot-persona.md` 참조.
> **v1.2 갱신**: 2026-05-12 — STOP_OUT 통합, soft-gate 룰 추가, EX6 20일로 완화.

---

## 1. 작동 흐름 (한 페이지 요약)

```
[daily cron]
   │
   ▼
1. results.json (455 종목 룰 평가) ─────┐
   │                                    │
2. macro.json (시장 regime: F&G 기반)   │
   │                                    │
3. detection_history.json (보유 종목) ─┘
   │
   ▼
4. STOP_OUT 우선 패스
   - 보유 종목 (exited=false) 중 -8% 또는 trailing -15% 발화 시 청산 권고
   │
   ▼
5. 후보 필터 — Primary ≥ 12 OR detected
   - 총 13개 Primary 룰 중 12개 이상 통과한 종목만 봇 대상
   │
   ▼
6. 5단계 verdict 분류 (각 종목)
   - BUY_NOW · BUY_AT_PIVOT · WATCH · EXTENDED · AVOID
   │
   ▼
7. 한국어 4~5줄 권고문 생성 (template)
   - entry / stop / target 가격 자동 계산
   │
   ▼
8. web/public/data/minervini-bot/<ticker>.json (Vercel static)
   │
   ▼
9. /screener/[ticker] + /minervini 페이지에 표시
```

---

## 2. 판단 근거 (5단계 verdict)

### 2-1. 우선순위 결정 로직

봇은 아래 순서로 verdict를 결정. 첫 매칭에서 확정.

| 순위 | 조건 | Verdict | 설명 |
|---|---|---|---|
| **0** | 보유 종목 진입가 대비 -8% 도달 | **STOP_OUT** | Minervini ironclad 손절. 협의 불가 |
| **0** | 보유 종목 peak +10% 이후 -15% 후퇴 | **STOP_OUT** | EX5 trailing — 이익 보호 |
| **1** | TT ≤ 6/8 OR Stage ≠ 2 OR RS < 70 | **AVOID** | 추세 미형성 — 매수 자체 부적격 |
| **2** | pct_to_pivot > +5% | **EXTENDED** | Pivot 대비 5% 초과 — 추격 위험 |
| **3** | VCP < 4/8 OR pct_to_pivot < -5% | **WATCH** | 추세는 있으나 setup 미숙성 |
| **4** | 0% ≤ pct_to_pivot ≤ +3% | **BUY_NOW** | Buy zone — 즉시 매수 |
| **5** | -5% ≤ pct_to_pivot < 0% | **BUY_AT_PIVOT** | 매수 대기 — Pivot 돌파 시 진입 |
| **6** | else (예: +3% < pct ≤ +5%) | **WATCH** | Buy zone 경계 — 신중 |

### 2-2. 각 verdict 상세

#### **BUY_NOW** — 즉시 매수
- **조건**: Trend Template 8/8 통과 (혹은 7/8) + Stage 2 + RS ≥ 70 + VCP quality ≥ 4 + pct_to_pivot 0 ~ +3%
- **권고**: 현재가에 매수, -7% 손절, +20% 절반 익절, 이후 50일선 trailing
- **예시**: KEYS (pct 0.65, TT 8/8, VCP 4/8, RS 91)

#### **BUY_AT_PIVOT** — 매수 대기
- **조건**: 동일 (BUY_NOW) + pct_to_pivot -5% ~ 0%
- **권고**: Pivot price 돌파 시 매수 (지정가/조건부 주문)
- **예시**: MLI (pct -1.37, TT 8/8, RS 78)

#### **WATCH** — 관망
- **조건**: 추세는 살아있으나 VCP < 4/8 (수축 미숙) 또는 pct < -5% (Pivot 멀어짐)
- **권고**: Setup 재형성 대기. 수축 ≥ 3회 + 마지막 ≤ 6.5% + VDU ≤ 0.6× 충족 시 재평가
- **예시**: VRT (RS 94지만 VCP 3/8)

#### **EXTENDED** — 추격 위험
- **조건**: pct_to_pivot > +5% — buy zone 초과
- **권고**: 신규 진입 보류. 다음 수축 형성 대기
- **예시**: MTZ (pct +25.43, TT 8/8, RS 93)

#### **AVOID** — 회피
- **조건**: TT ≤ 6/8 또는 Stage ≠ 2 또는 RS < 70 중 하나라도
- **권고**: 신호 없음. 다른 종목 우선

#### **STOP_OUT** — 청산
- **조건**: 보유 중인 종목이 진입가 대비 -8% (EX1) 또는 peak -15% trailing (EX5) 발화
- **권고**: 전량 청산. 협의 불가. 손실 누적 금지

---

## 3. 기준 룰 (Primary Gate, v1.2 — 시장별 분기)

봇이 후보로 받기 위한 최소 통과 룰. **v1.2부터 시장별 게이트**:

| 시장 | 평가 룰 수 | 통과 기준 | 제외 룰 |
|---|---|---|---|
| **US** | 13개 | ≥ 12/13 (~92%) | — |
| **KR / HK** | 10개 | ≥ 9/10 (~90%) | E7, F1, H4 (yfinance 비-US fundamentals 데이터 부재) |

**13개 Primary 룰 정의**:

| ID | 룰명 | 임계값 | Minervini 근거 | 비-US 적용 |
|---|---|---|---|---|
| `A1_ud_vol_ratio` | U/D Volume Ratio (50d) | ≥ 1.0 | 매수세 > 매도세 (Wyckoff/Weinstein) | ✓ |
| `B1_price_above_150_200` | 현재가 > SMA150 & SMA200 | — | Trend Template #1 | ✓ |
| `B2_sma150_gt_sma200` | SMA150 > SMA200 | — | TT #2 | ✓ |
| `B3_sma50_gt_150_200` | SMA50 > SMA150 & SMA200 | — | TT #4 | ✓ |
| `B4_price_above_sma50` | 현재가 > SMA50 | — | TT #5 | ✓ |
| `B5_sma200_rising_5mo` | SMA200 5개월 이상 상승 | — | TT #3 (Minervini: 1개월 최소, 4~5개월 이상적; **우리 5개월은 외부 합의 대비 과엄격 — v1.3 완화 검토**) | ✓ |
| `B6_30pct_above_52w_low` | 52W 저점 대비 +30% 이상 | — | TT #6 | ✓ |
| `B7_within_25pct_high` | 52W 고점 대비 -25% 이내 | — | TT #7 | ✓ |
| `R1_rs_70` | RS Rating ≥ 70 | — | TT #8 (이상적 80~90+) | ✓ |
| `L1_liquidity_gate` | 유동성 임계 | — | 거래 가능 종목 필터 | ✓ |
| `E7_roe` | ROE ≥ 17% | — | 펀더멘털 보강 (Minervini 책 명시) | ✗ (US만) |
| `F1_outperform_1y` | 1년 NASDAQ 대비 outperform | — | Relative strength 확인 (우리 자체 추가 — Minervini 책에는 없음) | ✗ (US만) |
| `H4_ni_cagr_3y` | 순이익 3년 CAGR | ≥ 25% | CANSLIM Catalyst 확인 | ✗ (US만) |

> **Soft-gate** (T2): 위 게이트 통과 + Stage 2 + RS ≥ 70 시 detection_history에서 last_seen 유지 (EX6 false-exit 방지). v1.2 추가.

### 3-1. 외부 미너비니 스크리너 vs 우리 봇 (v1.2 비교 — Task B 결과 요약)

**우리만의 강점** (외부 10개 구현 중 0~2개만 채택):
- **5단 verdict + pct_to_pivot zone** 분류 (외부 0건 — 대부분 "후보" 단일 플래그)
- **A1 U/D Volume Ratio** Primary (외부 2건만)
- **F1/F2/F3 NASDAQ 대비 outperform** (외부 0건 — Minervini 책 미명시, 우리 자체 추가)
- **P1~P6 6단 정량 VCP** (외부 정량화는 P1·P3 정도만)
- **L1~L4 4단 유동성** (외부 1단 평균거래량만)

**정설(Universal) — 모든 외부도 동의**:
- Trend Template 8/8 (B1~B7)
- RS ≥ 70 (R1)
- Stage 2 (200DMA 1개월+ 상승)
- Pivot 정의: 마지막 수축의 고점
- Stop-Loss 7~8%
- Breakout 거래량 +40~50%

**우리가 정설 대비 과엄격/이탈**:
- B5 200DMA 상승 5개월 (정설 1개월) — v1.3 완화 검토
- E7 ROE 17% Primary 게이트 (정설은 측정 권장만, Primary로 거는 곳 ChartMill만)

**우리가 누락한 정설 권장**:
- **A2 (신규)**: Breakout 당일 거래량 ≥ 1.4~1.5× 50DMA avg — TraderLion·FinerMP·Deepvue 합의. v1.3 검토.

> 외부 구현 비교 원본: `docs/minervini-bot-external-comparison.md` (별도 보관).

---

## 4. VCP Setup Quality (8 차원)

BUY 권고 받으려면 4개 이상 충족 필요.

| 차원 | 이상값 | 룰 ID/필드 |
|---|---|---|
| 수축 횟수 | 2~6회 (이상적 3~4회) | `num_contractions` |
| 단조 감소 (각 수축 ≤ 0.5× 선행) | True | `P6_monotonic_decreasing` |
| 마지막 수축 폭 | ≤ 6.5% | `P2_last_contraction` |
| 베이스 길이 | 4~12주 (28~84일) | `base_days` |
| 베이스 깊이 | ≤ 30% | `base_depth_pct` |
| 거래량 dry-up (VDU) | ≤ 0.6× SMA50 | `P3_vol_dryup` |
| 베이스 카운트 | 1~2차 우선 (3차+ 경고) | `P4_base_count` |
| RS Line 신고가 근접 | high 대비 -5% 이내 | `rs_line_pct_from_high` |

---

## 5. 진입·손절·익절 가격 계산

```python
entry = current_price if verdict == "BUY_NOW" else pivot_price
stop  = entry × (1 - 0.07)    # -7% (변동성 큰 종목은 -8%)
target1 = entry × (1 + 0.20)  # +20% 절반 익절
trailing = "close < SMA50 on volume" (50일선 이탈 시 나머지 청산)
position_risk = 계좌의 1~2%   # 포지션 사이즈 = 리스크 자본 / 손절 거리
```

---

## 6. 매도 (Sell Framework, Minervini §2-4)

> 봇의 **STOP_OUT verdict**는 아래 트리거 중 ① ②에서 자동 발화. ③~⑦은 사용자 판단 영역.

| # | 트리거 | 조치 | Verdict |
|---|---|---|---|
| ① | 진입 후 -7~8% (초기 손절) | 전량 청산. 협의 불가 | **STOP_OUT** |
| ② | 거래일 종가 < 50일선 (거래량 동반) | 남은 절반 청산. Stage 2 종료 신호 | **STOP_OUT** (peak 후 trailing) |
| ③ | +20~25% 도달 | 절반 익절 → 나머지 trailing | display signal (자동 X) |
| ④ | 종가 < 150일선 | 무조건 전량. Stage 3/4 진입 | (사용자 판단) |
| ⑤ | HH/HL 패턴 깨짐 | 추세 약화 — 부분 익절 | (사용자) |
| ⑥ | 분배일 4~6회 (4~5주 내, 지수) | 시장 약화 — 신규 매수 중단 | bear regime header |
| ⑦ | Climax run 후 첫 대량 음봉 | 분할 익절 가속 | (사용자) |

---

## 7. 시장 환경(Regime) 감지 (v1.2 — 2단계 합성)

| 신호 | 룰 | 출처 |
|---|---|---|
| **S1 — Index vs EMA50 (≒ 10wEMA)** | SPY 종가 < EMA50 → **bear 강제 (Minervini "trend off" 게이트)** | `macro.json` us.macro.us_sp500_trend.series |
| **S2 — F&G** | < 25 → bear · 25~75 → neutral · > 75 → neutral (overheated 무시) | `macro.json` us.sentiment.us_fg |

**우선순위**: S1 위반(지수 < EMA50) 시 즉시 bear. 그 외 S2 적용.

### 봇 동작
| Regime | 봇 권고 변화 |
|---|---|
| **neutral / bull** | verdict 그대로 출력 |
| **bear** | 모든 매수 권고에 **"시장 약세 — 신규 진입 보류"** 헤더 prepend |

### v1.3 예정 신호 (Task E 후속)
- **S3 — Distribution Day count** (지수 SPY/QQQ 최근 25일 中 분배일 ≥ 4 → 추가 bear)
- **S4 — Breadth** (전 universe Stage 2 비중 < 15% → bear)
- **S5 — VIX** (> 35 → bear)
- 0~10 점 종합 스코어 + "Confirmed Uptrend / Under Pressure / Correction" 3단계

---

## 8. 출력 형식 규칙

- 정확히 4줄 (시장 헤더 있을 시 5줄)
- 각 줄 70자 이내 (UI 줄바꿈 방지)
- 명사형 종결 (~임, ~다, ~함) — ~습니다/~입니다 금지
- 금지 어휘: "다소", "어느 정도", "유망", "기대", "본질가치", "저평가"
- 모든 가격에 통화 기호 + 소수점 2자리
- 모든 %에 부호 + 소수점 1~2자리

**예시 (KEYS, BUY_NOW)**:
```
매수 — Stage 2 진입 확정, pivot $352.78 돌파(+0.65%, buy zone).
13주 베이스 16.5% → 11.8% → 8.1% 수축, VDU 0.67× 진행.
Trend Template 8/8 통과, RS 91, RS 라인 신고가 -2.9%.
$355.06 매수·-7% 손절($330.21)·+20%($426.07) 절반 익절, 이후 50일선 trailing.
```

---

## 9. 신뢰도(confidence) 산출

```
base = (TT/8) × 0.5 + (VCP/8) × 0.3 + (RS/100) × 0.2
```
- EXTENDED: base − 0.15
- WATCH: base − 0.10
- AVOID: 0.20 + (8 − TT) × 0.05
- STOP_OUT: 0.95 (ironclad rule)

---

## 10. 한계 및 미해결 항목 (v1.2 갱신)

| 항목 | 상태 | 비고 |
|---|---|---|
| 외부 스크리너 비교 (Task B) | ✅ 완료 | §3-1 + `docs/minervini-bot-external-comparison.md` |
| Bear regime 정밀화 (Task E) | ⚠ 부분 완료 | S1 (Index vs EMA50) 적용. S3/S4/S5는 v1.3 |
| KR/HK 적용성 (Task F) | ✅ 완료 | 시장별 Primary 게이트 분리 (US 12/13, 비-US 9/10). 결과: KR 0→150+ 통과 예상 |
| Verdict별 실수익 검증 (Task G) | ❌ 보류 | 과거 verdict 스냅샷 데이터 부재. v1.3에서 일별 minervini-bot/*.json 스냅샷 누적 후 backtest 모듈 |
| B5 5개월 → 1개월 완화 | ❌ 보류 | 외부 정설 1개월. 현 70.5% pass라 긴급도 낮음. v1.3에서 정설 정렬 검토 |
| A2 (Breakout vol surge ≥1.4× 50DMA) 신규 룰 | ❌ 보류 | 외부 합의 사항. v1.3 신규 Primary 후보 |
| E7 ROE 17→15% 또는 SECONDARY 강등 | ❌ 보류 | 비-US에서는 이미 제외됨. US에서 임팩트 검증 후 v1.3 |
| F1 vs R1 redundancy | ❌ 보류 | 백테스트 후 결정. 둘 다 RS 측정 — 정보 중복 가능 |

---

## 11. 출처

본 봇 페르소나는 다음 공개 자료에서 paraphrase. **원문 인용 금지** (저작권).

| 자료 | 추출 항목 |
|---|---|
| chartmill.com — Minervini Trend Template | 8개 기준 정확한 정의 |
| finermarketpoints.com — VCP Complete Guide | 수축 시퀀스 18→12→6, 베이스 4~12주, breakout 거래량 +40~50% |
| finermarketpoints.com — SEPA/VCP Guide | -7~8% 손절, position risk 1~2% |
| Deepvue — TT/VCP | Stage 1~4 정의 (Weinstein 차용) |
| QuantVPS, AskLivermore | RS 70 gate 의미 (IBD RS rank) |
| Stockopedia / Mavi Analytics | 50일선 trailing, +20~25% 절반 익절 |

**Inaccessible / 미접근**:
- Mark Minervini 원본 책 *Trade Like a Stock Market Wizard* (2013), *Think & Trade Like a Champion* (2017)
- 본 봇은 **Minervini 스타일을 paraphrase한 자체 캐릭터** — Minervini 본인이 아님

---

## 12. 변경 이력

| 버전 | 일자 | 주요 변경 |
|---|---|---|
| v1.0 | 2026-05-11 | 봇 persona spec + 3 worked samples (KEYS, VRT, MTZ) |
| v1.1 | 2026-05-12 | 봇 pipeline (스크립트·UI·타입·cron) + STOP_OUT verdict + /minervini overview 페이지 + VNOM 노랑 박스 fix |
| v1.2 | 2026-05-12 | (진행 중) 본 문서 신설, exit_reasons UI 명확화, soft-gate 룰 추가, Task B/C/E/F/G 예정 |

---

> **End of criteria doc.** 룰별 임계값 변경 시 본 문서 + `minervini-bot-persona.md` + `generate_minervini_calls.py` 3곳 동시 갱신.

# TaPlot(@TaPlot) 트레이딩 방법론 정리

> 기준일: 2026-04-10
> 출처: X(Twitter) @TaPlot, TradingView TaPlot 프로필, YouTube 영상, ThreadReader 아카이브

---

## 핵심 요약

- TaPlot은 2006년부터 활동한 모멘텀/브레이크아웃 트레이더. Mark Minervini의 VCP + William O'Neil의 CANSLIM을 기반으로 함
- 핵심 철학: **"미래의 승자를 찾으려면 과거 셋업을 눈으로 반복 학습해야 한다"** — 수십 년간(1981~현재) 차트 패턴의 재현성을 강조
- 진입 시점의 리스크 통제를 최우선시: **"리스크는 매도할 때가 아니라 진입할 때 통제한다"**
- Danger Point(위험 지점) 근처 진입 → 타이트 손절 → 피라미딩으로 노출 확대, 리스크 비확대 구조
- TradingView에 8개 커스텀 인디케이터 공개 (Volume Pocket Pivots, MA with Uptrend 등)

---

## 1. 종목 선정 원칙 (Trend Template 스크리너 기준)

Minervini Trend Template 8대 기준을 기반으로 Stage 2 상승추세 종목만 필터링:

| # | 기준 | 구체 파라미터 |
|---|---|---|
| 1 | 현재가 > 50일 이동평균 | — |
| 2 | 현재가 > 150일 이동평균 | — |
| 3 | 현재가 > 200일 이동평균 | — |
| 4 | 50일 MA > 150일 MA | 단기 모멘텀이 중장기 추세와 정렬 |
| 5 | 150일 MA > 200일 MA | — |
| 6 | 200일 MA 상승 추세 | 최소 1개월, 이상적으로는 4~5개월 이상 |
| 7 | 52주 고점 대비 25% 이내 | 신고가에 가까울수록 유리 |
| 8 | RS(상대강도) Rating ≥ 70 | 불마켓 시 90+ 집중 권장 |

**추가 필터 (TaPlot 강조 요소):**
- 52주 저점 대비 최소 30% 이상 상승한 상태
- RS가 시간 경과에 따라 상승 중 (예: 75→85→92) = 가속 리더십 신호
- 분기 EPS 성장률 20% 이상 (펀더멘털 필터)

**TaPlot TradingView 인디케이터:**
- **TAPLOT Moving Average with Uptrend**: 200일 MA의 상승 지속 기간을 색상으로 시각화
  - Blue = 1개월+ 상승 (초기 단계)
  - Cyan = 4개월+ 상승 (Stage 2 확인)

---

## 2. 차트 패턴 / 셋업 기준

### VCP (Volatility Contraction Pattern) 7대 체크리스트

| # | 항목 | 기준 |
|---|---|---|
| 1 | 점진적 수축 | 변동성이 순차 감소 (예: 15%→10%→5%) |
| 2 | 거래량 고갈 | 풀백 시 거래량 감소, 랠리 시 확대 |
| 3 | 명확한 피봇 포인트 | 최종(가장 타이트한) 수축의 고점 = 진입가 |
| 4 | Stage 2 상승추세 확인 | 가격 > 50/150/200일 MA |
| 5 | RS Rating ≥ 70 | 이상적으로 90+ |
| 6 | 분기 EPS 가속 성장 | 20% 이상 |
| 7 | 시장 환경 | 주요 지수 상승추세 |

**VCP 구체 파라미터:**
- 베이스 깊이: 10~35% 조정이 이상적 (건전한 매집 과정)
- 수축 횟수: 2~6회, 매 수축이 이전보다 작아야 함
- 거래량 고갈: 최종 수축 시점 거래량이 베이스 전체 기간 중 최저 수준
- ATR이 50일 평균의 약 1/3 수준으로 압축
- 브레이크아웃일 거래량: 평균 대비 최소 40~50% 이상 증가

### TaPlot이 다루는 주요 패턴 유형

| 패턴 | 설명 |
|---|---|
| **VCP** | 가장 핵심. 변동성 수축 후 브레이크아웃 |
| **Cup with Handle** | 컵 형태 베이스 + 핸들 후 돌파 |
| **High Tight Flag (Power Play)** | 급등 후 좁은 범위 횡보 → 재돌파 |
| **Low Cheat IPO** | IPO 후 초기 베이스에서 조기 진입 |
| **Squat & Reversal Recovery** | 하락 후 2일 반전 회복 패턴 |
| **Pocket Pivot** | 기관 매집 신호 (아래 별도 설명) |

### Pocket Pivot (TaPlot 핵심 인디케이터)

**TAPLOT Volume Pocket Pivots** 인디케이터 로직:
- **정의**: 상승일 거래량 > 최근 10일 하락일 중 최대 거래량
- **조건**: 봉의 종가가 일봉 범위 상위 2/3에 위치해야 유효 (하위 1/3 종가는 약세 신호로 제외)
- **색상 분류**:
  - 밝은 초록 = 10일 Pocket Pivot (주 신호)
  - 파란색 = 5일 Pocket Pivot (보조 신호)
  - 밝은 빨간색 = Distribution bar (평균 이상 거래량 + 하락 마감)
  - 거래량 고갈(Volume Dry-up) = 이동평균 대비 45~60% 이하로 하락 시 표시
- **원출처**: Gil Morales & Chris Kacher의 기관 매집 패턴 연구

> Pocket Pivot는 단독 매수 신호가 아님. 가격 구조, 베이스 형성, 펀더멘털과 함께 종합 판단 필요

---

## 3. 피라미딩 전략

TaPlot은 "How to Pyramid Into Stocks" 영상(21개 셋업 예시)과 "Low Risk Stock Setups" PDF(41개 차트)를 통해 구체적 피라미딩 방법론 제시.

### 핵심 원칙

| 원칙 | 내용 |
|---|---|
| **초기 진입은 소규모** | 전체 계좌의 1~2% 리스크로 시작 |
| **추가 매수는 이전보다 작게** | 매 추가 진입 시 포지션 규모 감소 (역피라미드) |
| **수익으로 리스크 상쇄** | 초기 진입의 미실현 이익이 후속 진입의 리스크를 흡수 |
| **추세 확인 후에만 추가** | 주가가 유리한 방향으로 움직일 때만 추가 매수 |

### 추가 매수 트리거

1. **브레이크아웃 후 Follow-through**: 피봇 돌파 후 거래량 동반 추세 지속 확인 시
2. **First Natural Reaction Pullback**: 첫 자연 조정(풀백) 후 상승 이동평균(20일/50일) 지지 확인 시
3. **기존 저항→지지 전환**: 돌파한 저항선이 지지선으로 재확인될 때
4. **연속 패턴 형성**: 상승 추세 내 새로운 VCP/Cup 등 continuation 패턴 완성 시

### Staggered Stops (단계적 손절)

- **4% / 8% 분할 손절**: 포지션 일부는 4%에서, 나머지는 8%에서 손절
- 부분 포지션 유지로 "shakeout(흔들기)" 후 재상승에 대응
- **"큰 승자를 패자로 만들지 마라. 일부 이익은 반드시 실현하라"**

---

## 4. 리스크 관리 원칙

### Danger Point (위험 지점) 개념

- **원출처**: Jesse Livermore의 "Line of Least Resistance" + Minervini의 SEPA
- **정의**: 매도 압력이 소진되고, 상승 방향으로의 저항이 최소화되는 가격 수준
- **실전 적용**: Danger Point에 최대한 가까이 진입 → 손절폭 극소화 → R/R 극대화

### 구체 리스크 규칙

| 규칙 | 내용 |
|---|---|
| 진입 전 손절가 설정 | 매수 전 반드시 손절 수준 결정 |
| 손절폭 3~5% | Low Risk Setup의 손절 범위 (PDF 사례 기준) |
| R/R 비율 검증 | 25% 리스크로 10~15% 수익 기대 = 부적격 |
| 50일 MA 하향 이탈 + 대량 거래 | 추세 훼손 신호 → 즉시 청산 |
| Distribution 감시 | 평균 이상 거래량 + 하락 마감 = 기관 매도 경고 |

### Low Risk Setup 5대 조건 (영상 종합)

1. VCP 또는 유사 베이스 패턴 완성
2. Danger Point 근접 진입 (타이트 손절 가능)
3. 거래량 고갈 확인 (매도 압력 소진)
4. Stage 2 상승추세 + Trend Template 충족
5. 시장 전반 환경이 우호적 (주요 지수 상승추세)

---

## 5. 우리 VCP 스크리너에 적용 가능한 시사점

### 스크리너 필터 강화

| 현행 가능 개선 | TaPlot 기반 시사점 |
|---|---|
| MA 정렬 필터 | 50>150>200 + **200일 MA 상승 기간** 추적 (1개월 vs 4개월+ 구분) |
| RS Rating | 단순 70+ 컷오프 → **RS 가속도**(최근 3개월 RS 추이) 추가 |
| 거래량 고갈 감지 | 최종 수축 시점의 거래량이 베이스 기간 최저 수준인지 체크 |
| 수축 패턴 정량화 | 연속 풀백의 깊이가 점진 감소하는지 수치로 검증 (예: 20%→12%→6%) |
| Pocket Pivot 신호 | 상승일 거래량 > 최근 10일 하락일 최대 거래량 + 상위 2/3 종가 조건 |
| ATR 압축 | ATR이 50일 평균 대비 1/3 수준으로 하락 시 breakout 임박 신호 |
| 브레이크아웃 거래량 | 평균 대비 40~50%+ 증가 확인 |

### 알림/시각화 개선

- 200일 MA 상승 기간 색상 구분 (Blue/Cyan 방식 차용)
- Distribution Day 카운터 추가 (시장 환경 판단)
- Volume Dry-up 감지 → "breakout 임박" 알림

### 피라미딩 지원 기능 (향후)

- 초기 진입 후 First Natural Reaction 풀백 감지
- 포지션별 단계적 손절가 자동 계산 (4%/8% staggered)
- R/R 비율 사전 검증 (진입가 대비 피봇 거리 / 예상 타겟)

---

## 출처

- [TaPlot Twitter/X 프로필](https://x.com/TaPlot)
- [TaPlot TradingView 프로필 (8개 인디케이터)](https://www.tradingview.com/u/TaPlot/)
- [TAPLOT Volume Pocket Pivots 인디케이터](https://www.tradingview.com/script/cGcACkOM-TAPLOT-Volume-Pocket-Pivots/)
- [TAPLOT Moving Average with Uptrend 인디케이터](https://www.tradingview.com/script/SclwIGD8-TAPLOT-Moving-Average-with-Uptrend/)
- [Low Risk Stock Setups 트윗](https://x.com/TaPlot/status/1733665404340343272)
- [Low Risk Stock Setups 영상 요약](https://galaxy.ai/youtube-summarizer/understanding-low-risk-stock-setups-a-comprehensive-guide-R5ScKXy1ytg)
- [TaPlot Thread (과거 셋업 학습)](https://threadreaderapp.com/thread/1451737376900931590.html)
- [TaPlot Thread (셋업 + 리스크)](https://threadreaderapp.com/thread/1459495873226936321)
- [Minervini VCP 체크리스트](https://traderlion.com/technical-analysis/volatility-contraction-pattern/)
- [Minervini Trend Template](https://deepvue.com/screener/minervini-trend-template/)

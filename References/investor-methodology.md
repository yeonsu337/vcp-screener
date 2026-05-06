# 10-Bagger 발굴 투자 대가별 펀더멘털·정성 리서치 방법론

> 기준일: 2026-05-05
> 목적: VCP Screener "Company Research" 자동 생성 기능 항목 정의용 desk research
> 대상: Primary 14개 룰 中 12+ 통과 종목 자동 리서치
> 인용 출처: 각 대가의 1차 저서 + Morningstar·Stockopedia·Old School Value·Validea 등 2차 분석 자료

---

## 핵심 요약

- 8명 대가의 방법론을 비교 분석한 결과, **"Quality + Growth + Valuation + Risk"** 4축이 공통 골격임
- **펀더멘털 정량 기준**(Minervini, O'Neil)은 자동화 친화적, **정성 평가**(Buffett, Fisher, Munger)는 LLM 보강 필수
- 10-bagger 발굴 핵심: ① 작은 시총·초기 단계, ② 매출/EPS 25%+ 가속 성장, ③ 식별 가능한 4종 해자(Dorsey 분류), ④ 신제품·신경영진·신산업 트리거(O'Neil의 N), ⑤ 합리적 PEG (<1.5)
- yfinance + Claude API + 웹검색으로 자동화 가능 항목은 **약 70%**, 나머지 30%(경영진 통합성·산업 vibes·노조 관계 등)는 수기 보완 필요

---

## 1. 투자 대가별 핵심 리서치 항목

### 1-1. Mark Minervini — SEPA + Trend Template

> 출처: *Trade Like a Stock Market Wizard* (2013), *Think and Trade Like a Champion* (2016)

| # | 항목 | 핵심 기준 |
|---|---|---|
| 1 | **분기 EPS 성장률** | YoY +20% 최소, +40~50% 우수. **가속 필수** (이번분기 > 전분기) |
| 2 | **분기 매출 성장률** | EPS와 동반 가속 (인위적 마진 확장 배제 검증) |
| 3 | **마진 확장** | 영업이익률 / 순이익률 추세 상승. "earnings·sales·margins 3종이 90%" |
| 4 | **부채 / 재무 건전성** | 합리적 debt level. ROE / ROIC 우수 |
| 5 | **IPO 후 5~10년 sweet spot** | 창업기 경영진의 entrepreneurial peak |
| 6 | **컨센서스 추세** | EPS 추정치 상향 조정 (analyst revision 양의 기울기) |
| 7 | **Code 33** | 분기 EPS·매출·마진 3종 동시 가속 = 슈퍼 퍼포먼스 트리거 |

### 1-2. William O'Neil — CAN SLIM 7요소

> 출처: *How to Make Money in Stocks* (1988, 4th ed. 2009)

| 요소 | 의미 | 기준 |
|---|---|---|
| **C** | Current quarterly EPS | YoY +25% 최소 (선호 +40%+) |
| **A** | Annual earnings growth | 3년 연속 +25%/년, ROE 17%+ |
| **N** | New product/management/high | 최근 신제품·신경영진·신가격 신고가 — **"95% 우승주가 무언가 New"** |
| **S** | Supply & demand | 작은 유통주식수 선호, 자사주 매입·기관매수 활발 |
| **L** | Leader or laggard | 산업 내 RS Top 20%, **"리더 산업의 리더 종목"** |
| **I** | Institutional sponsorship | 기관 보유 비중 증가 추세, 우수 펀드 보유 |
| **M** | Market direction | 전체 시장 방향 (상승추세 / 조정 / 하락 단계 식별) |

**손절 룰**: 매수가 대비 -7~8% 도달 시 예외 없이 손절.

### 1-3. Warren Buffett — Economic Moat + Owner Earnings

> 출처: Berkshire Hathaway 주주서한, *The Essays of Warren Buffett* (Cunningham 편)

- **경제적 해자(Moat)**: 브랜드(Coca-Cola, Apple), 비용우위(Walmart, GEICO), 네트워크(Visa, AmEx), 전환비용(Microsoft) — **"넓고 오래 가는 해자"**
- **Owner Earnings** = 순이익 + 감가상각 - 유지보수 capex. (성장 capex는 별도) → 실제 주주 인출 가능 현금
- **경영진 quality**: 정직성·역량·해자 확장 의지 3종. "honest lord in charge of the castle"
- **10년+ 일관 EPS 성장**: 년 8~12% 안정 성장이 40%→-20% 변동보다 가치 큼
- **예측 가능한 cash flow**: 성장 자금·배당·불황 견디기 능력
- **Margin of Safety** (Graham 계승): 내재가치 대비 충분 할인된 가격
- **Circle of Competence**: 이해 못 하는 사업은 패스

### 1-4. Charlie Munger — Mental Models + Lollapalooza

> 출처: *Poor Charlie's Almanack*, USC·Harvard 강연록

- **다학제 Mental Models 격자**: 심리학·역사·수학·생물학·물리학·경제학 모델 동시 적용
- **Lollapalooza Effect**: 다수의 동일방향 force가 누적 시 임계질량 효과 (예: 강력한 브랜드 + 네트워크 + 전환비용 동시 작동)
- **Quality > Cheap**: "A great business at a fair price is superior to a fair business at a great price" — Buffett의 Graham→Fisher 전환을 견인
- **Inversion**: "거꾸로 생각하라" — 어떻게 망할 수 있는가? 부터 출발
- **Preparation·Discipline·Patience·Decisiveness 4덕**
- **Latticework 리서치**: 회사·산업·고객행동·규제·거시 동시 검토 (단순 재무제표 수치 거부)

### 1-5. Peter Lynch — 6 Categories + 10-Bagger

> 출처: *One Up On Wall Street* (1989), *Beating the Street* (1993)

| 카테고리 | 특징 | Lynch의 시각 |
|---|---|---|
| Slow Growers | GDP 성장률 수준 | 회피 (배당 매력 시만) |
| Stalwarts | 연 10~12% 성장 | 30~50% 차익 후 매도 |
| **Fast Growers** | 연 20~25% 성장, 작은 시총 | **"내 favorite, 10-bagger 후보"** |
| Cyclicals | 경기 민감 | 저PER 매수 함정 주의 |
| Turnarounds | 회생주 | 고위험 고보상 |
| Asset Plays | 숨은 자산 | 부동산·현금·지분·IP |

- **PEG ratio < 1.0** → 저평가 (1.5+ 경계, 2.0+ 회피)
- **"Invest in what you know"** — 일상에서 찾는 6가지 신호: ① 평범한 회사명, ② 지루한 사업, ③ 분사된 자회사, ④ 기관 미보유, ⑤ 애널리스트 미커버, ⑥ 자사주 매입
- **Story 검증**: 30초 안에 stock story 설명 못 하면 매수 금지
- **Earnings 추적이 전부**: "What does the company do, and is it making more money?"

### 1-6. Phil Fisher — 15 Points + Scuttlebutt

> 출처: *Common Stocks and Uncommon Profits* (1958). Buffett: "I'm 85% Graham and 15% Fisher"

| # | 항목 (요약) |
|---|---|
| 1 | **확장 시장**: 최소 수년간 매출 증대 가능한 제품·서비스 |
| 2 | **신제품 개발 의지** |
| 3 | **R&D 효율성** (대비 매출액 비율 + 산업 peer 비교) |
| 4 | **우수 영업조직** |
| 5 | **양호한 영업이익률** (Handsome margin) |
| 6 | **마진 개선 노력** (가격 인상 의존 대신 비용 효율) |
| 7 | **종업원 관계** (이직률·노조 관계) |
| 8 | **임원 관계** (executive depth) |
| 9 | **경영진 depth** (후계 구도) |
| 10 | **회계·원가 통제** |
| 11 | **산업별 고유 변수** |
| 12 | **장기 이익 관점** (단기 압박 회피) |
| 13 | **재무 건전성** (가급적 추가 증자 회피) |
| 14 | **양호한 IR·공시** (경영진 솔직함) |
| 15 | **경영진 integrity** — 가장 중요. 14개 다 만족해도 이거 없으면 패스 |

**Scuttlebutt Method**: 경쟁사·공급사·고객·전·현직 직원·업계협회 인터뷰 → 경영진 면담 前 정보 수집.

### 1-7. Howard Marks — Risk-First + Cycle Awareness

> 출처: *The Most Important Thing* (2011), *Mastering the Market Cycle* (2018), Oaktree memos

- **Second-Level Thinking**: "Everyone bullish → 가격 이미 반영 → upside 제한·downside 확대" (1차 사고는 알파 없음)
- **Risk = 영구 자본 손실 가능성**, ≠ 변동성 (Sharpe ratio 류 거부)
- **"Avoid the losers, winners take care of themselves"** — 공격보다 수비 우선
- **Market Cycle 감각**: 최대 risk 시점 = 모두가 risk 없다고 느낄 때 (peak of bull market)
- **Contrarian Mindset**: 군중과 반대로, 그러나 단순 역행이 아닌 가격·심리 동반 분석
- **Risk-Adjusted Return**: 같은 수익이면 낮은 risk 경로 선호

### 1-8. Pat Dorsey — 4 Sources of Moat

> 출처: *The Little Book That Builds Wealth* (2008), *The Five Rules for Successful Stock Investing* (2003), Morningstar

| Moat 유형 | 핵심 메커니즘 | 대표 사례 |
|---|---|---|
| **1. Intangible Assets** | 브랜드·특허·라이선스 → 가격 결정력 / 고객 lock-in | LVMH, Disney, 제약 특허 |
| **2. Switching Costs** | 전환 시 시간·비용·리스크 ↑ → 고객 이탈 차단 | Oracle DB, SAP, 은행 |
| **3. Network Effects** | 사용자 ↑ → 가치 ↑ → 추가 사용자 유입 (양의 피드백) | Visa, Meta, eBay |
| **4. Cost Advantages** | 프로세스·입지·고유자산·규모 4종 | Walmart(규모), GEICO(채널), Costco(매입력) |

**Dorsey의 추가 원칙**:
- **size ≠ moat**: 큰 회사가 자동으로 해자를 갖지 않음 (Kodak·Nokia·Sears)
- **Past returns ≠ moat**: 과거 우수 ROIC가 미래 보장 X — **forward-looking 분석 필수**
- **Moat width × duration**: 해자의 폭(현재 수익성)과 지속기간(미래) 둘 다 평가
- **Moat 유무 식별 핵심 지표**: 일관된 고 ROIC (15%+), 높은 영업이익률, 가격 결정력

---

## 2. 10x Stock 발굴 공통 패턴 (Top 10)

8명 대가가 공통적으로 강조하는 항목을 빈도순 추출:

| Rank | 항목 | 강조 대가 (8 中) | 핵심 해석 |
|---|---|---|---|
| 1 | **EPS·매출 가속 성장** | Minervini, O'Neil, Lynch, Fisher, Buffett | 분기·연 20%+ 성장 + 가속도 |
| 2 | **경제적 해자(Moat) 식별** | Buffett, Munger, Dorsey, Fisher | 4종 해자 분류 적용 |
| 3 | **경영진 quality·integrity** | Buffett, Fisher, Munger, Minervini | 정직성 > 역량. Fisher Point 15 |
| 4 | **마진 확장 추세** | Minervini, O'Neil, Fisher, Buffett | 영업·순이익률 상승 + 비용 효율 |
| 5 | **시장 규모 / TAM 확장성** | Lynch, Fisher, Buffett, Dorsey | 작은 회사 + 큰 시장 = 10x 토양 |
| 6 | **재무 건전성 (부채·현금흐름)** | Buffett, Fisher, Minervini, Lynch | Owner earnings 양호 + 합리 부채 |
| 7 | **합리적 valuation (PEG·MoS)** | Lynch, Buffett, Marks | PEG <1.5, 안전마진 |
| 8 | **Risk control** | Marks, Munger, O'Neil, Minervini | 영구 손실 회피·손절 룰·Inversion |
| 9 | **New trigger (제품·경영·산업)** | O'Neil, Lynch, Fisher | "무언가 새로움" — 95% 우승주 공통 |
| 10 | **Industry leadership / RS** | O'Neil, Minervini, Lynch | 리더 산업의 리더 종목 |

**시사점**: 정량 4종(성장·마진·재무·valuation) + 정성 4종(해자·경영진·시장·risk) + 모멘텀 2종(new·leadership) = **10x 통합 lens**

---

## 3. Economic Moat 구조화 (Pat Dorsey 4 + 보강)

### 3-1. Intangible Assets (무형 자산)

| 항목 | 어떻게 식별 | 지속가능성 측정 |
|---|---|---|
| **Brand 가치** | 가격 프리미엄 vs peer (예: Apple vs Android OEM) | Brand Finance·Interbrand 순위 추세, 광고비 ROI |
| **특허 포트폴리오** | 핵심 특허 만료 일정, 특허 신청 추세 | 특허 cliff 도래 5년+ 여유? R&D 후속 pipeline? |
| **규제 라이선스** | 진입 장벽 (FDA·통신 주파수·면허) | 규제 변화 risk, lobbying 영향력 |
| **고객 충성도** | NPS, 재구매율, 가격 탄력성 | 트렌드·세대교체 시 brand fatigue 여부 |

**자동화 신호**: 매출총이익률 50%+ 지속 + 광고비 / 매출 ratio 안정 + 가격 인상 흡수 입증.

### 3-2. Switching Costs (전환 비용)

| 항목 | 어떻게 식별 | 지속가능성 측정 |
|---|---|---|
| **시스템 통합 깊이** | 고객 운영에 embedded? (ERP·DB·결제) | 마이그레이션 비용·리스크·시간 |
| **데이터 lock-in** | 누적 고객 데이터·이력 가치 | 데이터 portability 규제 위험 (GDPR 류) |
| **학습 곡선 / 인증** | 사용자 훈련 비용 (예: AutoCAD, Bloomberg) | 신규 진입자의 학습 비용 모방 가능성 |
| **계약 구조** | 다년 계약·자동 갱신·취소 위약금 | 갱신율 (Net Retention 110%+ = 강) |

**자동화 신호**: 고객 이탈률 (churn) <5% + 다년 계약 비중 + Net Revenue Retention 100%+.

### 3-3. Network Effect (네트워크 효과)

| 항목 | 어떻게 식별 | 지속가능성 측정 |
|---|---|---|
| **양면 시장** | 구매자·판매자·개발자 등 다중 사용자 그룹 | 각 면 성장률·균형 |
| **사용자 수 vs 가치** | 메트칼프 곡선 (가치 = N²) | 임계질량 도달 여부, 활성 사용자 (DAU/MAU) |
| **로컬 vs 글로벌** | 로컬 네트워크 (배달앱) vs 글로벌 (소셜) | 경쟁사 진입 시 fragmentation 위험 |
| **Multi-homing 비용** | 사용자가 경쟁 플랫폼 동시 사용 가능? | 가능 시 moat 약화 (Uber·Lyft) |

**자동화 신호**: MAU·DAU 추세, 사용자당 매출 (ARPU) 상승, take-rate 안정.

### 3-4. Cost Advantage (비용 우위)

Dorsey 4 sub-categories:

| 원천 | 메커니즘 | 사례 |
|---|---|---|
| **Process** | 고유 운영 know-how (Toyota Production) | 모방 가능성 측정 (시간·비용) |
| **Location** | 지리적 우위 (광산·항만·매장) | 대체지 존재 여부 |
| **Unique Assets** | 광산·매장지·DNA 데이터 | 자산 고갈 일정 |
| **Scale** | 고정비 분산·구매력 (Walmart, Costco) | 임계 시장점유율 (15%+) |

**자동화 신호**: 영업이익률 peer 대비 +5%p 이상 지속 + ROIC 15%+ 일관 + 가격 인하 여력.

### 3-5. 보강 — Counter-Positioning & Switching-Type Coexistence

Dorsey 4종 외 최근 학계·실무 추가 분류:

- **Counter-Positioning** (Hamilton Helmer, *7 Powers*): 신규 진입자가 채택 시 기존 강자가 자기 사업 잠식하느라 따라할 수 없는 포지션 (예: Netflix vs Blockbuster, 디스카운트 브로커 vs 풀서비스)
- **Process Power**: 단순 process 효율을 넘어, 모방에 5~10년+ 소요되는 누적 학습 (TSMC 미세공정)
- **Cornered Resource**: 독점 권리·인재 lock-in (개별 약물 특허, 영화 IP)

**식별 질문 4종 (Dorsey 통합)**:
1. 회사가 평균 이상 ROIC를 5년+ 유지했는가?
2. 무엇이 그 ROIC를 만드는가? (4종 + α 中 어디?)
3. 그 source가 향후 10년 지속 가능한가?
4. 신규 진입자·대체재가 그것을 무력화할 시나리오는?

---

## 4. 통합 리서치 체크리스트 (5 카테고리)

### Category A. BM / History

| # | 항목 | 데이터 소스 | 자동화 |
|---|---|---|---|
| A1 | 기업 개요·법인구조 | yfinance `info`, 10-K Item 1 | 자동 (LLM 요약) |
| A2 | 연혁 / Milestone (창업·IPO·M&A) | 10-K History, Wikipedia | 자동 (LLM) |
| A3 | 사업부별 매출 (5년) | 10-K Item 8 Segment, DART | 자동 (XBRL parse) |
| A4 | 지역별 매출 (5년) | 10-K Geographic, DART | 자동 (XBRL) |
| A5 | 주요 고객 (concentration) | 10-K Risk Factors | 자동 (LLM) |
| A6 | Value Chain 위치 | 산업 보고서 + LLM 추론 | 반자동 (LLM + 검색) |
| A7 | 상품·서비스 라인업 | 회사 IR + LLM | 자동 |
| A8 | 채널 (B2B/B2C/D2C) | 10-K + IR | 자동 (LLM) |
| A9 | Revenue stream 유형 (구독·1회·수수료) | 10-K Revenue Recognition | 자동 (LLM) |

### Category B. 재무 분석

| # | 항목 | 데이터 소스 | 자동화 |
|---|---|---|---|
| B1 | 매출 5Y CAGR + 분기 가속 | yfinance `quarterly_financials` | 완전 자동 |
| B2 | 영업이익 5Y CAGR + 마진 추세 | yfinance | 완전 자동 |
| B3 | EPS 성장률 (분기 YoY, 연 3Y) | yfinance | 완전 자동 |
| B4 | ROE / ROIC / ROA | yfinance + 계산 | 완전 자동 |
| B5 | 부채비율 (D/E, Net Debt/EBITDA) | yfinance `balance_sheet` | 완전 자동 |
| B6 | Owner Earnings = 순이익+감가-Maint Capex | 10-K Cash Flow | 반자동 (Maint vs Growth capex 추정) |
| B7 | FCF 추세 + FCF Yield | yfinance | 완전 자동 |
| B8 | 비용구조 (COGS / SGA / R&D 비중) | yfinance Income Stmt | 완전 자동 |
| B9 | 자사주 매입 / 배당 정책 | yfinance, SEC Form 4 | 완전 자동 |

### Category C. 펀더멘털 (시장·경쟁)

| # | 항목 | 데이터 소스 | 자동화 |
|---|---|---|---|
| C1 | TAM·SAM·SOM (현재) | 산업 보고서 (Statista, IBIS) | 반자동 (LLM 추정 + 검색) |
| C2 | 시장 성장률 (3~5Y CAGR) | 산업 보고서, 정부 통계 | 반자동 |
| C3 | 시장 성장 driver 3가지 | 업계 분석, LLM | 자동 (LLM) |
| C4 | 시장점유율 (회사 + Top 5) | IR, 산업 보고서 | 반자동 |
| C5 | 경쟁사 list (Top 5~10) | yfinance peers, 10-K | 완전 자동 |
| C6 | 경쟁 강도 (Porter 5 Forces 약식) | LLM 분석 | 자동 (LLM) |
| C7 | 경쟁 우위·열위 매트릭스 | 재무 peer 비교 + LLM | 반자동 |
| C8 | 산업 사이클 위치 (Marks framework) | LLM + 거시 지표 | 반자동 |

### Category D. 투자 포인트 (해자·Upside)

| # | 항목 | 데이터 소스 | 자동화 |
|---|---|---|---|
| D1 | 해자 유형 (Dorsey 4종 中) | 10-K + 재무 비교 + LLM | 반자동 (LLM 판정) |
| D2 | 해자 지속기간 추정 | 특허·계약·시장 동향 | 수기 보강 |
| D3 | "New" 트리거 (제품·경영·산업) | 최근 12개월 뉴스 | 자동 (웹검색 + LLM) |
| D4 | EPS 가속 단계 (Code 33 적용) | yfinance 분기 | 완전 자동 |
| D5 | Upside 시나리오 (Bull/Base/Bear) | 추정 + 멀티플 | 반자동 (LLM) |
| D6 | PEG ratio | yfinance + 성장률 | 완전 자동 |
| D7 | Owner Earnings yield | B6 / 시총 | 완전 자동 |
| D8 | Lynch 6 카테고리 분류 | 성장률 + 시총 | 자동 (룰 기반) |
| D9 | 산업 RS 등급 (Top quintile?) | 가격 데이터 | 완전 자동 |

### Category E. 리스크

| # | 항목 | 데이터 소스 | 자동화 |
|---|---|---|---|
| E1 | 매출 집중도 risk (Top 1·5 고객 비중) | 10-K Risk Factors | 자동 (LLM) |
| E2 | 공급망 / 단일 공급자 risk | 10-K | 자동 (LLM) |
| E3 | 규제 / 소송 risk | 10-K Legal Proceedings, news | 자동 (LLM + 검색) |
| E4 | 경쟁 진입 위협 (Moat 침식) | 산업 동향 | 반자동 |
| E5 | 재무 risk (부채 만기, 유동성) | yfinance + 10-K | 완전 자동 |
| E6 | 경영진 risk (CEO 교체·integrity) | proxy statement, news | 반자동 |
| E7 | 시장 사이클 risk (Marks) | 거시 지표 + sentiment | 반자동 |
| E8 | Inversion: "어떻게 망하는가?" | LLM 시나리오 | 자동 (LLM) |
| E9 | Stop-loss level (-7~8% O'Neil) | 가격 데이터 | 완전 자동 |

---

## 5. VCP 스크리너 자동화 가능 항목 분류

### 5-1. 완전 자동 (Claude API + yfinance + 웹검색만으로 채움)

| Tier | 항목 |
|---|---|
| **재무** | B1·B2·B3·B4·B5·B7·B8·B9 (분기/연 EPS·매출·마진·ROE·부채·FCF·비용구조) |
| **valuation** | D6 (PEG), D7 (Owner Earnings yield), D8 (Lynch 카테고리), D9 (RS 등급) |
| **risk 정량** | E5 (재무 risk), E9 (stop-loss) |
| **분석 메트릭** | Code 33 (D4), 모멘텀 가속 |

→ **약 18~20개 항목**. 룰 기반 + yfinance 호출만으로 완성.

### 5-2. LLM 보조 자동 (Claude API + 10-K + 웹검색 prompt engineering)

| Tier | 항목 |
|---|---|
| **BM** | A1·A2·A6·A7·A8·A9 (개요·연혁·Value Chain·상품·채널·Revenue stream) |
| **시장·경쟁** | C3 (성장 driver), C5 (peers), C6 (5 Forces 약식), C8 (사이클) |
| **해자·trigger** | D1 (해자 유형), D3 (New trigger), D5 (Bull/Base/Bear) |
| **risk 정성** | E1·E2·E3 (집중도·공급망·규제), E8 (Inversion) |

→ **약 14~16개 항목**. 10-K Item 1·1A·7 자동 다운로드 + Claude API 분류.

### 5-3. 반자동 (LLM + 외부 데이터 + 사용자 검증)

| Tier | 항목 |
|---|---|
| **세그먼트** | A3·A4 (사업부·지역별 5Y) — XBRL 또는 DART 파싱 |
| **고객·시장** | A5 (주요 고객), C1·C2·C4 (TAM·성장률·MS) |
| **경쟁** | C7 (우위/열위 매트릭스) |
| **해자 지속성** | D2 (해자 duration) |
| **거버넌스** | E6 (경영진 risk) |

→ **약 9~10개 항목**. 외부 산업 보고서·proxy statement 추가 필요.

### 5-4. 수기 보완 권장 (자동화 한계)

| 항목 | 이유 |
|---|---|
| Fisher Point 7·14·15 (종업원·IR·integrity) | 정성 판단·인터뷰 필요 |
| Scuttlebutt method (전·현직 직원) | 1차 자료 수집 불가능 |
| Munger Lollapalooza 식별 | 다학제 정성 통합 |
| Buffett Circle of Competence 적용 | 사용자 본인의 이해도 |

→ Screener는 "Research Card" 형태로 **B카테고리 (재무) + D카테고리 (투자포인트) 자동 채움 + 나머지는 LLM 초안 + 사용자 편집**이 현실적.

---

## 6. 권장 산출 구조 (Company Research Card v1)

VCP Screener UI에 노출할 1-page 카드 권장 구조:

```
┌─────────────────────────────────────────────┐
│ [Ticker] [Company Name]                     │
│ Lynch Category: Fast Grower | RS: 92        │
├─────────────────────────────────────────────┤
│ 1. BM Snapshot (LLM 요약 3줄)               │
│ 2. 5Y Financials Heatmap (B1~B5)            │
│ 3. Moat Type (Dorsey) + Evidence            │
│ 4. "New" Trigger (최근 12M)                  │
│ 5. PEG / Owner Earnings Yield               │
│ 6. Bull / Base / Bear (LLM)                 │
│ 7. Top 3 Risks                              │
│ 8. Stop-loss (-7%) + Position Sizing 추천    │
└─────────────────────────────────────────────┘
```

각 섹션 우측에 "Manual edit" 버튼으로 사용자 보강 layer 운영 권장.

---

## 출처 요약

- Minervini, M. (2013). *Trade Like a Stock Market Wizard*. McGraw-Hill.
- O'Neil, W. (2009). *How to Make Money in Stocks*, 4th ed. McGraw-Hill.
- Cunningham, L. (ed.). *The Essays of Warren Buffett*; Berkshire Annual Letters.
- Munger, C. (2005). *Poor Charlie's Almanack*. Donning.
- Lynch, P. (1989). *One Up On Wall Street*. Simon & Schuster.
- Fisher, P. (1958). *Common Stocks and Uncommon Profits*. Harper.
- Marks, H. (2011). *The Most Important Thing*; (2018) *Mastering the Market Cycle*.
- Dorsey, P. (2008). *The Little Book That Builds Wealth*. Wiley.
- Helmer, H. (2016). *7 Powers* (보강용).

2차 분석 자료: Morningstar (Pat Dorsey 인터뷰), Old School Value, Stockopedia, Validea, Macro Ops, Picture Perfect Portfolios, Trustnet, Novel Investor, Deepvue, ChartMill, Aminext.

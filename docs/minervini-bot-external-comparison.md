# Minervini/SEPA 스크리너 외부 구현 vs Worxphere 봇 비교

> 2026-05-12, v1.2 작업 中 background research agent 산출물. 원본 보관용.
> 요약은 `docs/minervini-bot-criteria.md` §3-1 참조.

## I. 핵심 비교표 (10개 외부 구현 + 우리)

| # | 스크리너 | 유지·소스 | RS 게이트 | MA 8/8 | A1 U/D Vol | E-series 펀더 | F-series 벤치 | L-series 유동성 | P-VCP 정량 | 매수 판정 | 비고 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **icedevil2001/mark_minervini_stock_screener** | GitHub, Streamlit | 70 (기본) | O | X | X | X | Vol ≥500K, 가격 ≥$5 | X | Pass/Fail만 | 8/8만 검증, VCP 無 |
| 2 | **marco-hui-95/vcp_screener** | GitHub, Excel 출력 | 70 (Finviz Perf) | O | X | X | X | MktCap ≥$300M, Vol ≥100K | 2~4 contractions, vol↓ | "후보" 플래그 | RS 출처 Finviz (IBD 아님) |
| 3 | **shiyu2011/cookstock** | GitHub, OpenAI 감성 | 미공개 | O | X | X | X | 미공개 | VCP 있음(정량 미공개) | 미공개 | 코드 미공개 영역 多 |
| 4 | **pkjmesra/PKScreener** | GitHub, NSE India | 별도 | O | X | X | X | 별도 | consolidation 10%, vol ratio 2.5 | 다중 setup | 인도 NSE 한정 |
| 5 | **ChartMill Minervini TTP** | 상용 SaaS | 70~90 | O (8개 중 1개 시각화) | X | EPS·매출 +High Growth Mom ≥6 | X | 시총·평균거래량 필터 | X | Trend Template Pass | 펀더 점수만 별도 |
| 6 | **Deepvue Minervini Preset** | 상용 SaaS | 70+ | O | **O** (자체 인디케이터) | EPS 20~50%, Sales 20%+ | X | X | RMV15<10, 6M%+85% (Power Play) | "breakout 후보" | RMV·Power Play 보조 |
| 7 | **TradingView (다수 Pine)** | Community | 70 (slider) | O | 일부만 | X (대부분) | X | X | ATR contraction (3~5단계) | "VCP 감지" 시각 표시 | Pine Screener 한정 |
| 8 | **TraderLion VCP guide** | 교육·서술 | 정량 X | O | 권장 only | EPS 20%, Sales accel | X | X | 18→12→6%, vol↓ 50%↓ | "breakout volume +40~50%" | 검증 SOP 위주 |
| 9 | **FinerMarketPoints** | 가이드 | 70/90 | O | UDVR>1 권장 | EPS 25%·Sales 25% (3년) | X | 평균거래량 400K~1M | 18→12→6%, base len 미명시 | pivot+stop -7~8% | SEPA 정설 정리 |
| 10 | **QuantVPS** | NinjaTrader 호스팅 | 70+ | O | X | EPS 20~50%, Sales 20%+ | X | X | VCP 정량 X | X | 호스팅·실행 인프라 |
| **★ Ours** | **vcp-screener** | Vercel·Next+Python | **70 (R1) + 80/90 (R2/R3)** | O (B1~B6) | **O (A1)** | **E1/E3/E5/E7/E8/E9/E10** | **F1·F2·F3** | **L1~L4** | **P1~P6 (6단)** | **5단 verdict + pct_to_pivot zone** | 가장 광범위 |

> **결론**: 외부 구현 10개 중 **펀더 E-series·F-series 벤치마크·5단 매수 판정·pct_to_pivot zone**을 모두 갖춘 곳 0개. 우리만의 차별점.

## II. 정설(Universally Agreed) vs 우리 고유

### A. 만장일치 핵심 (모든 구현이 동의)

| 항목 | Worxphere ID | 정설 기준 |
|---|---|---|
| Trend Template 8/8 | B1~B7 | 8 모두 Pass |
| RS Rating ≥ 70 | R1 | 정설 (이상적 90+) |
| Stage 2 (상승추세) | B5, B9 | 200DMA 1개월+ 상승 |
| Pivot 정의 | (Python 측) | 마지막(가장 타이트한) 수축의 고점 |
| Stop-Loss 7~8% | (verdict STOP_OUT) | 합의 |
| 매수 시 거래량 | (A1·V series) | 평균 +40~50% |

### B. 우리 고유 (외부 0건 또는 1~2건만)

| Worxphere ID | 외부 채택률 | 차별 포인트 |
|---|---|---|
| **A1 (U/D Vol Ratio ≥1, 보통 ≥2)** | Deepvue·일부 Pine만 (10건 중 2건) | 대부분 스크리너 누락. SEPA 정설에는 있으나 코드化 드뭄 |
| **E7 (ROE ≥17%)** | ChartMill만 (Growth Score) | Minervini 책에 명시(ROE>17%)이지만 PRIMARY로 거는 곳 없음 → **우리만 hard gate** |
| **F1/F2/F3 (vs SPY/QQQ 1y·6m·1m)** | **0건** | Minervini 책에는 없음. IBD RS 대용으로 우리가 추가한 절대 outperform 측정. **고유 추가** |
| **P1~P6 (VCP 6단 정량)** | TraderLion·일부 Pine만 정량 (P1 tightening / P3 vol dryup) | P2 last_contraction·P4 base_count·P5 monotonic·P6 vol_dryup_strict 정량 분리는 우리뿐 |
| **L1~L4 (4단 유동성)** | 대부분 1단(평균거래량)만 | 시총·dollar volume·spread까지 분리한 곳 없음 |
| **5단 verdict + pct_to_pivot zone** | 외부 0건 (대부분 "후보" 단일 플래그) | BUY_NOW(0~+3%)·BUY_AT_PIVOT(-5~0%)·WATCH·EXTENDED(+5%↑)·AVOID/STOP_OUT — 진입 타이밍 세분화 |

## III. 임계값 갭 (Threshold Delta)

| 항목 | Worxphere | 외부 합의 | 판정 |
|---|---|---|---|
| RS 기본 | 70 (R1) | 70 = 정설 (FinerMP·Deepvue·icedevil) | 일치 |
| RS 강화 | 80 (R2), 90 (R3) | 90+ 권장만, hard gate 없음 | 우리가 더 엄격 |
| 52w High 근접 | 25% (B7), 10% (B8) | 25% 정설 | 일치. B8(10%)는 우리 추가 |
| 52w Low 이격 | 30% (B6) | 30% 정설 | 일치 |
| 200DMA 상승 | 5개월 (B5) | 1개월(정설), 이상적 4~5개월 | **우리 더 엄격** (정설 위반 가능) |
| 거래량 dryup | 0.6× (P3·P6는 더 엄격) | 50%↓ (TraderLion), ATR 1/3 압축 (TrendSpider) | 우리 완만(0.6× = 40% 감소) |
| VCP 수축 단계 | P5 monotonic·P4 base_count | 18→12→6 예시, 2~4단 (Deepvue·marco-hui) | 우리 더 정량 |
| EPS 분기 | E1 (구체 수치 spec 確認 필요) | +20% 정설, 25% (FinerMP), 40~50% 선호 | — |
| EPS 연간 3y | H4 (CAGR) | 25% × 3y (FinerMP·Minervini 책) | 일치 |
| ROE | E7 ≥17% | 17% (Minervini 책), 외부 코드化 ChartMill만 | 우리 hard gate (드묾) |
| 시총·유동성 | L1 가격 ≥$10·MktCap ≥$300M·DollarVol | $300M·400K~1M shares (Finer) | 일치 |
| Stop-Loss | -7~8% (verdict) | 7~8% 정설 | 일치 |
| Pivot 진입 | 0~+3% (BUY_NOW), +5%↑ EXTENDED | breakout, +5% extended (정설) | 일치 |

## IV. 매수 판정 차별 (가장 큰 Moat)

| 외부 | 출력 |
|---|---|
| icedevil·marco-hui·PKScreener·ChartMill·Deepvue·TraderLion | "후보" / "Trend Template Pass" / "VCP detected" — **단일 플래그** |
| **Ours** | `BUY_NOW`(0~+3% pivot 위), `BUY_AT_PIVOT`(-5~0%), `WATCH`(-10~-5%), `EXTENDED`(+5%↑ 추격 금지), `AVOID`(B/R/L 실패), `STOP_OUT`(-7~8%↓) |

> 정설(Minervini 책)은 "pivot에서 매수, +5% 넘으면 extended, -7~8% stop"을 서술하지만 **screener output으로 자동 분류한 코드 0건**. 우리 고유 강점.

## V. 구체적 보강 제안 (외부 합의 vs 우리 누락)

| 항목 | 외부 합의 | 우리 현황 | 제안 |
|---|---|---|---|
| **Breakout volume gate** (당일 거래량 ≥1.4~1.5× 50DMA avg) | 정설 (TraderLion·FinerMP·Deepvue) | A1(U/D ratio)만 있음. 당일 breakout vol surge 별도 없음 | **신규 PRIMARY 후보: A2_breakout_vol_surge** |
| **ATR 압축률** (ATR 1/3 of 50d avg) | TrendSpider·TraderLion·일부 Pine | V1/V2 있음 (SECONDARY) | V1을 PRIMARY로 승격 검토 |
| **Pocket Pivot** (Minervini 후속 도구) | TradingView Pine 다수 (Pocket Pivot indicator) | 없음 | 신규 SECONDARY 후보 — 단 정설 트렌드 템플릿 외 |
| **Industry Group Strength** (top quartile) | Deepvue·QuantVPS·SEPA 정설 | 없음 | 신규 후보 — 다만 Coverage Universe 限定 운영 시 의미 限 |

### V-2. 과잉 가능성 (우리만 엄격하게 거는 것)

| Worxphere ID | 검토 |
|---|---|
| **B5 (200DMA 5개월 상승)** | 정설은 "1개월". 5개월은 too strict — 정상 Stage 2 진입 직후 종목 탈락 위험 → **1개월 기본 + 5개월은 R3 류 보너스로 분리** 권고 |
| **E7 (ROE 17% PRIMARY)** | Minervini 책에 있으나 IBD·외부 screener는 PRIMARY로 안 검. 성장 초기 高 ROE 미달 종목 누락 우려 → **PRIMARY 유지하되 임계 15%로 완화** 또는 SECONDARY 강등 검토 |
| **F1 (1y outperform vs SPY)** | RS70 (R1)과 정보 중복 가능. R1과 F1 상관성 점검 필요 → 둘 중 하나만 PRIMARY |
| **P4 (base_count) PRIMARY** | 정설은 "2~6 contractions". 1~2회만으로도 valid Cup pattern 존재 → **base_count 2 이상**이면 충분, **3 이상 강제**는 과잉 |

## VI. v1.3 작업 후보 (우선순위)

1. **B5 임계 5→1개월 완화** (정설 정렬, 1줄 코드 변경)
2. **A2 신규 PRIMARY** (당일 vol ≥1.4× 50DMA avg) — 외부 합의 누락 보완
3. **E7 임계 17→15%** 또는 SECONDARY 강등
4. **F1 vs R1 redundancy 백테스트** → 한쪽 PRIMARY 해제

## Sources

- icedevil2001 GitHub: https://github.com/icedevil2001/mark_minervini_stock_screener
- marco-hui-95 GitHub: https://github.com/marco-hui-95/vcp_screener.github.io
- shiyu2011 cookstock: https://github.com/shiyu2011/cookstock
- pkjmesra PKScreener: https://github.com/pkjmesra/PKScreener
- ChartMill TTP: https://www.chartmill.com/trading-ideas/645-Mark-Minervinis-Trend-Template-TTP
- ChartMill Strategy Part1: https://www.chartmill.com/documentation/stock-screener/fundamental-analysis-investing-strategies/464-Mark-Minervini-Strategy-Think-and-Trade-Like-a-Champion-Part-1
- Deepvue Trend Template: https://deepvue.com/screener/minervini-trend-template/
- Deepvue VCP: https://deepvue.com/screener/volatility-contraction-pattern/
- Deepvue How: https://deepvue.com/screener/how-mark-minervini-screens-for-stocks/
- TraderLion VCP: https://traderlion.com/technical-analysis/volatility-contraction-pattern/
- FinerMarketPoints SEPA: https://www.finermarketpoints.com/post/what-is-mark-minervini-s-trading-strategy-the-complete-sepa-vcp-guide
- FinerMarketPoints Screener: https://www.finermarketpoints.com/post/mark-minervini-s-stock-screener-what-indicators-and-criteria-does-he-use
- QuantVPS: https://www.quantvps.com/blog/mark-minervinis-guide-to-finding-winning-stocks
- AskLivermore Minervini: https://asklivermore.com/docs/minervini
- TradingView VCP-Minervini v2: https://www.tradingview.com/script/q2IGWu2N-VCP-Minervini-v2/
- TradingView LevelUp screener: https://www.tradingview.com/script/xt1TZYqW-Minervini-Trend-Template-Screener-LevelUp/

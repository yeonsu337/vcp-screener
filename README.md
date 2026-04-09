# VCP Screener

Mark Minervini Trend Template + Volatility Contraction Pattern 스크리너.
미국 NASDAQ/NYSE/AMEX 상장 종목 대상.

## 아키텍처

```
Finviz (Trend Template 사전 필터)
   ↓  ~200-400 ticker
yfinance (OHLCV 2y 배치 다운로드)
   ↓
IBD RS Rating 산출 (1-99 percentile)
   ↓  RS ≥ 70
VCP 패턴 검출 (수축, 거래량 dry-up, pivot)
   ↓
Streamlit UI (테이블 + Plotly 차트)
```

**왜 Finviz 우선?** 600+ 종목 OHLCV를 전부 다운받지 않아도 Finviz가 SMA 기반 사전 필터링을 제공 → 통과 종목(~200개)만 다운로드 → 훨씬 빠르고 가벼움.

## 설치

```bash
cd C:/Users/rainkys6069/Desktop/Worxphere/Projects/vcp-screener
py -m pip install -r requirements.txt
```

## 실행

```bash
py -m streamlit run app.py
```

브라우저가 자동으로 열림 (기본: http://localhost:8501).

## 사용법

1. 사이드바에서 **Min RS Rating**, **Min VCP Score**, **VCP detected only** 조정
2. **▶ Run Screener** 클릭 → ~30초 대기
3. 결과 테이블에서 score 기준 정렬
4. 아래 **Chart** 섹션에서 ticker 선택 → 캔들차트 + 50/150/200 SMA + pivot line

## 필터 로직

### Trend Template (Finviz 사전 필터)
- Country: USA, Price ≥ $10, AvgVol ≥ 500K
- SMA50 > SMA200 (Stage 2)
- Price > SMA200
- SMA20 > SMA50
- 52W High 기준 ≤10% 이내 (pivot 근접)
- Quarter Up (분기 성과 양의)

### RS Rating (IBD 방식)
`0.4*Q1 + 0.2*Q2 + 0.2*Q3 + 0.2*Q4` (최근 분기 가중) → universe 내 1-99 percentile

### VCP 패턴 검출
- 최근 90bar 내 swing high/low 검출 (scipy.find_peaks)
- 2회 이상 연속 수축 + 매번 ≤ 직전 × 1.10 (10% 노이즈 허용)
- 마지막 수축 < 15%
- 최근 5일 평균 거래량 < base 평균 × 0.95 (dry-up)
- 현재가 pivot 기준 -12% 이내

## 파일 구조

```
vcp-screener/
├── screener.py       ← 핵심 로직 (Finviz + yfinance + VCP 검출)
├── app.py            ← Streamlit UI
├── requirements.txt
└── .cache/           ← Finviz/yfinance 캐시 + 마지막 실행 결과
```

## 커스터마이징

- **VCP 임계**: `screener.py` `detect_vcp()` — last_pct, vol_ratio, pct_to_pivot 조정
- **Trend Template 필터**: `screener.py` `TREND_TEMPLATE_FILTERS` 수정
- **Universe 확장**: Country 필터 제거 또는 국가 추가

## 한계

- Finviz 공식 API 없음 → 스크래핑 기반. Finviz 레이아웃 변경 시 `finvizfinance` 업데이트 필요
- yfinance 실시간 아님 (15분 지연)
- VCP "tennis ball action"은 로직에 포함 안 됨 (pullback 깊이만 측정)

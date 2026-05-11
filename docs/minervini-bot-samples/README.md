# Minervini Bot — Worked Samples

3개 종목의 봇 권고 JSON 예시. `../minervini-bot-persona.md` 스펙 준수.

## Files

| File | Ticker | Verdict | 핵심 메시지 |
|---|---|---|---|
| `KEYS.json` | Keysight Technologies | **BUY_NOW** | Pivot $352.78 돌파 직후(+0.65%), buy zone 내. 4개 베이스·NI CAGR 약점에도 진입 유효 |
| `VRT.json` | Vertiv Holdings | **WATCH** | RS 94 + 추세 강세, 그러나 5번째 수축이 4번째보다 확대 — 단조 감소 위반 + U/D Volume 0.81 분배 신호. Setup 재형성 대기 |
| `MTZ.json` | MasTec | **EXTENDED** | Pivot 대비 +25.4% — buy zone 초과. 추세는 살아있으나 risk/reward 붕괴, 다음 베이스 대기 |

## How each sample was constructed

1. `web/public/data/results.json`에서 ticker의 14 Primary 룰 + 25 Bonus 룰 결과 추출
2. `minervini-bot-persona.md` §5 Reasoning Structure 9-step 적용
3. Verdict 분류 (§3 Decision Matrix)
4. Entry/stop/target 계산:
   - BUY_NOW: entry = current_price, stop = entry × 0.93, target1 = entry × 1.20
   - WATCH / EXTENDED: entry = null, stop/target도 null (또는 reference로 표시)
5. 4~5줄 한국어 권고문 생성 (§4 Output Format)
6. 메타데이터(`rule_references`, `key_failures`, `warnings`, `narrative_internal`) 채움

## Plug into existing pipeline

### 1. 저장 경로

운영 시 봇 출력은 `web/public/data/minervini-bot/<ticker>.json`에 저장. 본 docs/samples는 spec 검증용 reference.

### 2. 생성 스크립트 (제안)

`scripts/generate_minervini_calls.py` (Python) 신설:

```python
# pseudo
import json
from pathlib import Path

ROOT = Path(__file__).parent.parent
results = json.loads((ROOT / "web/public/data/results.json").read_text())

PRIMARY_IDS = ["A1_ud_vol_ratio","B1_price_above_150_200", ...]  # page.tsx와 동일

for row in results:
    primary_pass = sum(1 for rid in PRIMARY_IDS if row["rules"].get(rid,{}).get("passed"))
    if not row["detected"] and primary_pass < 12:
        continue
    draft = build_draft(row)              # deterministic rule engine
    lines = gloss(draft)                  # 템플릿 or LLM
    call = assemble_call(row, draft, lines)
    out = ROOT / "web/public/data/minervini-bot" / f"{row['ticker'].replace('.','_')}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(call, ensure_ascii=False, indent=2), encoding="utf-8")
```

### 3. Cron 통합

기존 daily screener cron(`update_screener.py` 등)의 마지막 step으로 `generate_minervini_calls.py` 호출. 종목당 < 50ms (deterministic) — 80종목 < 5초.

### 4. UI 노출

`web/app/screener/[ticker]/page.tsx` 수정 (persona doc §7 참조):

```tsx
import MinerviniCall from "./MinerviniCall";
// ...
const call = loadMinerviniCall(ticker);
// header 아래, ChartClient 위에 삽입
<MinerviniCall call={call} />
```

### 5. 정적 빌드

이미 `dynamic = "force-static"` + `generateStaticParams` 사용 중이므로, `public/data/minervini-bot/*.json` 파일들도 Vercel 빌드 시 자동 포함됨. 별도 API route 불필요.

## Validation

샘플 3개 모두 persona §9 체크리스트 통과:
- 4~5줄, 각 줄 70자 이내
- 명사형 종결 (~임, ~다, ~함)
- 가격은 $·소수점 2자리, % 소수점 1~2자리
- 금지 어휘 부재
- verdict + setup + 근거 + action 4섹션 구조 준수

## Next

봇 v1.1에 추가 권장:
- `STOP_OUT` verdict 샘플 (50일선 이탈 보유 종목)
- 시장 약세 헤더(`market_regime: bear`) 샘플
- KR/HK 종목 샘플 (현재 detected 0건이지만 spec 적용성 검증용)
- 백테스트 모듈: `detection_history.json`과 cross-reference로 봇 verdict별 실제 수익률 추적

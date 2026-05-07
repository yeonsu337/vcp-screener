import fs from "fs";
import path from "path";
import Link from "next/link";
import MacroCharts from "./MacroCharts";

export const dynamic = "force-static";

type Indicator = {
  id: string;
  name: string;
  value: number;
  prev?: number | null;
  change_pct?: number | null;
  unit: string;
  source: string;
  asof: string;
  series?: { time: string; value: number }[];
  signal: "bullish" | "neutral" | "bearish";
  note?: string;
};

type Section = {
  sentiment: Indicator[];
  liquidity: Indicator[];
  macro: Indicator[];
};

type MacroData = {
  updated_at: string;
  us: Section;
  kr: Section;
};

function loadMacro(): MacroData | null {
  const p = path.join(process.cwd(), "public", "data", "macro.json");
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as MacroData;
  } catch {
    return null;
  }
}

const SIGNAL_STYLE: Record<Indicator["signal"], string> = {
  bullish: "bg-emerald-500/10 border-emerald-500/30 text-emerald-300",
  neutral: "bg-border/30 border-border text-muted",
  bearish: "bg-red-500/10 border-red-500/30 text-red-300",
};

const SIGNAL_LABEL: Record<Indicator["signal"], string> = {
  bullish: "BULL",
  neutral: "NEUT",
  bearish: "BEAR",
};

function fmtVal(v: number, unit: string): string {
  if (unit.includes("$") || unit.includes("₩")) {
    return v.toLocaleString();
  }
  if (Math.abs(v) > 1000) return v.toLocaleString();
  if (Math.abs(v) < 1) return v.toFixed(3);
  return v.toFixed(2);
}

function IndicatorCard({ ind }: { ind: Indicator }) {
  const change = ind.change_pct;
  return (
    <div className={`card p-4 border ${SIGNAL_STYLE[ind.signal]}`}>
      <div className="flex items-start justify-between mb-2">
        <div className="text-xs font-semibold uppercase tracking-wide opacity-70">
          {ind.name}
        </div>
        <span
          className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
            ind.signal === "bullish"
              ? "bg-emerald-500/30 text-emerald-200"
              : ind.signal === "bearish"
                ? "bg-red-500/30 text-red-200"
                : "bg-border text-muted"
          }`}
        >
          {SIGNAL_LABEL[ind.signal]}
        </span>
      </div>
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-2xl font-bold num tabular-nums">
          {fmtVal(ind.value, ind.unit)}
        </span>
        <span className="text-[10px] text-muted">{ind.unit}</span>
        {change !== null && change !== undefined && (
          <span
            className={`text-xs num tabular-nums ${
              change >= 0 ? "text-emerald-400" : "text-red-400"
            }`}
          >
            {change >= 0 ? "△" : "▽"}
            {Math.abs(change).toFixed(2)}%
          </span>
        )}
      </div>
      {ind.series && ind.series.length > 1 && (
        <div className="my-2">
          <MacroCharts series={ind.series} signal={ind.signal} />
        </div>
      )}
      {ind.note && (
        <div className="text-[10px] opacity-80 leading-relaxed mt-1.5">
          {ind.note}
        </div>
      )}
      <div className="text-[9px] text-muted mt-2 pt-2 border-t border-border/30 flex justify-between">
        <span>{ind.source}</span>
        <span>{ind.asof}</span>
      </div>
    </div>
  );
}

function SectionBlock({
  title,
  description,
  indicators,
}: {
  title: string;
  description: string;
  indicators: Indicator[];
}) {
  if (indicators.length === 0) return null;
  return (
    <section className="mb-6">
      <div className="mb-3">
        <h3 className="text-base font-bold">{title}</h3>
        <p className="text-xs text-muted mt-0.5">{description}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {indicators.map((ind) => (
          <IndicatorCard key={ind.id} ind={ind} />
        ))}
      </div>
    </section>
  );
}

function ConsensusBadge({ section }: { section: Section }) {
  const all = [...section.sentiment, ...section.liquidity, ...section.macro];
  const counts = all.reduce(
    (acc, i) => {
      acc[i.signal] = (acc[i.signal] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  const total = all.length || 1;
  const bullishPct = ((counts.bullish || 0) / total) * 100;
  const bearishPct = ((counts.bearish || 0) / total) * 100;
  const consensus =
    bullishPct >= 50
      ? "Risk-On"
      : bearishPct >= 50
        ? "Risk-Off"
        : "Mixed";
  const consensusColor =
    consensus === "Risk-On"
      ? "text-emerald-400"
      : consensus === "Risk-Off"
        ? "text-red-400"
        : "text-yellow-400";
  return (
    <div className="card p-4 mb-4">
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className={`text-2xl font-bold ${consensusColor}`}>
          {consensus}
        </span>
        <span className="text-xs text-muted">
          {counts.bullish || 0} bull · {counts.neutral || 0} neut ·{" "}
          {counts.bearish || 0} bear ({total} 지표)
        </span>
      </div>
      <div className="mt-2 flex gap-1 h-2 rounded overflow-hidden bg-border/30">
        <div
          className="bg-emerald-400"
          style={{ width: `${((counts.bullish || 0) / total) * 100}%` }}
        />
        <div
          className="bg-yellow-400"
          style={{ width: `${((counts.neutral || 0) / total) * 100}%` }}
        />
        <div
          className="bg-red-400"
          style={{ width: `${((counts.bearish || 0) / total) * 100}%` }}
        />
      </div>
    </div>
  );
}

export default function MacroPage() {
  const data = loadMacro();
  if (!data) {
    return (
      <main className="max-w-4xl mx-auto px-4 py-10">
        <h1 className="text-3xl font-bold mb-3">Macro Dashboard</h1>
        <p className="text-muted">
          매크로 데이터가 아직 생성되지 않았습니다. <code>scripts/fetch_macro.py</code> 실행
          후 다시 시도하세요.
        </p>
      </main>
    );
  }

  return (
    <main className="max-w-7xl mx-auto px-4 py-6 md:py-10">
      <nav className="mb-4 flex items-center gap-3 text-sm">
        <Link href="/" className="text-muted hover:text-accent transition">
          ← Home
        </Link>
      </nav>

      <header className="mb-6">
        <h1 className="text-3xl font-bold mb-1">Macro Dashboard</h1>
        <p className="text-sm text-muted">
          시장심리·유동성·매크로 — 美/韓 주요 지표 한눈에 보기
        </p>
        <div className="text-[10px] text-muted mt-1">
          Updated {new Date(data.updated_at).toLocaleString("ko-KR")} · 무료 소스만 사용
          (Yahoo Finance · FRED · CNN)
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* US column */}
        <div>
          <h2 className="text-xl font-bold mb-3 flex items-center gap-2">
            <span>🇺🇸 美 시장</span>
          </h2>
          <ConsensusBadge section={data.us} />
          <SectionBlock
            title="투자심리 (Sentiment)"
            description="VIX 변동성 + CNN Fear & Greed — 군중심리 위치 파악"
            indicators={data.us.sentiment}
          />
          <SectionBlock
            title="유동성 (Liquidity)"
            description="Fed Funds + M2 + Fed 자산 + RRP — 통화 환경"
            indicators={data.us.liquidity}
          />
          <SectionBlock
            title="매크로·추세 (Macro)"
            description="달러·금리·지수 추세"
            indicators={data.us.macro}
          />
        </div>

        {/* KR column */}
        <div>
          <h2 className="text-xl font-bold mb-3 flex items-center gap-2">
            <span>🇰🇷 韓 시장</span>
          </h2>
          <ConsensusBadge section={data.kr} />
          <SectionBlock
            title="투자심리 (Sentiment)"
            description="KOSPI 변동성 + KOSDAQ/KOSPI 상대강도 (위험선호 게이지)"
            indicators={data.kr.sentiment}
          />
          <SectionBlock
            title="유동성 (Liquidity)"
            description="기준금리 — 한국은행 ECOS 키 등록 시 신용잔고·MMF 추가 가능"
            indicators={data.kr.liquidity}
          />
          <SectionBlock
            title="매크로·추세 (Macro)"
            description="환율·KOSPI 추세"
            indicators={data.kr.macro}
          />
        </div>
      </div>

      <footer className="mt-10 pt-6 border-t border-border text-xs text-muted">
        <div className="mb-2">
          <strong>지표 정의:</strong>{" "}
          BULL = 위험선호 우호 / NEUT = 중립 / BEAR = 위험회피·경계.
          시그널은 단일 지표 임계값 기반 (예: VIX&gt;30=BEAR), Risk-On/Off는 섹션 다수결.
        </div>
        <div>
          <strong>확장 가능 (현재 미구현):</strong> 한국은행 ECOS API 등록 시 본원통화·M2·신용잔고·MMF 자금
          / SEC 13F flows / AAII Sentiment / NAAIM Exposure / FOMC dot plot.
          유료 전환 없이 추가 가능한 무료 소스 한정.
        </div>
      </footer>
    </main>
  );
}

import fs from "fs";
import path from "path";
import Link from "next/link";
import type { Candidate } from "../types";

export const dynamic = "force-static";
export const revalidate = 3600;

const PRIMARY_IDS = [
  "A1_ud_vol_ratio",
  "B1_price_above_150_200",
  "B2_sma150_gt_sma200",
  "B3_sma50_gt_150_200",
  "B4_price_above_sma50",
  "B5_sma200_rising_5mo",
  "B6_30pct_above_52w_low",
  "B7_within_25pct_high",
  "R1_rs_70",
  "L1_liquidity_gate",
  "P6_monotonic_decreasing",
  "E7_roe",
  "F1_outperform_1y",
  "H4_ni_cagr_3y",
];
const PRIMARY_THRESHOLD = 12;

type IndexEntry = {
  ticker: string;
  company: string;
  market: string;
  sector: string;
  primary_passed: number;
  primary_total: number;
  generated_at: string;
  llm_status: string;
  report_count?: number;
};

function loadResearchIndex(): IndexEntry[] {
  const p = path.join(process.cwd(), "public", "data", "research", "index.json");
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as IndexEntry[];
  } catch {
    return [];
  }
}

function loadQualifyingCandidates(): Candidate[] {
  const p = path.join(process.cwd(), "public", "data", "results.json");
  if (!fs.existsSync(p)) return [];
  try {
    const rows: Candidate[] = JSON.parse(fs.readFileSync(p, "utf-8"));
    return rows.filter((r) => {
      if (!r.rules) return false;
      const passed = PRIMARY_IDS.reduce(
        (acc, id) => acc + (r.rules?.[id]?.passed ? 1 : 0),
        0,
      );
      return passed >= PRIMARY_THRESHOLD;
    });
  } catch {
    return [];
  }
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
}

export default function ResearchPage() {
  const generated = loadResearchIndex();
  const qualifying = loadQualifyingCandidates();

  const generatedByTicker = new Map(generated.map((g) => [g.ticker, g]));
  const pendingTickers = qualifying.filter((q) => !generatedByTicker.has(q.ticker));

  return (
    <main className="max-w-6xl mx-auto px-4 py-6 md:py-10">
      <nav className="mb-4">
        <Link href="/" className="text-sm text-muted hover:text-accent">
          ← 홈
        </Link>
      </nav>

      <header className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
          기업 리서치
        </h1>
        <p className="text-muted text-sm mt-1">
          Primary {PRIMARY_IDS.length}개 룰 중 {PRIMARY_THRESHOLD}+ 통과 종목 대상 5-Tier 자동 리서치.
          출처: SEC EDGAR (10-K), Yahoo Finance, Wikipedia, Gemini 2.5 Flash (무료 티어).
        </p>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <div className="card p-3">
          <div className="text-xs text-muted">생성된 리서치 카드</div>
          <div className="text-2xl font-bold num text-accent">{generated.length}</div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-muted">자격 종목 (Primary {PRIMARY_THRESHOLD}+)</div>
          <div className="text-2xl font-bold num">{qualifying.length}</div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-muted">생성 대기</div>
          <div className="text-2xl font-bold num">{pendingTickers.length}</div>
        </div>
      </section>

      {generated.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-3">
            리서치 카드 목록
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {generated.map((r) => {
              const llmOk = r.llm_status === "ok";
              return (
                <Link
                  key={r.ticker}
                  href={`/research/${encodeURIComponent(r.ticker)}`}
                  className="card p-4 hover:border-accent/40 transition-colors block"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="font-bold text-lg">{r.ticker}</div>
                      <div className="text-xs text-muted">{r.company}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-semibold num text-emerald-400">
                        {r.primary_passed}/{r.primary_total}
                      </div>
                      <div className="text-[10px] text-muted">{r.market}</div>
                    </div>
                  </div>
                  <div className="text-[10px] text-muted">{r.sector}</div>
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/40 gap-2">
                    <span className="text-[10px] text-muted">{fmtDate(r.generated_at)}</span>
                    <div className="flex items-center gap-1.5">
                      {(r.report_count ?? 0) > 0 && (
                        <span className="text-[10px] font-semibold text-blue-400">
                          📄 {r.report_count}
                        </span>
                      )}
                      <span
                        className={`text-[10px] font-semibold ${
                          llmOk ? "text-emerald-400" : "text-yellow-400"
                        }`}
                      >
                        {llmOk ? "✓ 전체" : "⚠ 정량만"}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {pendingTickers.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-3">
            생성 대기 — 다음 데일리 스캔에 처리
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {pendingTickers.map((r) => (
              <div
                key={r.ticker}
                className="card p-4 opacity-70"
              >
                <div className="font-bold">{r.ticker}</div>
                <div className="text-xs text-muted">{r.company}</div>
                <div className="text-[10px] text-muted mt-1">
                  {r.sector} · RS {r.rs_rating}
                </div>
                <div className="text-[10px] text-yellow-400 mt-2">⏳ 대기 중</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {generated.length === 0 && pendingTickers.length === 0 && (
        <div className="card p-8 text-center text-muted">
          자격 종목 없음. Primary 룰 {PRIMARY_THRESHOLD}+ 통과 시 자동으로 표시됨.
        </div>
      )}

      <footer className="mt-10 pt-6 border-t border-border text-xs text-muted">
        GitHub Actions 데일리 자동 생성. 정량 섹션은 항상 채워짐. LLM 섹션은 repo Secrets의
        Gemini API 키 필요. 투자 자문 아님.
      </footer>
    </main>
  );
}

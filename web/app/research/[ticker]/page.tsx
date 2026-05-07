import fs from "fs";
import path from "path";
import Link from "next/link";

export const dynamic = "force-static";
export const dynamicParams = true;

type Candidate = {
  ticker: string;
  company?: string;
  market?: string;
  sector?: string;
  industry?: string;
  rs_rating?: number;
  score?: number;
  rules?: Record<string, { passed: boolean }>;
};

// =============================================================================
// Types (loose — research JSON shape produced by scripts/company_research.py)
// =============================================================================
type LlmList = string[] | undefined;

type ResearchData = {
  ticker: string;
  company: string;
  market: string;
  sector?: string;
  industry?: string;
  generated_at: string;
  primary_passed: number;
  primary_total: number;
  llm_status: string;
  yf_metadata: {
    market_cap?: number | null;
    shares_outstanding?: number | null;
    employees?: number | null;
    country?: string;
    website?: string;
    beta?: number | null;
  };
  category_a_business: {
    overview?: string;
    milestones?: LlmList;
    business_model?: string;
    revenue_streams?: LlmList;
    value_chain_position?: string;
    products?: LlmList;
    channels?: LlmList;
    key_customers?: string;
    wikipedia_excerpt?: string;
  };
  category_b_financials: {
    roe?: number | null;
    roa?: number | null;
    profit_margin?: number | null;
    operating_margin?: number | null;
    gross_margin?: number | null;
    revenue_growth_ttm?: number | null;
    earnings_growth_ttm?: number | null;
    dividend_yield?: number | null;
    payout_ratio?: number | null;
    annual_revenue?: (number | null)[];
    annual_operating_income?: (number | null)[];
    annual_eps?: (number | null)[];
    annual_free_cf?: (number | null)[];
    annual_total_debt?: (number | null)[];
    annual_equity?: (number | null)[];
    annual_periods?: string[];
    eps_qoq_yoy_pct?: number | null;
    sales_yoy_pct?: number | null;
    ni_cagr_3y_pct?: number | null;
    roe_pct?: number | null;
  };
  category_c_market: {
    tam_estimate_usd_b?: string;
    tam_cagr_pct?: string;
    growth_drivers?: LlmList;
    market_share_pct?: string;
    competitors?: { name: string; differentiation: string }[];
    porter_five_forces?: Record<string, string>;
    competitive_advantages?: LlmList;
    competitive_weaknesses?: LlmList;
  };
  category_d_thesis: {
    rs_rating?: number;
    score?: number;
    vcp_quality?: number;
    stage?: number;
    stage_name?: string;
    peg_ratio?: number | null;
    trailing_pe?: number | null;
    forward_pe?: number | null;
    ev_to_ebitda?: number | null;
    price_to_sales?: number | null;
    stop_loss_pct?: number;
    outperform_1y_vs_nasdaq?: number | null;
    outperform_6m_vs_nasdaq?: number | null;
    outperform_1m_vs_nasdaq?: number | null;
    lynch_category?: string;
    moat_type?: string;
    moat_evidence?: LlmList;
    moat_durability_years?: string;
    new_trigger?: string;
    bull_case?: string;
    base_case?: string;
    bear_case?: string;
    key_metrics_to_watch?: LlmList;
  };
  category_e_risks: {
    top_risks?: { category: string; description: string; severity: string }[];
    inversion_scenarios?: LlmList;
    exit_signals?: LlmList;
  };
  wikipedia_summary?: string;
  analyst_reports?: AnalystReport[];
};

type AnalystReport = {
  source_filename: string;
  source_broker: string;
  source_title: string;
  source_mtime?: number;
  ingested_at: string;
  summary?: string;
  rating?: string;
  price_target?: string;
  prior_price_target?: string;
  thesis?: string[];
  catalysts?: string[];
  risks?: string[];
  key_numbers?: string[];
  report_date?: string;
};

// =============================================================================
// Static path generation
// =============================================================================
type IndexEntry = {
  ticker: string;
  company: string;
  market: string;
  sector: string;
  primary_passed: number;
  primary_total: number;
  generated_at: string;
  llm_status: string;
};

// Pre-render any ticker that either has a research card or is a Primary 12+ candidate.
const PRIMARY_IDS_FOR_RESEARCH = [
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

export async function generateStaticParams() {
  const tickers = new Set<string>();
  const idx = path.join(process.cwd(), "public", "data", "research", "index.json");
  if (fs.existsSync(idx)) {
    try {
      const list: IndexEntry[] = JSON.parse(fs.readFileSync(idx, "utf-8"));
      list.forEach((r) => tickers.add(r.ticker));
    } catch {}
  }
  const results = path.join(process.cwd(), "public", "data", "results.json");
  if (fs.existsSync(results)) {
    try {
      const rows: Candidate[] = JSON.parse(fs.readFileSync(results, "utf-8"));
      rows.forEach((r) => {
        if (!r.rules) return;
        const passed = PRIMARY_IDS_FOR_RESEARCH.reduce(
          (acc, id) => acc + (r.rules?.[id]?.passed ? 1 : 0),
          0,
        );
        if (passed >= 12) tickers.add(r.ticker);
      });
    } catch {}
  }
  return Array.from(tickers).map((t) => ({ ticker: t }));
}

function loadCandidate(ticker: string): Candidate | null {
  const p = path.join(process.cwd(), "public", "data", "results.json");
  if (!fs.existsSync(p)) return null;
  try {
    const rows: Candidate[] = JSON.parse(fs.readFileSync(p, "utf-8"));
    return rows.find((r) => r.ticker === ticker) ?? null;
  } catch {
    return null;
  }
}

function loadResearch(ticker: string): ResearchData | null {
  const safe = ticker.replace(/\./g, "_");
  const p = path.join(process.cwd(), "public", "data", "research", `${safe}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as ResearchData;
  } catch {
    return null;
  }
}

// =============================================================================
// Formatting helpers
// =============================================================================
function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toFixed(digits);
}

function fmtBigUSD(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
  if (a >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${v.toFixed(0)}`;
}

function fmtPctSigned(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { timeZone: "UTC", hour12: false }) + " UTC";
}

// =============================================================================
// Card components
// =============================================================================
function Section({
  title,
  badge,
  children,
}: {
  title: string;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">{title}</h3>
        {badge && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-border text-muted">
            {badge}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function MetricRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-baseline justify-between py-1 text-sm border-b border-border/40 last:border-b-0">
      <span className="text-muted text-xs">{label}</span>
      <span className={`num font-semibold tabular-nums ${highlight ? "text-accent" : ""}`}>
        {value}
      </span>
    </div>
  );
}

function Bullets({ items }: { items: string[] | undefined }) {
  if (!items || items.length === 0)
    return <div className="text-xs text-muted italic">데이터 없음 (LLM 미실행)</div>;
  return (
    <ul className="text-sm space-y-1.5">
      {items.map((s, i) => (
        <li key={i} className="text-text/90 leading-snug">
          <span className="text-accent mr-2">▸</span>
          {s}
        </li>
      ))}
    </ul>
  );
}

function NotAvailable() {
  return (
    <div className="text-xs text-muted italic">
      LLM 데이터 없음. <code className="bg-border/30 px-1 rounded">GEMINI_API_KEY</code>{" "}
      등록 후 다음 데일리 스캔에서 채워짐.
    </div>
  );
}

function ratingColor(rating?: string): string {
  if (!rating) return "text-muted";
  const up = rating.toUpperCase();
  if (up.includes("BUY") || up.includes("OUTPERFORM") || up.includes("OVERWEIGHT")) {
    return "text-emerald-400";
  }
  if (up.includes("SELL") || up.includes("UNDERPERFORM") || up.includes("UNDERWEIGHT")) {
    return "text-red-400";
  }
  return "text-yellow-400";
}

function AnalystReportCard({ r }: { r: AnalystReport }) {
  return (
    <div className="border border-border/60 rounded p-3">
      <div className="flex items-baseline justify-between gap-2 mb-1.5 flex-wrap">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-xs font-semibold text-accent">{r.source_broker}</span>
          {r.report_date && (
            <span className="text-[10px] text-muted">{r.report_date}</span>
          )}
          {r.rating && r.rating !== "N/A" && (
            <span className={`text-[10px] font-semibold uppercase ${ratingColor(r.rating)}`}>
              {r.rating}
            </span>
          )}
          {r.price_target && r.price_target !== "N/A" && (
            <span className="text-[10px] font-semibold text-text/90">
              PT {r.price_target}
              {r.prior_price_target && r.prior_price_target !== r.price_target && (
                <span className="text-muted"> (prev {r.prior_price_target})</span>
              )}
            </span>
          )}
        </div>
      </div>
      <div className="text-[11px] text-muted leading-snug mb-2 italic">
        {r.source_title}
      </div>
      {r.summary && (
        <p className="text-sm leading-relaxed mb-2">{r.summary}</p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
        {r.thesis && r.thesis.length > 0 && (
          <div>
            <div className="text-[10px] font-semibold text-emerald-400 uppercase mb-1">
              논거
            </div>
            <Bullets items={r.thesis} />
          </div>
        )}
        {r.catalysts && r.catalysts.length > 0 && (
          <div>
            <div className="text-[10px] font-semibold text-blue-400 uppercase mb-1">
              촉매 / 이벤트
            </div>
            <Bullets items={r.catalysts} />
          </div>
        )}
        {r.risks && r.risks.length > 0 && (
          <div>
            <div className="text-[10px] font-semibold text-red-400 uppercase mb-1">
              리스크
            </div>
            <Bullets items={r.risks} />
          </div>
        )}
        {r.key_numbers && r.key_numbers.length > 0 && (
          <div>
            <div className="text-[10px] font-semibold text-muted uppercase mb-1">
              핵심 수치
            </div>
            <Bullets items={r.key_numbers} />
          </div>
        )}
      </div>
      <div className="mt-2 pt-2 border-t border-border/40 text-[9px] text-muted/70 truncate">
        출처: {r.source_filename}
      </div>
    </div>
  );
}

// =============================================================================
// Main page
// =============================================================================
export default function ResearchTickerPage({ params }: { params: { ticker: string } }) {
  const data = loadResearch(params.ticker);

  // Graceful fallback when research card hasn't been generated yet.
  if (!data) {
    const cand = loadCandidate(params.ticker);
    const passed = cand?.rules
      ? PRIMARY_IDS_FOR_RESEARCH.reduce(
          (acc, id) => acc + (cand.rules?.[id]?.passed ? 1 : 0),
          0,
        )
      : 0;
    return (
      <main className="max-w-3xl mx-auto px-4 py-10">
        <nav className="mb-4 flex items-center gap-3 text-sm">
          <Link href="/" className="text-muted hover:text-accent">← 홈</Link>
          <span className="text-border">/</span>
          <Link href="/research" className="text-muted hover:text-accent">리서치</Link>
        </nav>
        <header className="mb-6">
          <h1 className="text-3xl font-bold">{params.ticker}</h1>
          {cand && (
            <div className="text-sm text-muted mt-1">
              {cand.company} · {cand.sector} {cand.industry ? "·" : ""} {cand.industry}
            </div>
          )}
        </header>
        <div className="card p-6">
          <div className="text-yellow-400 text-sm font-semibold mb-2">
            ⏳ {params.ticker} 리서치 카드 미생성
          </div>
          {cand ? (
            <p className="text-sm text-text/80 mb-4">
              이 종목은 Primary 룰 <span className="num font-semibold">{passed}/14</span>개
              통과 — 다음 데일리 리서치 큐에 대기 중.
              {passed < 12 && (
                <>
                  {" "}단, 자동 리서치 기준(12+)에 미달.
                </>
              )}
            </p>
          ) : (
            <p className="text-sm text-text/80 mb-4">
              {params.ticker}은 최신 스캔에 없음. 스크리너에서 현재 후보를 확인.
            </p>
          )}
          <div className="text-xs text-muted leading-relaxed mb-4">
            리서치 카드는 평일 데일리 VCP 스캔 후 자동 생성 (~23:00 UTC).
            Gemini 무료 티어 한도(10 RPM / 250 RPD) 때문에 32개 카드 생성에 ~15분 소요.
            오늘 GitHub Actions 워크플로 완료 시 자동 채워짐.
          </div>
          <div className="flex gap-2 flex-wrap">
            <Link
              href={`/screener/${encodeURIComponent(params.ticker)}`}
              className="inline-flex px-3 py-1.5 rounded bg-accent/20 text-accent text-xs font-semibold hover:bg-accent/30"
            >
              차트 보기 →
            </Link>
            <Link
              href="/research"
              className="inline-flex px-3 py-1.5 rounded border border-border text-xs font-semibold hover:border-accent/40"
            >
              ← 리서치 목록으로
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const a = data.category_a_business || {};
  const b = data.category_b_financials || {};
  const c = data.category_c_market || {};
  const d = data.category_d_thesis || {};
  const e = data.category_e_risks || {};
  const llmEmpty = data.llm_status !== "ok";
  const isDeskResearch = data.llm_status?.startsWith("desk-research");

  return (
    <main className="max-w-7xl mx-auto px-4 py-6 md:py-10">
      <nav className="mb-4 flex items-center gap-3 text-sm">
        <Link href="/" className="text-muted hover:text-accent transition">
          ← 홈
        </Link>
        <span className="text-border">/</span>
        <Link href="/research" className="text-muted hover:text-accent transition">
          리서치
        </Link>
        <span className="text-border">/</span>
        <Link
          href={`/screener/${encodeURIComponent(data.ticker)}`}
          className="text-muted hover:text-accent transition"
        >
          차트
        </Link>
      </nav>

      <header className="mb-5">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="text-3xl font-bold">{data.ticker}</h1>
          <span className="text-muted text-base">{data.company}</span>
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-border text-muted uppercase">
            {data.market}
          </span>
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400">
            Primary {data.primary_passed}/{data.primary_total}
          </span>
        </div>
        <div className="text-xs text-muted mt-1">
          {data.sector} {data.sector && data.industry ? "·" : ""} {data.industry}
          {" · "} 생성: {fmtDateTime(data.generated_at)}
        </div>
        {llmEmpty && !isDeskResearch && (
          <div className="mt-3 p-2 rounded border border-yellow-500/30 bg-yellow-500/10 text-xs text-yellow-400">
            ⚠ LLM 섹션 비활성: {data.llm_status}. 사업모델·시장·해자·리스크 섹션은 비어 있음.
          </div>
        )}
        {isDeskResearch && (
          <div className="mt-3 p-2 rounded border border-blue-500/30 bg-blue-500/10 text-xs text-blue-300">
            📰 데스크 리서치 모드 — Gemini 무료 한도(250 RPD) 초과로 yfinance + SEC 10-K + Wikipedia 추출 기반.
            LLM 한도 회복 시 다음 데일리 스캔에서 자동 재생성.
          </div>
        )}
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* === Tier A. Business Model === */}
        <Section title="A. 사업 모델 · 연혁">
          {a.overview ? (
            <>
              <p className="text-sm leading-relaxed mb-3">{a.overview}</p>
              {a.business_model && (
                <div className="text-xs text-muted mb-2">
                  <span className="font-semibold text-text/80">사업 모델:</span> {a.business_model}
                </div>
              )}
              {a.value_chain_position && (
                <div className="text-xs text-muted mb-2">
                  <span className="font-semibold text-text/80">밸류체인 위치:</span>{" "}
                  {a.value_chain_position}
                </div>
              )}
              {a.key_customers && (
                <div className="text-xs text-muted mb-3">
                  <span className="font-semibold text-text/80">주요 고객:</span> {a.key_customers}
                </div>
              )}
              {a.revenue_streams && (
                <div className="mb-3">
                  <div className="text-[10px] font-semibold text-muted uppercase mb-1">
                    매출 구성
                  </div>
                  <Bullets items={a.revenue_streams} />
                </div>
              )}
              {a.products && (
                <div className="mb-3">
                  <div className="text-[10px] font-semibold text-muted uppercase mb-1">
                    제품 · 서비스
                  </div>
                  <Bullets items={a.products} />
                </div>
              )}
              {a.channels && (
                <div className="mb-3">
                  <div className="text-[10px] font-semibold text-muted uppercase mb-1">
                    유통 채널
                  </div>
                  <Bullets items={a.channels} />
                </div>
              )}
              {a.milestones && (
                <div>
                  <div className="text-[10px] font-semibold text-muted uppercase mb-1">
                    주요 연혁
                  </div>
                  <Bullets items={a.milestones} />
                </div>
              )}
              {a.wikipedia_excerpt && (
                <div className="mt-3 pt-3 border-t border-border/40">
                  <div className="text-[10px] font-semibold text-muted uppercase mb-1">
                    위키피디아 발췌
                  </div>
                  <p className="text-xs text-text/70 leading-relaxed">{a.wikipedia_excerpt}</p>
                </div>
              )}
            </>
          ) : (
            <NotAvailable />
          )}
        </Section>

        {/* === Tier B. Financials (auto, always populated) === */}
        <Section title="B. 재무 성과" badge="AUTO">
          <div className="grid grid-cols-2 gap-x-4">
            <div>
              <MetricRow label="ROE" value={fmtPct(b.roe ?? null)} />
              <MetricRow label="ROA" value={fmtPct(b.roa ?? null)} />
              <MetricRow
                label="영업이익률"
                value={fmtPct(b.operating_margin ?? null)}
              />
              <MetricRow label="순이익률" value={fmtPct(b.profit_margin ?? null)} />
              <MetricRow label="매출총이익률" value={fmtPct(b.gross_margin ?? null)} />
            </div>
            <div>
              <MetricRow
                label="매출 성장 (TTM)"
                value={fmtPct(b.revenue_growth_ttm ?? null)}
                highlight={(b.revenue_growth_ttm ?? 0) >= 0.25}
              />
              <MetricRow
                label="EPS 성장 (TTM)"
                value={fmtPct(b.earnings_growth_ttm ?? null)}
              />
              <MetricRow
                label="EPS QoQ YoY"
                value={
                  b.eps_qoq_yoy_pct !== null && b.eps_qoq_yoy_pct !== undefined
                    ? fmtPctSigned(b.eps_qoq_yoy_pct)
                    : "—"
                }
              />
              <MetricRow
                label="3년 순이익 CAGR"
                value={
                  b.ni_cagr_3y_pct !== null && b.ni_cagr_3y_pct !== undefined
                    ? fmtPctSigned(b.ni_cagr_3y_pct)
                    : "—"
                }
                highlight={(b.ni_cagr_3y_pct ?? 0) >= 25}
              />
              <MetricRow
                label="배당수익률"
                value={fmtPct(b.dividend_yield ?? null)}
              />
            </div>
          </div>
          <div className="text-[10px] text-muted mt-2">
            연간 회계기간:{" "}
            {b.annual_periods?.slice().reverse().slice(0, 5).map((p) => p.slice(0, 4)).join(" / ") || "—"}
          </div>
        </Section>

        {/* === Tier C. Market & Competitive === */}
        <Section title="C. 시장 · 경쟁 환경">
          {c.tam_estimate_usd_b ? (
            <>
              <MetricRow label="TAM (총 시장규모)" value={c.tam_estimate_usd_b} />
              <MetricRow label="TAM 연평균성장률" value={c.tam_cagr_pct || "—"} />
              <MetricRow label="시장 점유율" value={c.market_share_pct || "—"} />
              {c.growth_drivers && (
                <div className="mt-3 mb-3">
                  <div className="text-[10px] font-semibold text-muted uppercase mb-1">
                    성장 동인
                  </div>
                  <Bullets items={c.growth_drivers} />
                </div>
              )}
              {c.competitors && c.competitors.length > 0 && (
                <div className="mb-3">
                  <div className="text-[10px] font-semibold text-muted uppercase mb-1">
                    주요 경쟁사
                  </div>
                  <ul className="text-sm space-y-1">
                    {c.competitors.map((cmp, i) => (
                      <li key={i} className="text-text/90">
                        <span className="font-semibold text-accent">{cmp.name}</span>
                        <span className="text-muted text-xs"> — {cmp.differentiation}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {c.porter_five_forces && (
                <div className="mb-3">
                  <div className="text-[10px] font-semibold text-muted uppercase mb-1">
                    포터의 5가지 경쟁요인
                  </div>
                  <ul className="text-xs space-y-0.5 text-text/80">
                    {Object.entries(c.porter_five_forces).map(([k, v]) => {
                      const labelMap: Record<string, string> = {
                        new_entrants: "신규 진입자",
                        substitutes: "대체재",
                        buyer_power: "구매자 교섭력",
                        supplier_power: "공급자 교섭력",
                        rivalry: "기존 경쟁",
                      };
                      return (
                        <li key={k}>
                          <span className="text-muted">{labelMap[k] || k.replace(/_/g, " ")}:</span> {v}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {c.competitive_advantages && (
                <div className="mb-2">
                  <div className="text-[10px] font-semibold text-emerald-400 uppercase mb-1">
                    경쟁 우위
                  </div>
                  <Bullets items={c.competitive_advantages} />
                </div>
              )}
              {c.competitive_weaknesses && (
                <div>
                  <div className="text-[10px] font-semibold text-red-400 uppercase mb-1">
                    경쟁 열위
                  </div>
                  <Bullets items={c.competitive_weaknesses} />
                </div>
              )}
            </>
          ) : (
            <NotAvailable />
          )}
        </Section>

        {/* === Tier D. Investment Thesis === */}
        <Section title="D. 투자 논거">
          <div className="grid grid-cols-2 gap-x-4 mb-3">
            <div>
              <MetricRow label="RS Rating" value={String(d.rs_rating ?? "—")} highlight />
              <MetricRow label="종합 스코어" value={fmtNum(d.score, 1)} />
              <MetricRow label="주가 단계" value={`${d.stage ?? "—"} (${d.stage_name ?? "—"})`} />
              <MetricRow label="Lynch 분류" value={d.lynch_category || "—"} highlight={d.lynch_category === "Fast Grower"} />
            </div>
            <div>
              <MetricRow label="PEG (성장률 대비 P/E)" value={fmtNum(d.peg_ratio, 2)} highlight={(d.peg_ratio ?? 999) < 1.5 && (d.peg_ratio ?? 0) > 0} />
              <MetricRow label="선행 P/E" value={fmtNum(d.forward_pe, 1)} />
              <MetricRow label="EV/EBITDA" value={fmtNum(d.ev_to_ebitda, 1)} />
              <MetricRow
                label="1년 NASDAQ 대비 초과수익"
                value={fmtPctSigned(d.outperform_1y_vs_nasdaq)}
                highlight={(d.outperform_1y_vs_nasdaq ?? 0) > 0}
              />
            </div>
          </div>

          {d.moat_type && d.moat_type !== "None" && (
            <div className="mb-3 p-2.5 rounded bg-emerald-500/10 border border-emerald-500/30">
              <div className="text-[10px] font-semibold text-emerald-400 uppercase mb-1">
                해자(Moat): {d.moat_type}
                {d.moat_durability_years && (
                  <span className="text-muted ml-2">({d.moat_durability_years})</span>
                )}
              </div>
              <Bullets items={d.moat_evidence} />
            </div>
          )}

          {d.new_trigger && (
            <div className="mb-3">
              <div className="text-[10px] font-semibold text-blue-400 uppercase mb-1">
                "N" 트리거 (최근 12개월)
              </div>
              <p className="text-sm leading-snug">{d.new_trigger}</p>
            </div>
          )}

          {(d.bull_case || d.base_case || d.bear_case) && (
            <div className="space-y-2 mb-3">
              {d.bull_case && (
                <div>
                  <span className="text-[10px] font-semibold text-emerald-400 uppercase">Bull (낙관)</span>
                  <p className="text-sm leading-snug">{d.bull_case}</p>
                </div>
              )}
              {d.base_case && (
                <div>
                  <span className="text-[10px] font-semibold text-yellow-400 uppercase">Base (기준)</span>
                  <p className="text-sm leading-snug">{d.base_case}</p>
                </div>
              )}
              {d.bear_case && (
                <div>
                  <span className="text-[10px] font-semibold text-red-400 uppercase">Bear (비관)</span>
                  <p className="text-sm leading-snug">{d.bear_case}</p>
                </div>
              )}
            </div>
          )}

          {d.key_metrics_to_watch && (
            <div>
              <div className="text-[10px] font-semibold text-muted uppercase mb-1">
                주시할 핵심 지표
              </div>
              <Bullets items={d.key_metrics_to_watch} />
            </div>
          )}

          {!d.moat_type && !d.bull_case && <NotAvailable />}
        </Section>

        {/* === Tier E. Risks === */}
        <Section title="E. 리스크">
          {e.top_risks && e.top_risks.length > 0 ? (
            <>
              <div className="mb-3">
                <div className="text-[10px] font-semibold text-muted uppercase mb-1">
                  주요 리스크
                </div>
                <ul className="space-y-1.5">
                  {e.top_risks.map((r, i) => {
                    const sevColor =
                      r.severity === "high"
                        ? "text-red-400"
                        : r.severity === "medium"
                        ? "text-yellow-400"
                        : "text-muted";
                    const sevLabel =
                      r.severity === "high"
                        ? "高"
                        : r.severity === "medium"
                        ? "中"
                        : "低";
                    return (
                      <li key={i} className="text-sm">
                        <span className={`text-[10px] font-semibold uppercase mr-2 ${sevColor}`}>
                          {sevLabel}
                        </span>
                        <span className="text-accent text-xs">{r.category}</span>
                        <div className="text-xs text-text/80 mt-0.5 ml-1">{r.description}</div>
                      </li>
                    );
                  })}
                </ul>
              </div>
              {e.inversion_scenarios && (
                <div className="mb-3">
                  <div className="text-[10px] font-semibold text-muted uppercase mb-1">
                    역발상 (실패 시나리오)
                  </div>
                  <Bullets items={e.inversion_scenarios} />
                </div>
              )}
              {e.exit_signals && (
                <div>
                  <div className="text-[10px] font-semibold text-muted uppercase mb-1">
                    Exit 시그널
                  </div>
                  <Bullets items={e.exit_signals} />
                </div>
              )}
            </>
          ) : (
            <NotAvailable />
          )}
        </Section>

        {/* === Metadata === */}
        <Section title="기업 메타데이터" badge="AUTO">
          <MetricRow label="시가총액" value={fmtBigUSD(data.yf_metadata.market_cap ?? null)} />
          <MetricRow
            label="발행 주식수"
            value={
              data.yf_metadata.shares_outstanding
                ? `${(data.yf_metadata.shares_outstanding / 1e6).toFixed(1)}M`
                : "—"
            }
          />
          <MetricRow
            label="임직원 수"
            value={data.yf_metadata.employees ? data.yf_metadata.employees.toLocaleString() : "—"}
          />
          <MetricRow label="본사 소재" value={data.yf_metadata.country || "—"} />
          <MetricRow label="베타" value={fmtNum(data.yf_metadata.beta, 2)} />
          {data.yf_metadata.website && (
            <div className="mt-2">
              <a
                href={data.yf_metadata.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-accent hover:underline"
              >
                {data.yf_metadata.website} ↗
              </a>
            </div>
          )}
          {data.wikipedia_summary && (
            <div className="mt-3 pt-3 border-t border-border/40">
              <div className="text-[10px] font-semibold text-muted uppercase mb-1">Wikipedia</div>
              <p className="text-xs text-text/70 leading-relaxed">{data.wikipedia_summary}</p>
            </div>
          )}
        </Section>
      </div>

      {/* === F. Analyst Reports (sell-side digest) === */}
      {data.analyst_reports && data.analyst_reports.length > 0 && (
        <section className="mt-6 card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
              F. 애널리스트 리포트 ({data.analyst_reports.length})
            </h3>
            <span className="text-[10px] text-muted">Bloomberg sell-side 리포트 추출</span>
          </div>
          <div className="space-y-3">
            {data.analyst_reports.map((r, i) => (
              <AnalystReportCard key={r.source_filename || i} r={r} />
            ))}
          </div>
        </section>
      )}

      <footer className="mt-10 pt-6 border-t border-border text-xs text-muted">
        출처: SEC EDGAR (10-K), Yahoo Finance, Wikipedia, Gemini 2.5 Flash (무료 티어), sell-side 리포트.
        자동 생성 · 투자 자문 아님.
      </footer>
    </main>
  );
}

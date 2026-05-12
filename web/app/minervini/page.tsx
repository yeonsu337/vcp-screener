import fs from "fs";
import path from "path";
import Link from "next/link";
import type { MinerviniCall, MinerviniVerdict } from "../types";

export const dynamic = "force-static";

export const metadata = {
  title: "Minervini Bot — VCP Screener",
  description:
    "Mark Minervini SEPA/VCP framework — per-ticker 5-tier verdicts " +
    "(BUY_NOW / BUY_AT_PIVOT / WATCH / EXTENDED / AVOID) with " +
    "deterministic entry · stop · target prices.",
};

type CallWithMarket = MinerviniCall & { _market?: string };

const VERDICT_ORDER: MinerviniVerdict[] = [
  "BUY_NOW",
  "BUY_AT_PIVOT",
  "WATCH",
  "EXTENDED",
  "STOP_OUT",
  "AVOID",
];

const VERDICT_META: Record<
  MinerviniVerdict,
  { label: string; cardCls: string; chipCls: string; icon: string }
> = {
  BUY_NOW: {
    label: "매수 — Pivot 돌파 직후",
    cardCls: "border-emerald-500/40 bg-emerald-500/5",
    chipCls: "bg-emerald-500/20 text-emerald-300",
    icon: "▲",
  },
  BUY_AT_PIVOT: {
    label: "매수 대기 — Pivot 돌파 시",
    cardCls: "border-sky-500/40 bg-sky-500/5",
    chipCls: "bg-sky-500/20 text-sky-300",
    icon: "◉",
  },
  WATCH: {
    label: "관망 — Setup 재형성 대기",
    cardCls: "border-amber-500/40 bg-amber-500/5",
    chipCls: "bg-amber-500/20 text-amber-300",
    icon: "◐",
  },
  EXTENDED: {
    label: "추격 위험 — Buy zone 초과",
    cardCls: "border-orange-500/40 bg-orange-500/5",
    chipCls: "bg-orange-500/20 text-orange-300",
    icon: "◇",
  },
  STOP_OUT: {
    label: "청산 — Stop hit",
    cardCls: "border-red-600/50 bg-red-600/5",
    chipCls: "bg-red-600/25 text-red-300",
    icon: "■",
  },
  AVOID: {
    label: "회피",
    cardCls: "border-rose-500/40 bg-rose-500/5",
    chipCls: "bg-rose-500/20 text-rose-300",
    icon: "✕",
  },
};

function loadAllCalls(): CallWithMarket[] {
  const dir = path.join(
    process.cwd(),
    "public",
    "data",
    "minervini-bot",
  );
  if (!fs.existsSync(dir)) return [];

  let resultsByTicker: Record<string, { market?: string }> = {};
  try {
    const rp = path.join(process.cwd(), "public", "data", "results.json");
    if (fs.existsSync(rp)) {
      const rows = JSON.parse(fs.readFileSync(rp, "utf-8"));
      for (const r of rows) resultsByTicker[r.ticker] = { market: r.market };
    }
  } catch {
    /* ignore */
  }

  const out: CallWithMarket[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const data: MinerviniCall = JSON.parse(
        fs.readFileSync(path.join(dir, f), "utf-8"),
      );
      out.push({ ...data, _market: resultsByTicker[data.ticker]?.market });
    } catch {
      /* skip */
    }
  }
  return out;
}

function currencySymbol(market?: string): string {
  if (market === "KR") return "₩";
  if (market === "HK") return "HK$";
  return "$";
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso.slice(0, 10);
  }
}

export default function MinerviniPage() {
  const calls = loadAllCalls();

  const grouped: Record<MinerviniVerdict, CallWithMarket[]> = {
    BUY_NOW: [],
    BUY_AT_PIVOT: [],
    WATCH: [],
    EXTENDED: [],
    STOP_OUT: [],
    AVOID: [],
  };
  for (const c of calls) grouped[c.verdict]?.push(c);

  // Sort each verdict bucket by confidence desc, then RS desc
  for (const v of VERDICT_ORDER) {
    grouped[v].sort(
      (a, b) =>
        (b.confidence ?? 0) - (a.confidence ?? 0) ||
        (b.framework.rs_rating ?? 0) - (a.framework.rs_rating ?? 0),
    );
  }

  const total = calls.length;
  const counts = Object.fromEntries(
    VERDICT_ORDER.map((v) => [v, grouped[v].length]),
  ) as Record<MinerviniVerdict, number>;

  // Market regime from any call (all share the same regime per run)
  const regime = calls[0]?.framework.market_regime ?? "neutral";
  const generated = calls[0]?.generated_at ?? "";

  return (
    <main className="max-w-6xl mx-auto px-4 py-6 md:py-10">
      <nav className="mb-4 flex items-center gap-3 text-sm">
        <Link
          href="/"
          className="text-muted hover:text-accent transition"
        >
          ← 홈
        </Link>
      </nav>

      <header className="mb-6">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
            Minervini Bot
          </h1>
          <span className="text-xs text-muted font-mono">
            SEPA · VCP · Trend Template
          </span>
        </div>
        <p className="text-muted text-sm mt-2 leading-relaxed">
          전 후보 종목에 대한 Minervini 스타일 매매 권고. Trend Template 8/8 +
          VCP Setup Quality 8 차원 + Pivot 위치 기반 5단계 분류. 룰 기반 결정
          엔진 (LLM 미사용, 100% 재현 가능). 상세 스펙:{" "}
          <code className="text-accent font-mono text-[11px]">
            docs/minervini-bot-persona.md
          </code>
        </p>
      </header>

      {/* Regime + summary */}
      <section className="mb-6 grid grid-cols-2 md:grid-cols-7 gap-2">
        <div className="card p-3">
          <div className="text-[10px] text-muted uppercase">Regime</div>
          <div
            className={`text-sm font-semibold ${
              regime === "bull"
                ? "text-emerald-400"
                : regime === "bear"
                  ? "text-red-400"
                  : "text-muted"
            }`}
          >
            {regime}
          </div>
        </div>
        <div className="card p-3">
          <div className="text-[10px] text-muted uppercase">Total</div>
          <div className="text-sm font-semibold num">{total}</div>
        </div>
        {VERDICT_ORDER.map((v) => (
          <div key={v} className="card p-3">
            <div className="text-[10px] text-muted uppercase font-mono">
              {v.replace("_", " ")}
            </div>
            <div
              className={`text-sm font-semibold num ${
                VERDICT_META[v].chipCls.includes("text-")
                  ? VERDICT_META[v].chipCls.split(" ").find((c) => c.startsWith("text-")) || ""
                  : ""
              }`}
            >
              {counts[v]}
            </div>
          </div>
        ))}
      </section>

      {total === 0 ? (
        <div className="card p-10 text-center text-muted">
          아직 권고 데이터 없음. daily cron에서 생성됨.
        </div>
      ) : (
        VERDICT_ORDER.map((v) =>
          grouped[v].length === 0 ? null : (
            <VerdictSection
              key={v}
              verdict={v}
              calls={grouped[v]}
              defaultOpen={
                v === "BUY_NOW" || v === "BUY_AT_PIVOT" || v === "STOP_OUT"
              }
            />
          ),
        )
      )}

      <footer className="mt-10 pt-6 border-t border-border text-xs text-muted leading-relaxed space-y-1">
        <p>
          <span className="font-semibold">필터 게이트</span>: Primary 12+ rules
          OR detected. <span className="font-semibold">분류 우선순위</span>:
          (1) TT≤6 / Stage≠2 / RS&lt;70 → AVOID, (2) pct_to_pivot &gt;+5% →
          EXTENDED, (3) VCP&lt;4 또는 pct&lt;-5% → WATCH, (4) 0~+3% → BUY_NOW,
          (5) -5~0% → BUY_AT_PIVOT.
        </p>
        <p>
          <span className="font-semibold">위험관리</span>: 진입가 -7% 손절 ·
          +20% 절반 익절 · 50일선 trailing · 계좌의 1~2% 리스크. 약세장 시
          매수 권고 전체 보류 헤더 추가.
        </p>
        <p>
          Generated: <span className="font-mono">{fmtDate(generated)}</span> ·
          Not investment advice.
        </p>
      </footer>
    </main>
  );
}

// ----------------------------------------------------------------------------

function VerdictSection({
  verdict,
  calls,
  defaultOpen,
}: {
  verdict: MinerviniVerdict;
  calls: CallWithMarket[];
  defaultOpen: boolean;
}) {
  const meta = VERDICT_META[verdict];
  return (
    <details
      open={defaultOpen}
      className="mb-4 rounded-lg border border-border overflow-hidden"
    >
      <summary
        className={`cursor-pointer select-none px-4 py-2.5 flex items-center gap-2 ${meta.cardCls}`}
      >
        <span className="font-semibold text-sm">
          {meta.icon} {meta.label}
        </span>
        <span className="ml-auto text-[11px] text-muted font-mono">
          {calls.length}건
        </span>
      </summary>
      <div className="divide-y divide-border">
        {calls.map((c) => (
          <CallRow key={c.ticker} call={c} verdict={verdict} />
        ))}
      </div>
    </details>
  );
}

function CallRow({
  call,
  verdict,
}: {
  call: CallWithMarket;
  verdict: MinerviniVerdict;
}) {
  const meta = VERDICT_META[verdict];
  const sym = currencySymbol(call._market);

  return (
    <article className="p-4 hover:bg-border/20 transition-colors">
      <div className="flex items-baseline gap-3 flex-wrap mb-2">
        <Link
          href={`/screener/${encodeURIComponent(call.ticker)}`}
          className="text-lg font-bold hover:text-accent transition"
        >
          {call.ticker}
        </Link>
        <span
          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase ${meta.chipCls}`}
        >
          {call._market ?? "US"}
        </span>
        <span className="text-[10px] text-muted font-mono">
          TT {call.framework.trend_template_score} · VCP{" "}
          {call.framework.vcp_quality_score} · RS{" "}
          {call.framework.rs_rating} · BC {call.framework.base_count}
          {call.framework.late_base_warning ? " ⚠" : ""}
        </span>
        <span className="ml-auto text-[10px] text-muted font-mono">
          conf {(call.confidence * 100).toFixed(0)}%
        </span>
      </div>

      <ul className="space-y-0.5 text-[13px] leading-relaxed text-foreground/90">
        {call.lines.map((line, i) => (
          <li key={i} className="break-keep">
            {line}
          </li>
        ))}
      </ul>

      {call.action.entry_price !== null && (
        <div className="mt-2.5 pt-2 border-t border-border/50 text-[11px] flex gap-3 flex-wrap font-mono text-muted">
          <span>
            Entry {sym}
            {call.action.entry_price?.toFixed(2)}
          </span>
          {call.action.stop_price !== null && (
            <span>
              Stop {sym}
              {call.action.stop_price.toFixed(2)} (
              {call.action.stop_pct?.toFixed(1)}%)
            </span>
          )}
          {call.action.target1_price !== null && (
            <span>
              Target1 {sym}
              {call.action.target1_price.toFixed(2)} (+
              {call.action.target1_pct?.toFixed(0)}%)
            </span>
          )}
        </div>
      )}

      {call.warnings.length > 0 && (
        <details className="mt-1.5 text-[10px] opacity-70">
          <summary className="cursor-pointer">
            ⚠ {call.warnings.length}건
          </summary>
          <ul className="mt-1 ml-3 list-disc">
            {call.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}

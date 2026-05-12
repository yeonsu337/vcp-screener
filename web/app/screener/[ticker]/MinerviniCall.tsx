import type { MinerviniCall as TCall } from "../../types";

const VERDICT_STYLES: Record<string, string> = {
  BUY_NOW: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
  BUY_AT_PIVOT: "border-sky-500/40 bg-sky-500/10 text-sky-200",
  WATCH: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  EXTENDED: "border-orange-500/40 bg-orange-500/10 text-orange-200",
  AVOID: "border-rose-500/40 bg-rose-500/10 text-rose-200",
  STOP_OUT: "border-red-600/50 bg-red-600/15 text-red-200",
};

const VERDICT_ICON: Record<string, string> = {
  BUY_NOW: "▲",
  BUY_AT_PIVOT: "◉",
  WATCH: "◐",
  EXTENDED: "◇",
  AVOID: "✕",
  STOP_OUT: "■",
};

function currencySymbol(market: string | undefined): string {
  if (market === "KR") return "₩";
  if (market === "HK") return "HK$";
  return "$";
}

export default function MinerviniCall({
  call,
  market,
}: {
  call: TCall | null;
  market?: string;
}) {
  if (!call) return null;
  const style = VERDICT_STYLES[call.verdict] ?? "border-border bg-card";
  const icon = VERDICT_ICON[call.verdict] ?? "•";
  const sym = currencySymbol(market);
  const generated = (() => {
    try {
      return new Date(call.generated_at).toISOString().slice(0, 10);
    } catch {
      return call.generated_at.slice(0, 10);
    }
  })();

  return (
    <section className={`mb-5 rounded-lg border ${style} p-3.5`}>
      <div className="flex items-baseline gap-2 mb-2 flex-wrap">
        <span className="text-[10px] font-mono uppercase opacity-60">
          Minervini Bot
        </span>
        <span className="text-sm font-semibold">
          {icon} {call.verdict_kr}
        </span>
        <span className="ml-auto text-[10px] opacity-60 font-mono">
          TT {call.framework.trend_template_score} · VCP{" "}
          {call.framework.vcp_quality_score} · RS {call.framework.rs_rating} ·{" "}
          {generated}
        </span>
      </div>

      <ul className="space-y-1 text-[13px] leading-relaxed">
        {call.lines.map((line, i) => (
          <li key={i} className="break-keep">
            {line}
          </li>
        ))}
      </ul>

      {call.action.entry_price !== null && (
        <div className="mt-2.5 pt-2.5 border-t border-current/20 text-[11px] flex gap-3 flex-wrap opacity-80 font-mono">
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

      {(call.warnings.length > 0 || call.framework.late_base_warning) && (
        <details className="mt-2 text-[11px] opacity-70">
          <summary className="cursor-pointer select-none">
            ⚠ 경고 {call.warnings.length}건
          </summary>
          <ul className="mt-1 ml-3 list-disc space-y-0.5">
            {call.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

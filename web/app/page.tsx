import fs from "fs";
import path from "path";
import Link from "next/link";

function lessonsLive(): boolean {
  try {
    const p = path.join(process.cwd(), "public", "data", "lessons.json");
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

const liveBadge = "bg-emerald-500/20 text-emerald-400";
const pendingBadge = "bg-yellow-500/20 text-yellow-400";

const sections = [
  {
    title: "VCP Screener",
    description: "Minervini Trend Template + VCP pattern detection across US, HK, KR markets",
    href: "/screener",
    icon: "\u{1F50D}",
    status: "Live",
    statusColor: liveBadge,
  },
  {
    title: "Search Any Ticker",
    description: "Instantly evaluate any ticker against the full rule set with chart and scorecard",
    href: "/search",
    icon: "\u{1F50E}",
    status: "Live",
    statusColor: liveBadge,
  },
  {
    title: "Minervini Bot",
    description: "Per-ticker 5-tier 매매 권고 (BUY_NOW/BUY_AT_PIVOT/WATCH/EXTENDED/AVOID) · entry·stop·target · 한국어 4-5줄",
    href: "/minervini",
    icon: "\u{1F3AF}",
    status: "Live",
    statusColor: liveBadge,
  },
  {
    title: "Backtest",
    description: "Track screener performance: detection date vs current price, hit rate, avg return",
    href: "/backtest",
    icon: "\u{1F4CA}",
    status: "Live",
    statusColor: liveBadge,
  },
  {
    title: "Tracking",
    description: "Manually track any ticker. Performance vs your entry price, same logic as backtest.",
    href: "/tracking",
    icon: "\u{1F4CC}",
    status: "Live",
    statusColor: liveBadge,
  },
  {
    title: "Macro Dashboard",
    description: "美/韓 시장심리·유동성·매크로 지표 (VIX, F&G, M2, 환율, 금리) 한눈에",
    href: "/macro",
    icon: "\u{1F30D}",
    status: "Live",
    statusColor: liveBadge,
  },
  {
    title: "Portfolio",
    description: "Track your positions, P&L, allocation. Manual or API-linked.",
    href: "/portfolio",
    icon: "\u{1F4BC}",
    status: "Coming Soon",
    statusColor: pendingBadge,
  },
  {
    title: "Company Research",
    description: "Deep dive into fundamentals, earnings, financials for any ticker.",
    href: "/research",
    icon: "\u{1F3E2}",
    status: "Coming Soon",
    statusColor: pendingBadge,
  },
  {
    title: "Lessons Learned",
    description: "Win rate, profit factor, rule lift, sector & time-curve analytics across every detection",
    href: "/lessons",
    icon: "\u{1F9E0}",
    statusKey: "lessons",
  },
];

export default function Home() {
  const lessonsReady = lessonsLive();
  const cards = sections.map((s) => {
    if ((s as { statusKey?: string }).statusKey === "lessons") {
      return {
        ...s,
        status: lessonsReady ? "Live" : "Pending",
        statusColor: lessonsReady ? liveBadge : pendingBadge,
      };
    }
    return s;
  });

  return (
    <main className="max-w-4xl mx-auto px-4 py-10 md:py-16">
      <header className="text-center mb-10 md:mb-14">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
          Worxphere Screener
        </h1>
        <p className="text-muted text-sm mt-2 max-w-md mx-auto">
          Multi-market stock screening, backtesting, and research platform
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {cards.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="card p-6 hover:border-accent/40 transition-colors group block"
          >
            <div className="flex items-start justify-between mb-3">
              <span className="text-3xl">{s.icon}</span>
              <span
                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase ${s.statusColor}`}
              >
                {s.status}
              </span>
            </div>
            <h2 className="text-lg font-semibold group-hover:text-accent transition-colors">
              {s.title}
            </h2>
            <p className="text-sm text-muted mt-1 leading-relaxed">
              {s.description}
            </p>
          </Link>
        ))}
      </div>

      <footer className="mt-14 pt-6 border-t border-border text-xs text-muted text-center">
        Data: Finviz + Yahoo Finance + Wikipedia (HSI) + FDR (KRX) &middot;
        Updated daily &middot; Not investment advice.
      </footer>
    </main>
  );
}

import Link from "next/link";

const sections = [
  {
    title: "VCP Screener",
    description: "Minervini Trend Template + VCP pattern detection across US, HK, KR markets",
    href: "/screener",
    icon: "\u{1F50D}",
    status: "Live",
    statusColor: "bg-emerald-500/20 text-emerald-400",
  },
  {
    title: "Backtest",
    description: "Track screener performance: detection date vs current price, hit rate, avg return",
    href: "/backtest",
    icon: "\u{1F4CA}",
    status: "Live",
    statusColor: "bg-emerald-500/20 text-emerald-400",
  },
  {
    title: "Portfolio",
    description: "Track your positions, P&L, allocation. Manual or API-linked.",
    href: "/portfolio",
    icon: "\u{1F4BC}",
    status: "Coming Soon",
    statusColor: "bg-yellow-500/20 text-yellow-400",
  },
  {
    title: "Company Research",
    description: "Deep dive into fundamentals, earnings, financials for any ticker.",
    href: "/research",
    icon: "\u{1F3E2}",
    status: "Coming Soon",
    statusColor: "bg-yellow-500/20 text-yellow-400",
  },
];

export default function Home() {
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
        {sections.map((s) => (
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

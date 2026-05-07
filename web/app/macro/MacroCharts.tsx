"use client";

type Pt = { time: string; value: number };

export default function MacroCharts({
  series,
  signal,
}: {
  series: Pt[];
  signal: "bullish" | "neutral" | "bearish";
}) {
  if (!series || series.length < 2) return null;

  const W = 280;
  const H = 50;
  const PAD = 2;

  const values = series.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const stepX = (W - 2 * PAD) / (series.length - 1);
  const points = series.map((p, i) => {
    const x = PAD + i * stepX;
    const y = PAD + (1 - (p.value - min) / range) * (H - 2 * PAD);
    return [x, y] as const;
  });

  const pathD = points
    .map(([x, y], i) => (i === 0 ? `M${x},${y}` : `L${x},${y}`))
    .join(" ");

  const fillD =
    pathD + ` L${PAD + (series.length - 1) * stepX},${H - PAD} L${PAD},${H - PAD} Z`;

  const stroke =
    signal === "bullish"
      ? "#4ade80"
      : signal === "bearish"
        ? "#f87171"
        : "#8b93a7";

  const fill =
    signal === "bullish"
      ? "rgba(74,222,128,0.15)"
      : signal === "bearish"
        ? "rgba(248,113,113,0.15)"
        : "rgba(139,147,167,0.10)";

  const last = points[points.length - 1];

  return (
    <svg
      width="100%"
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="block"
    >
      <path d={fillD} fill={fill} />
      <path d={pathD} stroke={stroke} strokeWidth="1.5" fill="none" />
      <circle cx={last[0]} cy={last[1]} r="2" fill={stroke} />
    </svg>
  );
}

"use client";
import { useEffect, useRef, memo } from "react";

function mapToTradingViewSymbol(ticker: string, market: string): string {
  if (market === "HK") {
    // 0700.HK -> HKEX:0700
    const code = ticker.replace(".HK", "");
    return `HKEX:${code}`;
  }
  if (market === "KR") {
    // 005930.KS -> KRX:005930, 247540.KQ -> KRX:247540
    const code = ticker.replace(/\.(KS|KQ)$/, "");
    return `KRX:${code}`;
  }
  // US: just use ticker (TradingView auto-resolves exchange)
  return ticker;
}

function TradingViewWidget({
  ticker,
  market = "US",
}: {
  ticker: string;
  market?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;

    // Clear previous widget
    el.innerHTML = "";

    const widgetDiv = document.createElement("div");
    widgetDiv.className = "tradingview-widget-container__widget";
    widgetDiv.style.height = "100%";
    widgetDiv.style.width = "100%";
    el.appendChild(widgetDiv);

    const script = document.createElement("script");
    script.src =
      "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: mapToTradingViewSymbol(ticker, market),
      interval: "D",
      timezone: "exchange",
      theme: "dark",
      style: "1",
      locale: "en",
      backgroundColor: "rgba(11, 14, 20, 1)",
      gridColor: "rgba(31, 36, 48, 0.6)",
      hide_top_toolbar: false,
      hide_legend: false,
      allow_symbol_change: true,
      save_image: true,
      calendar: false,
      studies: [
        "STD;SMA@tv-basicstudies|50|close|0|SMA",
        "STD;SMA@tv-basicstudies|150|close|0|SMA",
        "STD;SMA@tv-basicstudies|200|close|0|SMA",
      ],
      support_host: "https://www.tradingview.com",
    });
    el.appendChild(script);

    return () => {
      el.innerHTML = "";
    };
  }, [ticker, market]);

  return (
    <div
      className="tradingview-widget-container"
      ref={containerRef}
      style={{ height: 520, width: "100%" }}
    />
  );
}

export default memo(TradingViewWidget);

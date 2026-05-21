"use client";
import { useEffect, useRef, memo } from "react";

function mapToTradingViewSymbol(ticker: string, market: string): string {
  if (market === "HK") {
    const code = ticker.replace(".HK", "");
    return `HKEX:${code}`;
  }
  if (market === "KR") {
    const code = ticker.replace(/\.(KS|KQ)$/, "");
    return `KRX:${code}`;
  }
  return ticker;
}

function computeHeight(): number {
  if (typeof window === "undefined") return 800;
  return Math.max(600, Math.min(Math.floor(window.innerHeight * 0.85), 1000));
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

    const mount = () => {
      const h = computeHeight();
      el.style.height = `${h}px`;
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
        width: "100%",
        height: h,
        symbol: mapToTradingViewSymbol(ticker, market),
        interval: "D",
        range: "60M",
        timezone: "exchange",
        theme: "dark",
        style: "1",
        locale: "en",
        backgroundColor: "rgba(11, 14, 20, 1)",
        gridColor: "rgba(31, 36, 48, 0.6)",
        hide_top_toolbar: false,
        hide_legend: false,
        withdateranges: true,
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
    };

    mount();

    // Remount on resize to keep chart filling the viewport
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(mount, 300);
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      if (resizeTimer) clearTimeout(resizeTimer);
      el.innerHTML = "";
    };
  }, [ticker, market]);

  return (
    <div
      className="tradingview-widget-container w-full block"
      ref={containerRef}
      style={{ height: 800, minHeight: 600 }}
    />
  );
}

export default memo(TradingViewWidget);

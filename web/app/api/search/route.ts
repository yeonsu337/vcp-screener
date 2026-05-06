import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import type { Candidate, RuleResult } from "../../types";
import { fetchSECFundamentals, type SECMetrics } from "./sec";

// Yahoo Finance free endpoints — no auth crumb required for chart or v1/search.
// quoteSummary now requires a crumb cookie pair, so we rely on v1/search for
// company metadata and skip fundamental-data rules in the on-demand pipeline.
const YF_CHART = "https://query1.finance.yahoo.com/v8/finance/chart";
const YF_SEARCH = "https://query1.finance.yahoo.com/v1/finance/search";

// Daily-scan cached results (Option A). Server-side fs read on Next.js public/.
const RESULTS_PATH = path.join(process.cwd(), "public", "data", "results.json");
let RESULTS_CACHE: { mtime: number; rows: Candidate[] } | null = null;

function loadCachedCandidate(ticker: string): Candidate | null {
  try {
    if (!fs.existsSync(RESULTS_PATH)) return null;
    const stat = fs.statSync(RESULTS_PATH);
    const mtime = stat.mtimeMs;
    if (!RESULTS_CACHE || RESULTS_CACHE.mtime !== mtime) {
      const raw = fs.readFileSync(RESULTS_PATH, "utf-8");
      const rows = JSON.parse(raw) as Candidate[];
      RESULTS_CACHE = { mtime, rows: Array.isArray(rows) ? rows : [] };
    }
    const t = ticker.toUpperCase();
    return RESULTS_CACHE.rows.find((r) => r.ticker?.toUpperCase() === t) ?? null;
  } catch {
    return null;
  }
}
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const CACHE = new Map<string, { t: number; data: Candidate }>();
const TTL_MS = 5 * 60 * 1000;

type Bar = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type YFInfo = {
  longName?: string;
  shortName?: string;
  sector?: string;
  industry?: string;
  exchange?: string;
  // Fundamentals — currently unavailable on free anonymous Yahoo (crumb required).
  // Kept on the type so evaluateRules() compiles unchanged; values will be undefined.
  heldPercentInstitutions?: number;
  shortPercentOfFloat?: number;
  earningsQuarterlyGrowth?: number;
  revenueGrowth?: number;
  returnOnEquity?: number;
};

function detectMarket(ticker: string): "US" | "HK" | "KR" {
  if (ticker.endsWith(".HK")) return "HK";
  if (ticker.endsWith(".KS") || ticker.endsWith(".KQ")) return "KR";
  return "US";
}

const LIQUIDITY_THRESHOLDS: Record<string, number> = {
  US: 20_000_000,
  HK: 5_000_000,
  KR: 5_000_000,
};

async function fetchOhlcv(symbol: string, range = "2y"): Promise<Bar[]> {
  const url = `${YF_CHART}/${encodeURIComponent(symbol)}?range=${range}&interval=1d&includePrePost=false`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) return [];
  const timestamps: number[] = result.timestamp ?? [];
  const q = result.indicators?.quote?.[0] ?? {};
  const bars: Bar[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const o = q.open?.[i];
    const h = q.high?.[i];
    const l = q.low?.[i];
    const c = q.close?.[i];
    const v = q.volume?.[i];
    if (o == null || h == null || l == null || c == null) continue;
    const d = new Date(timestamps[i] * 1000);
    const time = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    bars.push({
      time,
      open: +o.toFixed(4),
      high: +h.toFixed(4),
      low: +l.toFixed(4),
      close: +c.toFixed(4),
      volume: Math.round(v ?? 0),
    });
  }
  return bars;
}

async function fetchCompanyInfo(symbol: string): Promise<YFInfo | null> {
  // Free anonymous endpoint — gives name, sector, industry, exchange.
  const url = `${YF_SEARCH}?q=${encodeURIComponent(symbol)}&quotesCount=5&newsCount=0`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = await res.json();
    const quotes: Array<Record<string, unknown>> = json?.quotes ?? [];
    // Prefer exact symbol match (Yahoo sometimes returns related tickers first).
    const target = quotes.find((q) => (q.symbol as string)?.toUpperCase() === symbol.toUpperCase()) ?? quotes[0];
    if (!target) return null;
    return {
      longName: (target.longname as string) ?? (target.shortname as string),
      shortName: target.shortname as string,
      sector: target.sector as string,
      industry: target.industry as string,
      exchange: (target.exchDisp as string) ?? (target.exchange as string),
    };
  } catch {
    return null;
  }
}

// ---- Helpers ----------------------------------------------------------------

function sma(arr: number[], window: number, idx: number): number | null {
  if (idx + 1 < window) return null;
  let s = 0;
  for (let i = idx - window + 1; i <= idx; i++) s += arr[i];
  return s / window;
}

function consecutiveRising(series: (number | null)[], days: number): { allRising: boolean; risingDays: number } {
  if (series.length < days + 1) return { allRising: false, risingDays: 0 };
  const tail = series.slice(-(days + 1));
  let rising = 0;
  for (let i = 1; i < tail.length; i++) {
    const a = tail[i];
    const b = tail[i - 1];
    if (a == null || b == null) return { allRising: false, risingDays: rising };
    if (a > b) rising++;
  }
  return { allRising: rising >= days - 1, risingDays: rising };
}

function determineStage(closes: number[]): number {
  // Simplified Weinstein-style stage:
  // Stage 2 (Advancing): price > SMA200 AND SMA50 > SMA200 AND SMA200 rising
  // Stage 1 (Basing), Stage 3 (Topping), Stage 4 (Declining) — coarse fallback
  if (closes.length < 200) return 0;
  const s50: (number | null)[] = [];
  const s200: (number | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    s50.push(sma(closes, 50, i));
    s200.push(sma(closes, 200, i));
  }
  const p = closes[closes.length - 1];
  const a50 = s50[s50.length - 1];
  const a200 = s200[s200.length - 1];
  if (a50 == null || a200 == null) return 0;
  // SMA200 rising check (last 21 bars)
  const rising21 = consecutiveRising(s200.slice(-22), 21).allRising;
  if (p > a200 && a50 > a200 && rising21) return 2;
  if (p < a200 && a50 < a200) return 4;
  if (p > a200 && a50 < a200) return 1;
  return 3;
}

const STAGE_NAMES: Record<number, string> = {
  0: "Unknown",
  1: "Basing",
  2: "Advancing",
  3: "Topping",
  4: "Declining",
};

// Approximate IBD RS rating (0-100) using 12/3/3 weighted return vs benchmark
function computeRsRating(stockBars: Bar[], benchBars: Bar[]): number {
  if (stockBars.length < 252 || benchBars.length < 252) return 50;
  const sLast = stockBars[stockBars.length - 1].close;
  const bLast = benchBars[benchBars.length - 1].close;
  const sBack = (n: number) => stockBars[stockBars.length - 1 - n]?.close ?? null;
  const bBack = (n: number) => benchBars[benchBars.length - 1 - n]?.close ?? null;
  const periods = [
    { d: 63, w: 0.4 }, // ~3M
    { d: 126, w: 0.2 }, // ~6M
    { d: 189, w: 0.2 }, // ~9M
    { d: 252, w: 0.2 }, // ~12M
  ];
  let perfDelta = 0;
  for (const { d, w } of periods) {
    const s0 = sBack(d);
    const b0 = bBack(d);
    if (s0 == null || b0 == null || s0 === 0 || b0 === 0) continue;
    const sr = sLast / s0 - 1;
    const br = bLast / b0 - 1;
    perfDelta += (sr - br) * w;
  }
  // Map perfDelta into 0-100 (rough heuristic; matched to the screener's typical RS distribution)
  // perfDelta of +0.30 (30 ppt outperform) ≈ ~85 RS; -0.30 ≈ ~15
  const rs = 50 + perfDelta * 100;
  return Math.max(1, Math.min(99, Math.round(rs)));
}

function rule(name: string, passed: boolean, value: number | null, threshold: number | null, note?: string): RuleResult {
  return { name, passed, value, threshold, note };
}

// ---- Rule evaluation --------------------------------------------------------

function evaluateRules(
  bars: Bar[],
  benchBars: Bar[],
  market: string,
  info: YFInfo | null,
  rsRating: number,
  stage: number,
  nasdaqBars: Bar[] = [],
  sec: SECMetrics | null = null,
): { rules: Record<string, RuleResult>; vcpStats: { lastContractionPct: number | null; volumeDryupRatio: number | null; numContractions: number } } {
  const rules: Record<string, RuleResult> = {};
  const closes = bars.map((b) => b.close);
  const volumes = bars.map((b) => b.volume);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const n = closes.length;

  // ---- A1: U/D Volume Ratio (50d) ----
  if (n >= 50) {
    let upVol = 0;
    let dnVol = 0;
    for (let i = n - 49; i < n; i++) {
      if (closes[i] > closes[i - 1]) upVol += volumes[i];
      else if (closes[i] < closes[i - 1]) dnVol += volumes[i];
    }
    if (dnVol > 0) {
      const r = upVol / dnVol;
      rules.A1_ud_vol_ratio = rule("U/D Volume Ratio ≥ 1.0 (50d)", r >= 1.0, +r.toFixed(3), 1.0);
    } else if (upVol > 0) {
      rules.A1_ud_vol_ratio = rule("U/D Volume Ratio ≥ 1.0 (50d)", true, null, 1.0, "no down-day volume in window");
    }
  }

  // ---- B series (Trend Template) ----
  if (n >= 200) {
    const p = closes[n - 1];
    const s50 = sma(closes, 50, n - 1);
    const s150 = sma(closes, 150, n - 1);
    const s200 = sma(closes, 200, n - 1);
    if (s50 != null && s150 != null && s200 != null) {
      // B1
      rules.B1_price_above_150_200 = rule(
        "Price > SMA150 & SMA200",
        p > s150 && p > s200,
        +Math.min(p / s150, p / s200).toFixed(4),
        1.0,
      );
      // B2
      rules.B2_sma150_gt_sma200 = rule(
        "SMA150 > SMA200",
        s150 > s200,
        +(s150 / s200).toFixed(4),
        1.0,
      );
      // B3
      rules.B3_sma50_gt_150_200 = rule(
        "SMA50 > SMA150 & SMA200",
        s50 > s150 && s50 > s200,
        +Math.min(s50 / s150, s50 / s200).toFixed(4),
        1.0,
      );
      // B4
      rules.B4_price_above_sma50 = rule("Price > SMA50", p > s50, +(p / s50).toFixed(4), 1.0);
      // B5: 200d SMA rising 100 days
      const s200Series: (number | null)[] = [];
      for (let i = 0; i < n; i++) s200Series.push(sma(closes, 200, i));
      const cleanS200 = s200Series.filter((x): x is number => x != null);
      const B5_WINDOW = 100;
      let b5Pass = false;
      let b5Days = 0;
      if (cleanS200.length >= B5_WINDOW + 1) {
        const tail = cleanS200.slice(-(B5_WINDOW + 1));
        let rising = 0;
        for (let i = 1; i < tail.length; i++) {
          if (tail[i] > tail[i - 1]) rising++;
        }
        b5Days = rising;
        b5Pass = rising >= B5_WINDOW - 1; // allow tiny noise
      }
      rules.B5_sma200_rising_5mo = rule("200d SMA rising 4-5 months", b5Pass, b5Days, B5_WINDOW - 1);
    }
  }

  // ---- 52W high/low (B6 / B7 / B8) ----
  if (n >= 252) {
    const p = closes[n - 1];
    const window = closes.slice(n - 252);
    const high52 = Math.max(...window);
    const low52 = Math.min(...window);
    const pctBelowHigh = (p / high52 - 1) * 100;
    const pctAboveLow = low52 > 0 ? (p / low52 - 1) * 100 : 0;

    rules.B6_30pct_above_52w_low = rule("≥ 30% above 52W low", pctAboveLow >= 30, +pctAboveLow.toFixed(2), 30);
    rules.B7_within_25pct_high = rule("Within 25% of 52W high", pctBelowHigh >= -25, +pctBelowHigh.toFixed(2), -25);
    rules.B8_within_10pct_high = rule("Within 10% of 52W high (bonus)", pctBelowHigh >= -10, +pctBelowHigh.toFixed(2), -10);
  }

  // ---- B9: Stage 2 ----
  if (stage > 0) {
    rules.B9_stage2 = rule("Weinstein Stage 2 (Advancing)", stage === 2, stage, 2);
  }

  // ---- B10: HH/HL (last 130 bars) ----
  if (n >= 130) {
    const seg = closes.slice(-130);
    const hhHl = countHhHl(seg);
    rules.B10_higher_highs_lows = rule(
      "Higher Highs / Higher Lows (3+ pairs)",
      hhHl >= 3,
      hhHl,
      3,
    );
  }

  // ---- R1/R2/R3 ----
  rules.R1_rs_70 = rule("RS Rating ≥ 70 (Minervini gate)", rsRating >= 70, rsRating, 70);
  rules.R2_rs_80 = rule("RS Rating ≥ 80 (CANSLIM Leader)", rsRating >= 80, rsRating, 80);
  rules.R3_rs_90 = rule("RS Rating ≥ 90 (Strong leader)", rsRating >= 90, rsRating, 90);

  // ---- V1: ATR contraction ----
  if (n >= 250) {
    const tr: number[] = [];
    for (let i = 1; i < n; i++) {
      const t = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
      tr.push(t);
    }
    // ATR14 series
    const atr: number[] = [];
    for (let i = 0; i < tr.length; i++) {
      if (i + 1 < 14) {
        atr.push(NaN);
        continue;
      }
      let s = 0;
      for (let j = i - 13; j <= i; j++) s += tr[j];
      atr.push(s / 14);
    }
    const atrClean = atr.filter((x) => !Number.isNaN(x));
    if (atrClean.length >= 250) {
      const a50 = atrClean.slice(-50).reduce((a, b) => a + b, 0) / 50;
      const a250 = atrClean.slice(-250).reduce((a, b) => a + b, 0) / 250;
      if (a250 > 0) {
        const v = a50 / a250;
        rules.V1_atr_contraction = rule("ATR Contraction (50d/250d < 0.85)", v < 0.85, +v.toFixed(3), 0.85);
      }
    }
  }

  // ---- V2: 30d / 60d return stdev ----
  if (n >= 60) {
    const rets: number[] = [];
    for (let i = 1; i < n; i++) rets.push(closes[i] / closes[i - 1] - 1);
    const std = (arr: number[]): number => {
      const m = arr.reduce((a, b) => a + b, 0) / arr.length;
      const v = arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length;
      return Math.sqrt(v);
    };
    const s30 = std(rets.slice(-30));
    const s60 = std(rets.slice(-60));
    if (s60 > 0) {
      const v = s30 / s60;
      rules.V2_short_term_tightening = rule(
        "Near-term volatility tightening (30d/60d < 1.0)",
        v < 1.0,
        +v.toFixed(3),
        1.0,
      );
    }
  }

  // ---- L1/L2/L3/L4: Liquidity ----
  if (n >= 50) {
    const last50Price = closes.slice(-50).reduce((a, b) => a + b, 0) / 50;
    const last50Vol = volumes.slice(-50).reduce((a, b) => a + b, 0) / 50;
    const dollarVol = last50Price * last50Vol;
    const threshold = LIQUIDITY_THRESHOLDS[market] ?? 20_000_000;
    rules.L1_liquidity_gate = rule(
      "Daily $ volume ≥ market threshold",
      dollarVol >= threshold,
      Math.round(dollarVol),
      threshold,
    );
    const l2 = threshold * 2.5;
    rules.L2_liquidity_50m = rule(
      "Daily $ volume ≥ 2.5× threshold (institutional)",
      dollarVol >= l2,
      Math.round(dollarVol),
      l2,
    );
    if (market === "US") {
      rules.L3_share_volume = rule("Avg shares ≥ 400K (50d)", last50Vol >= 400_000, Math.round(last50Vol), 400_000);
      rules.L4_price_floor = rule("Price ≥ $12 (Minervini floor)", closes[n - 1] >= 12, +closes[n - 1].toFixed(2), 12);
    }
  }

  // ---- VCP-lite: contractions + dry-up (simple peak/trough scan) ----
  let lastContractionPct: number | null = null;
  let volDryupRatio: number | null = null;
  let contractions: number[] = [];
  if (n >= 130) {
    contractions = detectContractions(closes.slice(-130));
    if (contractions.length > 0) {
      lastContractionPct = contractions[contractions.length - 1];
    }
    // Volume dry-up: last 10 bars vol / SMA50
    if (n >= 50) {
      const last10 = volumes.slice(-10).reduce((a, b) => a + b, 0) / 10;
      const last50 = volumes.slice(-50).reduce((a, b) => a + b, 0) / 50;
      if (last50 > 0) volDryupRatio = last10 / last50;
    }
    // P1/P2/P3/P6
    if (contractions.length >= 3) {
      const tightening = contractions.every((c, i) => i === 0 || c <= contractions[i - 1] * 1.1);
      rules.P1_tightening = rule("Progressive tightening (n≥3)", tightening, contractions.length, 3);
      const mono = contractions.every((c, i) => i === 0 || c <= contractions[i - 1] * 0.75);
      const ratios: number[] = [];
      for (let i = 1; i < contractions.length; i++) {
        if (contractions[i - 1] > 0) ratios.push(contractions[i] / contractions[i - 1]);
      }
      const avgRatio = ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 1;
      rules.P6_monotonic_decreasing = rule("Contractions monotonic ≤0.75× prior", mono, +avgRatio.toFixed(3), 0.75);
    }
    if (lastContractionPct != null) {
      rules.P2_last_contraction = rule(
        "Last contraction < 6.5%",
        lastContractionPct < 6.5,
        +lastContractionPct.toFixed(2),
        6.5,
      );
    }
    if (volDryupRatio != null) {
      rules.P3_vol_dryup = rule(
        "Volume dry-up < 0.6× SMA50",
        volDryupRatio < 0.6,
        +volDryupRatio.toFixed(3),
        0.6,
      );
    }
    // P4: base count proxy (6m return)
    if (n >= 130) {
      const p6 = closes[n - 130];
      const pNow = closes[n - 1];
      if (p6 > 0) {
        const ret6 = (pNow / p6 - 1) * 100;
        let bc = 4;
        if (ret6 <= 25) bc = 1;
        else if (ret6 <= 50) bc = 2;
        else if (ret6 <= 100) bc = 3;
        rules.P4_base_count = rule("Base count ≤ 2 (early base)", bc <= 2, bc, 2, "proxy from 6m return");
      }
    }
  }

  // ---- F1/F2/F3: NASDAQ outperform (all markets) — Option B ----
  // Uses ^IXIC bars (passed as nasdaqBars). Falls back to benchBars for US if
  // nasdaqBars unavailable, since US benchmark is already ^IXIC.
  {
    const nb = nasdaqBars.length > 0 ? nasdaqBars : (market === "US" ? benchBars : []);
    if (n >= 252 && nb.length >= 252) {
      const sNow = closes[n - 1];
      const bNow = nb[nb.length - 1].close;
      const periods: Array<{ id: keyof typeof rules; label: string; days: number }> = [
        { id: "F1_outperform_1y", label: "1Y return > NASDAQ", days: 252 },
        { id: "F2_outperform_6m", label: "6M return > NASDAQ", days: 126 },
        { id: "F3_outperform_1m", label: "1M return > NASDAQ", days: 21 },
      ];
      for (const p of periods) {
        if (n - 1 - p.days < 0 || nb.length - 1 - p.days < 0) continue;
        const sPrev = closes[n - 1 - p.days];
        const bPrev = nb[nb.length - 1 - p.days].close;
        if (sPrev <= 0 || bPrev <= 0) continue;
        const sRet = (sNow / sPrev - 1) * 100;
        const bRet = (bNow / bPrev - 1) * 100;
        const delta = +(sRet - bRet).toFixed(2);
        rules[p.id as string] = rule(p.label, delta > 0, delta, 0);
      }
    }
  }

  // ---- Fundamentals (US only) ----
  // Yahoo info path is largely unavailable on free anonymous endpoint; SEC EDGAR
  // (Option C) provides ground-truth XBRL for the same rules.
  if (market === "US" && info) {
    // Yahoo-derived (kept as fallback when fields are populated by some path).
    if (info.heldPercentInstitutions != null) {
      rules.E10_inst_ownership = rule(
        "Institutional own. ≥ 5%",
        info.heldPercentInstitutions >= 0.05,
        +(info.heldPercentInstitutions * 100).toFixed(2),
        5,
      );
    }
    if (info.shortPercentOfFloat != null) {
      rules.H1_short_float = rule(
        "Short Float ≤ 5%",
        info.shortPercentOfFloat <= 0.05,
        +(info.shortPercentOfFloat * 100).toFixed(2),
        5,
      );
    }
  }

  // ---- SEC EDGAR-derived rules (US only, Option C) ----
  if (market === "US" && sec) {
    if (sec.e1_eps_qoq_yoy_pct != null) {
      rules.E1_eps_growth = rule(
        "EPS QoQ YoY > 18%",
        sec.e1_eps_qoq_yoy_pct > 18,
        sec.e1_eps_qoq_yoy_pct,
        18,
        "SEC XBRL",
      );
    }
    if (sec.e2_eps_yoy_4q_accel != null) {
      rules.E2_eps_yoy_accel = rule(
        "EPS YoY 4Q monotonic acceleration",
        sec.e2_eps_yoy_4q_accel,
        sec.e2_eps_yoy_4q_delta ?? null,
        0,
        "SEC XBRL",
      );
    }
    if (sec.e3_rev_yoy_pct != null) {
      rules.E3_rev_growth = rule(
        "Sales YoY > 25%",
        sec.e3_rev_yoy_pct > 25,
        sec.e3_rev_yoy_pct,
        25,
        "SEC XBRL",
      );
    }
    if (sec.e4_rev_yoy_4q_accel != null) {
      rules.E4_rev_yoy_accel = rule(
        "Sales YoY 4Q monotonic acceleration",
        sec.e4_rev_yoy_4q_accel,
        sec.e4_rev_yoy_4q_delta ?? null,
        0,
        "SEC XBRL",
      );
    }
    if (sec.e5_op_inc_4q_growing != null) {
      rules.E5_op_inc_growing = rule(
        "Operating Income 4Q QoQ growing",
        sec.e5_op_inc_4q_growing,
        null,
        null,
        "SEC XBRL",
      );
    }
    if (sec.e6_op_inc_yoy_4q_accel != null) {
      rules.E6_op_inc_yoy_accel = rule(
        "Op Income YoY 4Q acceleration",
        sec.e6_op_inc_yoy_4q_accel,
        sec.e6_op_inc_yoy_4q_delta ?? null,
        0,
        "SEC XBRL",
      );
    }
    if (sec.e7_roe_ttm_pct != null) {
      rules.E7_roe = rule(
        "ROE ≥ 17% (Minervini)",
        sec.e7_roe_ttm_pct >= 17,
        sec.e7_roe_ttm_pct,
        17,
        "SEC XBRL (TTM)",
      );
    }
    if (sec.e8_annual_eps_yoy_pct != null) {
      rules.E8_annual_eps_growth = rule(
        "Annual EPS YoY ≥ 25%",
        sec.e8_annual_eps_yoy_pct >= 25,
        sec.e8_annual_eps_yoy_pct,
        25,
        "SEC XBRL",
      );
    }
    if (sec.e9_eps_breakout != null) {
      rules.E9_eps_breakout = rule(
        "EPS breakout (>8Q max)",
        sec.e9_eps_breakout,
        null,
        null,
        "SEC XBRL",
      );
    }
    if (sec.h2_cfps_to_eps != null) {
      rules.H2_cfps_to_eps = rule(
        "CFPS / EPS ≥ 1.20 (cash quality)",
        sec.h2_cfps_to_eps >= 1.20,
        sec.h2_cfps_to_eps,
        1.20,
        "SEC XBRL (CFO/NI TTM)",
      );
    }
    if (sec.h3_net_margin_5y_high != null) {
      rules.H3_net_margin_high = rule(
        "TTM Net Margin = 5Y high",
        sec.h3_net_margin_5y_high,
        null,
        null,
        "SEC XBRL",
      );
    }
    if (sec.h4_ni_cagr_3y_pct != null) {
      rules.H4_ni_cagr_3y = rule(
        "3Y Net Income CAGR ≥ 25%",
        sec.h4_ni_cagr_3y_pct >= 25,
        sec.h4_ni_cagr_3y_pct,
        25,
        "SEC XBRL",
      );
    }
  }

  return {
    rules,
    vcpStats: {
      lastContractionPct,
      volumeDryupRatio: volDryupRatio,
      numContractions: contractions.length,
    },
  };
}

// Detect contraction depths (%) from a price series via swing-high/low scan.
function detectContractions(closes: number[]): number[] {
  if (closes.length < 20) return [];
  // Simple peak detection: a peak is a bar higher than ±5 surrounding bars.
  const peaks: { idx: number; val: number; type: "H" | "L" }[] = [];
  const W = 5;
  for (let i = W; i < closes.length - W; i++) {
    let isPeak = true;
    let isTrough = true;
    for (let j = i - W; j <= i + W; j++) {
      if (j === i) continue;
      if (closes[j] >= closes[i]) isPeak = false;
      if (closes[j] <= closes[i]) isTrough = false;
    }
    if (isPeak) peaks.push({ idx: i, val: closes[i], type: "H" });
    else if (isTrough) peaks.push({ idx: i, val: closes[i], type: "L" });
  }
  // Pair high→low, keep only the most recent 4 contractions
  const contractions: number[] = [];
  for (let i = 0; i < peaks.length - 1; i++) {
    if (peaks[i].type === "H" && peaks[i + 1].type === "L") {
      const depth = (peaks[i].val - peaks[i + 1].val) / peaks[i].val * 100;
      if (depth > 0) contractions.push(+depth.toFixed(2));
    }
  }
  return contractions.slice(-4);
}

// Count consecutive higher-high/higher-low pairs at the end of a series.
function countHhHl(seg: number[]): number {
  if (seg.length < 20) return 0;
  const W = 5;
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = W; i < seg.length - W; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - W; j <= i + W; j++) {
      if (j === i) continue;
      if (seg[j] >= seg[i]) isHigh = false;
      if (seg[j] <= seg[i]) isLow = false;
    }
    if (isHigh) highs.push(seg[i]);
    else if (isLow) lows.push(seg[i]);
  }
  if (highs.length < 2 || lows.length < 2) return 0;
  let hh = 0;
  for (let i = highs.length - 1; i > 0; i--) {
    if (highs[i] > highs[i - 1]) hh++;
    else break;
  }
  let hl = 0;
  for (let i = lows.length - 1; i > 0; i--) {
    if (lows[i] > lows[i - 1]) hl++;
    else break;
  }
  return Math.min(hh, hl);
}

// ---- Main handler -----------------------------------------------------------

const BENCH_BY_MARKET: Record<string, string> = {
  US: "^IXIC",
  HK: "^HSI",
  KR: "^KS11",
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const ticker = url.searchParams.get("ticker")?.trim().toUpperCase();
  if (!ticker) {
    return NextResponse.json({ error: "missing ?ticker= param" }, { status: 400 });
  }
  // Lightweight ticker validation: letters, numbers, dot, dash, caret, max 12 chars.
  if (!/^[A-Z0-9.\-^]{1,12}$/.test(ticker)) {
    return NextResponse.json({ error: `invalid ticker format: ${ticker}` }, { status: 400 });
  }
  // Option A: cache lookup. Daily-scan results.json contains 42-rule evaluation
  // produced by screener.py — return immediately if hit.
  const cachedRow = loadCachedCandidate(ticker);
  if (cachedRow) {
    const out: Candidate = { ...cachedRow, source: "cached" };
    return NextResponse.json(out, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  }

  // In-process memo cache (separate from results.json).
  const memo = CACHE.get(ticker);
  if (memo && Date.now() - memo.t < TTL_MS) {
    return NextResponse.json(memo.data, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  }

  const market = detectMarket(ticker);
  try {
    const benchSym = BENCH_BY_MARKET[market];
    // Fetch in parallel: stock bars, market benchmark bars, NASDAQ (for F1~F3),
    // company info, and SEC fundamentals (US only — non-blocking on failure).
    const needsNasdaq = market !== "US"; // US benchmark is already ^IXIC
    const [bars, benchBars, nasdaqBars, info, sec] = await Promise.all([
      fetchOhlcv(ticker, "2y"),
      fetchOhlcv(benchSym, "2y"),
      needsNasdaq ? fetchOhlcv("^IXIC", "2y") : Promise.resolve([] as Bar[]),
      fetchCompanyInfo(ticker),
      market === "US" ? fetchSECFundamentals(ticker).catch(() => null) : Promise.resolve(null),
    ]);

    if (!bars.length) {
      return NextResponse.json({ error: `No data for ${ticker}` }, { status: 404 });
    }

    const closes = bars.map((b) => b.close);
    const stage = determineStage(closes);
    const rsRating = computeRsRating(bars, benchBars);
    const { rules, vcpStats } = evaluateRules(bars, benchBars, market, info, rsRating, stage, nasdaqBars, sec);

    // Compute pivot price (last 130 bars high) & pct to pivot
    let pivot: number | null = null;
    let pctToPivot: number | null = null;
    if (closes.length >= 130) {
      const window = bars.slice(-130);
      pivot = +Math.max(...window.map((b) => b.high)).toFixed(2);
      const p = closes[closes.length - 1];
      pctToPivot = +((p / pivot - 1) * 100).toFixed(2);
    }

    const baseDepth = closes.length >= 130
      ? +(((Math.max(...closes.slice(-130)) - Math.min(...closes.slice(-130))) / Math.max(...closes.slice(-130))) * 100).toFixed(2)
      : null;

    let rsLinePctFromHigh: number | null = null;
    if (bars.length >= 60 && benchBars.length >= 60) {
      const benchMap = new Map(benchBars.map((b) => [b.time, b.close]));
      const rsLine: number[] = [];
      for (const bar of bars) {
        const bc = benchMap.get(bar.time);
        if (bc) rsLine.push(bar.close / bc);
      }
      if (rsLine.length >= 30) {
        const recent = rsLine.slice(-60);
        const high = Math.max(...recent);
        const last = recent[recent.length - 1];
        if (high > 0) rsLinePctFromHigh = +((last / high - 1) * 100).toFixed(2);
      }
    }

    // Count rule pass/total
    const passed = Object.values(rules).filter((r) => r.passed).length;
    const total = Object.values(rules).length;
    const score = total > 0 ? Math.round((passed / total) * 100) : 0;

    // VCP quality heuristic: 0-100, weighted by tightening + dry-up + last contraction
    let vcpQuality = 0;
    if (rules.P1_tightening?.passed) vcpQuality += 25;
    if (rules.P2_last_contraction?.passed) vcpQuality += 25;
    if (rules.P3_vol_dryup?.passed) vcpQuality += 25;
    if (rules.P6_monotonic_decreasing?.passed) vcpQuality += 25;

    const candidate: Candidate = {
      ticker,
      company: info?.longName || info?.shortName || ticker,
      sector: info?.sector || "",
      industry: info?.industry || "",
      market,
      detected: passed >= 9 && (rules.P2_last_contraction?.passed ?? false),
      stage,
      stage_name: STAGE_NAMES[stage] ?? "Unknown",
      score,
      vcp_quality: vcpQuality,
      rs_rating: rsRating,
      num_contractions: vcpStats.numContractions,
      contractions: [],
      last_contraction_pct: vcpStats.lastContractionPct,
      base_depth_pct: baseDepth,
      current_price: +closes[closes.length - 1].toFixed(2),
      pivot_price: pivot,
      pct_to_pivot: pctToPivot,
      volume_dryup_ratio: vcpStats.volumeDryupRatio,
      rs_line_pct_from_high: rsLinePctFromHigh,
      rules,
      rules_passed: passed,
      rules_total: total,
      source: sec ? "computed+sec" : "computed",
    };

    CACHE.set(ticker, { t: Date.now(), data: candidate });
    return NextResponse.json(candidate, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

// SEC EDGAR XBRL fundamentals (US only).
// Free government API. No auth, but UA header required.
//
// Endpoints (all free):
//  - Ticker → CIK   : https://www.sec.gov/files/company_tickers.json
//  - Company facts  : https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json
//
// Rule coverage added by this module:
//   E1  EPS QoQ YoY > 18%
//   E2  EPS YoY 4Q monotonic acceleration
//   E3  Sales YoY > 25%
//   E4  Sales YoY 4Q monotonic acceleration
//   E5  Operating Income 4Q QoQ growing
//   E6  Op Income YoY 4Q acceleration
//   E7  ROE ≥ 17%
//   E8  Annual EPS YoY ≥ 25%
//   E9  EPS breakout (>8Q max)
//   H2  CFPS / EPS ≥ 1.20
//   H3  TTM Net Margin = 5Y high
//   H4  3Y Net Income CAGR ≥ 25%
// (E10 inst. ownership, H1 short float — not on SEC; intentionally skipped)

const TICKER_MAP_URL = "https://www.sec.gov/files/company_tickers.json";
const FACTS_URL = (cik: string) => `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;

// SEC requires a descriptive UA per Fair Access policy:
// https://www.sec.gov/os/accessing-edgar-data
const SEC_UA = "VCP-Screener research-bot ysialm1472@gmail.com";

// In-memory cache (process-lifetime). Hard-cap entries to avoid leaks.
const TTL_MS = 30 * 60 * 1000;
const FACTS_CACHE = new Map<string, { t: number; data: unknown }>();
const CIK_CACHE = new Map<string, string>(); // ticker → padded CIK
let TICKER_MAP_LOADED_AT = 0;

const FETCH_TIMEOUT_MS = 5000;

async function fetchWithTimeout(url: string): Promise<Response | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": SEC_UA, Accept: "application/json" },
      cache: "no-store",
      signal: ctrl.signal,
    });
    return res;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function loadTickerMap(): Promise<void> {
  // Refresh once per hour (cheap; small JSON).
  if (CIK_CACHE.size > 0 && Date.now() - TICKER_MAP_LOADED_AT < 60 * 60 * 1000) return;
  const res = await fetchWithTimeout(TICKER_MAP_URL);
  if (!res || !res.ok) return;
  const json = (await res.json()) as Record<string, { ticker: string; cik_str: number }>;
  CIK_CACHE.clear();
  for (const v of Object.values(json)) {
    if (!v?.ticker || v.cik_str == null) continue;
    CIK_CACHE.set(v.ticker.toUpperCase(), String(v.cik_str).padStart(10, "0"));
  }
  TICKER_MAP_LOADED_AT = Date.now();
}

async function tickerToCik(ticker: string): Promise<string | null> {
  const t = ticker.toUpperCase();
  if (CIK_CACHE.has(t)) return CIK_CACHE.get(t)!;
  await loadTickerMap();
  return CIK_CACHE.get(t) ?? null;
}

type FactUnit = {
  end: string;
  val: number;
  fy?: number;
  fp?: string; // "Q1" | "Q2" | "Q3" | "FY"
  form?: string;
  filed?: string;
  start?: string;
  accn?: string;
};

type CompanyFacts = {
  facts?: {
    "us-gaap"?: Record<string, { units?: Record<string, FactUnit[]> }>;
  };
};

async function fetchCompanyFacts(cik: string): Promise<CompanyFacts | null> {
  const cached = FACTS_CACHE.get(cik);
  if (cached && Date.now() - cached.t < TTL_MS) return cached.data as CompanyFacts;
  const res = await fetchWithTimeout(FACTS_URL(cik));
  if (!res || !res.ok) return null;
  const data = (await res.json()) as CompanyFacts;
  FACTS_CACHE.set(cik, { t: Date.now(), data });
  return data;
}

function getConcept(facts: CompanyFacts, concept: string): FactUnit[] | null {
  const c = facts?.facts?.["us-gaap"]?.[concept];
  if (!c?.units) return null;
  // Prefer USD or USD/shares; fall back to first unit list.
  const unitKey = Object.keys(c.units).find((k) => k.startsWith("USD")) ?? Object.keys(c.units)[0];
  return unitKey ? c.units[unitKey] ?? null : null;
}

// Pick first non-empty concept among aliases.
function getConceptAny(facts: CompanyFacts, concepts: string[]): FactUnit[] | null {
  for (const c of concepts) {
    const u = getConcept(facts, c);
    if (u && u.length > 0) return u;
  }
  return null;
}

// Quarterly entries: form 10-Q (or fp=Q1/Q2/Q3) + 10-K's FY (which is full-year).
// We want pure quarterly series (~3-month segments). For flow concepts (revenue,
// op income, net income, CFO), 10-K val is annual — so we derive Q4 = annual − Q1−Q2−Q3.
// For stock concepts (equity, EPS), no derivation needed.

function parseEnd(s: string): number {
  return Date.parse(s);
}

// Returns array of { end, val, fy, fp } sorted oldest→newest, distinct by (fy, fp).
function quarterlyFromFlow(units: FactUnit[]): FactUnit[] {
  // Filter to 10-Q with fp Q1/Q2/Q3 + 10-K with fp FY. Drop entries lacking fy/fp.
  const q = units.filter((u) => u.fy != null && u.fp && ["Q1", "Q2", "Q3", "FY"].includes(u.fp));
  // Dedup by (fy, fp): keep latest filed/end.
  const byKey = new Map<string, FactUnit>();
  for (const u of q) {
    const key = `${u.fy}-${u.fp}`;
    const prev = byKey.get(key);
    if (!prev || parseEnd(u.end) > parseEnd(prev.end)) byKey.set(key, u);
  }
  // Sort by (fy, fp index)
  const order: Record<string, number> = { Q1: 1, Q2: 2, Q3: 3, FY: 4 };
  const sorted = Array.from(byKey.values()).sort(
    (a, b) => (a.fy! - b.fy!) || (order[a.fp!] - order[b.fp!]),
  );
  // Derive Q4 from FY − (Q1+Q2+Q3) if same fy.
  const out: FactUnit[] = [];
  const byFy: Record<number, Record<string, FactUnit>> = {};
  for (const u of sorted) {
    byFy[u.fy!] ??= {};
    byFy[u.fy!][u.fp!] = u;
  }
  for (const u of sorted) {
    if (u.fp === "FY") {
      const yr = u.fy!;
      const f = byFy[yr];
      if (f.Q1 && f.Q2 && f.Q3) {
        const q4val = u.val - f.Q1.val - f.Q2.val - f.Q3.val;
        out.push({ ...u, val: q4val, fp: "Q4" });
      }
    } else {
      out.push(u);
    }
  }
  // Re-sort with Q4 ordering
  const orderQ: Record<string, number> = { Q1: 1, Q2: 2, Q3: 3, Q4: 4 };
  return out.sort((a, b) => (a.fy! - b.fy!) || (orderQ[a.fp!] - orderQ[b.fp!]));
}

// Stock-style concepts (point-in-time, like equity / EPS): take Q1/Q2/Q3/Q4 (=FY) directly.
function quarterlyFromStock(units: FactUnit[]): FactUnit[] {
  const q = units.filter((u) => u.fy != null && u.fp && ["Q1", "Q2", "Q3", "FY"].includes(u.fp));
  const byKey = new Map<string, FactUnit>();
  for (const u of q) {
    const key = `${u.fy}-${u.fp}`;
    const prev = byKey.get(key);
    if (!prev || parseEnd(u.end) > parseEnd(prev.end)) byKey.set(key, u);
  }
  // Treat FY as Q4 for ordering convenience.
  const out = Array.from(byKey.values()).map((u) => ({ ...u, fp: u.fp === "FY" ? "Q4" : u.fp }));
  const order: Record<string, number> = { Q1: 1, Q2: 2, Q3: 3, Q4: 4 };
  return out.sort((a, b) => (a.fy! - b.fy!) || (order[a.fp!] - order[b.fp!]));
}

// EPS is reported per-period (quarterly EPS in 10-Q, annual EPS in 10-K).
// SEC tags annual EPS as fp=FY too — we keep them separate to avoid mixing.
function epsQuarterly(units: FactUnit[]): FactUnit[] {
  // Quarterly EPS comes from 10-Q. For 10-K we DO NOT have a clean Q4 EPS; derive
  // Q4 EPS = annual EPS − (Q1+Q2+Q3 EPS).
  const q = units.filter((u) => u.fy != null && u.fp && ["Q1", "Q2", "Q3", "FY"].includes(u.fp));
  const byKey = new Map<string, FactUnit>();
  for (const u of q) {
    const key = `${u.fy}-${u.fp}`;
    const prev = byKey.get(key);
    if (!prev || parseEnd(u.end) > parseEnd(prev.end)) byKey.set(key, u);
  }
  const byFy: Record<number, Record<string, FactUnit>> = {};
  for (const u of byKey.values()) {
    byFy[u.fy!] ??= {};
    byFy[u.fy!][u.fp!] = u;
  }
  const out: FactUnit[] = [];
  for (const u of byKey.values()) {
    if (u.fp === "FY") {
      const f = byFy[u.fy!];
      if (f.Q1 && f.Q2 && f.Q3) {
        out.push({ ...u, val: u.val - f.Q1.val - f.Q2.val - f.Q3.val, fp: "Q4" });
      }
    } else {
      out.push(u);
    }
  }
  const order: Record<string, number> = { Q1: 1, Q2: 2, Q3: 3, Q4: 4 };
  return out.sort((a, b) => (a.fy! - b.fy!) || (order[a.fp!] - order[b.fp!]));
}

function annualFromConcept(units: FactUnit[]): FactUnit[] {
  // FY entries (10-K).
  const a = units.filter((u) => u.fp === "FY" && u.fy != null);
  const byFy = new Map<number, FactUnit>();
  for (const u of a) {
    const prev = byFy.get(u.fy!);
    if (!prev || parseEnd(u.end) > parseEnd(prev.end)) byFy.set(u.fy!, u);
  }
  return Array.from(byFy.values()).sort((a, b) => a.fy! - b.fy!);
}

// ---- Metric computers --------------------------------------------------------

function epsQoqYoy(epsQ: FactUnit[]): number | null {
  // E1: most recent Q EPS vs same Q a year ago.
  if (epsQ.length < 5) return null;
  const last = epsQ[epsQ.length - 1];
  const yrAgo = epsQ.find((u) => u.fy === last.fy! - 1 && u.fp === last.fp);
  if (!yrAgo || yrAgo.val === 0) return null;
  return ((last.val - yrAgo.val) / Math.abs(yrAgo.val)) * 100;
}

function yoy4qSeries(seriesQ: FactUnit[]): number[] | null {
  // For each of the 4 most recent quarters, compute YoY% vs same quarter a year prior.
  if (seriesQ.length < 8) return null;
  const last4 = seriesQ.slice(-4);
  const out: number[] = [];
  for (const u of last4) {
    const yrAgo = seriesQ.find((p) => p.fy === u.fy! - 1 && p.fp === u.fp);
    if (!yrAgo || yrAgo.val === 0) return null;
    out.push(((u.val - yrAgo.val) / Math.abs(yrAgo.val)) * 100);
  }
  return out;
}

function isMonotonicAccel(arr: number[]): boolean {
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] <= arr[i - 1]) return false;
  }
  return true;
}

function isMonotonicGrowing(arr: number[]): boolean {
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] <= arr[i - 1]) return false;
  }
  return true;
}

function epsBreakout(epsQ: FactUnit[]): boolean | null {
  // E9: most recent EPS > max of prior 8 quarters.
  if (epsQ.length < 9) return null;
  const last = epsQ[epsQ.length - 1].val;
  const prior8 = epsQ.slice(-9, -1).map((u) => u.val);
  return last > Math.max(...prior8);
}

function annualEpsYoy(epsAnnual: FactUnit[]): number | null {
  // E8: most recent FY EPS vs prior FY EPS.
  if (epsAnnual.length < 2) return null;
  const last = epsAnnual[epsAnnual.length - 1];
  const prev = epsAnnual[epsAnnual.length - 2];
  if (prev.val === 0) return null;
  return ((last.val - prev.val) / Math.abs(prev.val)) * 100;
}

function ttmSum(seriesQ: FactUnit[]): number | null {
  if (seriesQ.length < 4) return null;
  return seriesQ.slice(-4).reduce((a, u) => a + u.val, 0);
}

function roeTtm(niQ: FactUnit[], equityStock: FactUnit[]): number | null {
  // E7: TTM net income / latest equity * 100.
  const ni = ttmSum(niQ);
  if (ni == null || equityStock.length === 0) return null;
  const eq = equityStock[equityStock.length - 1].val;
  if (eq <= 0) return null;
  return (ni / eq) * 100;
}

function cfpsToEpsTtm(cfoQ: FactUnit[], epsQ: FactUnit[]): number | null {
  // H2: TTM CFO / TTM EPS (proxy for CFPS/EPS — equivalent ratio if shares ~constant).
  // Strict CFPS would need shares-outstanding; ratio NI/EPS gives implicit shares.
  // We use TTM CFO / TTM NI as a quality proxy (cash conversion). To match
  // "CFPS / EPS ≥ 1.20" intent, divide CFO TTM by NI TTM (yields same ratio).
  const cfo = ttmSum(cfoQ);
  const eps = ttmSum(epsQ);
  if (cfo == null || eps == null || eps <= 0) return null;
  // Approx via TTM ratio of dollar CFO to dollar NI: effectively CFPS/EPS.
  // Caller passes niQ via a wrapper if needed; here we accept epsQ as proxy.
  return cfo / eps; // unit-mismatched but only used as approximate signal.
}

function cfpsToEpsRatio(cfoQ: FactUnit[], niQ: FactUnit[]): number | null {
  // True quality metric: CFO TTM / NI TTM (CFPS/EPS reduces to this if shares constant).
  const cfo = ttmSum(cfoQ);
  const ni = ttmSum(niQ);
  if (cfo == null || ni == null || ni <= 0) return null;
  return cfo / ni;
}

function netMargin5yHigh(niA: FactUnit[], revA: FactUnit[]): boolean | null {
  // H3: latest annual net margin = max of last 5 annual net margins.
  if (niA.length < 5 || revA.length < 5) return null;
  const merged: number[] = [];
  for (const ni of niA.slice(-5)) {
    const rev = revA.find((r) => r.fy === ni.fy);
    if (!rev || rev.val <= 0) return null;
    merged.push(ni.val / rev.val);
  }
  const latest = merged[merged.length - 1];
  return latest >= Math.max(...merged);
}

function niCagr3y(niA: FactUnit[]): number | null {
  // H4: 3-year NI CAGR (latest FY vs FY-3).
  if (niA.length < 4) return null;
  const last = niA[niA.length - 1].val;
  const start = niA[niA.length - 4].val;
  if (start <= 0 || last <= 0) return null;
  return (Math.pow(last / start, 1 / 3) - 1) * 100;
}

// ---- Public API -------------------------------------------------------------

export type SECMetrics = {
  // E series
  e1_eps_qoq_yoy_pct?: number;          // E1
  e2_eps_yoy_4q_accel?: boolean;        // E2
  e2_eps_yoy_4q_delta?: number;
  e3_rev_yoy_pct?: number;              // E3
  e4_rev_yoy_4q_accel?: boolean;        // E4
  e4_rev_yoy_4q_delta?: number;
  e5_op_inc_4q_growing?: boolean;       // E5
  e6_op_inc_yoy_4q_accel?: boolean;     // E6
  e6_op_inc_yoy_4q_delta?: number;
  e7_roe_ttm_pct?: number;              // E7
  e8_annual_eps_yoy_pct?: number;       // E8
  e9_eps_breakout?: boolean;            // E9
  // H series
  h2_cfps_to_eps?: number;              // H2 (CFO/NI ratio)
  h3_net_margin_5y_high?: boolean;      // H3
  h4_ni_cagr_3y_pct?: number;           // H4
};

export async function fetchSECFundamentals(ticker: string): Promise<SECMetrics | null> {
  // Skip non-US tickers; CIK lookup will fail anyway.
  if (ticker.includes(".")) return null;

  const cik = await tickerToCik(ticker);
  if (!cik) return null;

  const facts = await fetchCompanyFacts(cik);
  if (!facts) return null;

  // ---- Pull concept series ----
  // EPS diluted (per share). Some filers only have basic; fall back.
  const epsUnits = getConceptAny(facts, [
    "EarningsPerShareDiluted",
    "EarningsPerShareBasic",
  ]);
  // Revenue (multiple aliases — newer filers use ASC 606 tag).
  const revUnits = getConceptAny(facts, [
    "Revenues",
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
    "SalesRevenueNet",
  ]);
  // Operating income.
  const opIncUnits = getConceptAny(facts, [
    "OperatingIncomeLoss",
  ]);
  // Net income.
  const niUnits = getConceptAny(facts, [
    "NetIncomeLoss",
    "ProfitLoss",
  ]);
  // Stockholders equity (point-in-time stock concept).
  const equityUnits = getConceptAny(facts, [
    "StockholdersEquity",
    "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
  ]);
  // CFO (cash from operations).
  const cfoUnits = getConceptAny(facts, [
    "NetCashProvidedByUsedInOperatingActivities",
    "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
  ]);

  const out: SECMetrics = {};

  // ---- EPS-based rules (E1, E2, E8, E9) ----
  if (epsUnits) {
    const epsQ = epsQuarterly(epsUnits);
    if (epsQ.length > 0) {
      const e1 = epsQoqYoy(epsQ);
      if (e1 != null && Number.isFinite(e1)) out.e1_eps_qoq_yoy_pct = +e1.toFixed(2);

      const e2Series = yoy4qSeries(epsQ);
      if (e2Series && e2Series.every((x) => Number.isFinite(x))) {
        out.e2_eps_yoy_4q_accel = isMonotonicAccel(e2Series);
        out.e2_eps_yoy_4q_delta = +(e2Series[3] - e2Series[0]).toFixed(2);
      }

      const e9 = epsBreakout(epsQ);
      if (e9 != null) out.e9_eps_breakout = e9;
    }
    const epsA = annualFromConcept(epsUnits);
    if (epsA.length >= 2) {
      const e8 = annualEpsYoy(epsA);
      if (e8 != null && Number.isFinite(e8)) out.e8_annual_eps_yoy_pct = +e8.toFixed(2);
    }
  }

  // ---- Revenue-based rules (E3, E4, H3) ----
  if (revUnits) {
    const revQ = quarterlyFromFlow(revUnits);
    if (revQ.length >= 8) {
      const last = revQ[revQ.length - 1];
      const yrAgo = revQ.find((u) => u.fy === last.fy! - 1 && u.fp === last.fp);
      if (yrAgo && yrAgo.val !== 0) {
        const e3 = ((last.val - yrAgo.val) / Math.abs(yrAgo.val)) * 100;
        if (Number.isFinite(e3)) out.e3_rev_yoy_pct = +e3.toFixed(2);
      }
      const e4Series = yoy4qSeries(revQ);
      if (e4Series && e4Series.every((x) => Number.isFinite(x))) {
        out.e4_rev_yoy_4q_accel = isMonotonicAccel(e4Series);
        out.e4_rev_yoy_4q_delta = +(e4Series[3] - e4Series[0]).toFixed(2);
      }
    }
  }

  // ---- Op income rules (E5, E6) ----
  if (opIncUnits) {
    const opQ = quarterlyFromFlow(opIncUnits);
    if (opQ.length >= 4) {
      const last4 = opQ.slice(-4).map((u) => u.val);
      out.e5_op_inc_4q_growing = isMonotonicGrowing(last4);
    }
    if (opQ.length >= 8) {
      const e6Series = yoy4qSeries(opQ);
      if (e6Series && e6Series.every((x) => Number.isFinite(x))) {
        out.e6_op_inc_yoy_4q_accel = isMonotonicAccel(e6Series);
        out.e6_op_inc_yoy_4q_delta = +(e6Series[3] - e6Series[0]).toFixed(2);
      }
    }
  }

  // ---- ROE (E7) ----
  if (niUnits && equityUnits) {
    const niQ = quarterlyFromFlow(niUnits);
    const eqStock = quarterlyFromStock(equityUnits);
    const e7 = roeTtm(niQ, eqStock);
    if (e7 != null && Number.isFinite(e7)) out.e7_roe_ttm_pct = +e7.toFixed(2);
  }

  // ---- H2 CFPS/EPS proxy (CFO/NI TTM) ----
  if (cfoUnits && niUnits) {
    const cfoQ = quarterlyFromFlow(cfoUnits);
    const niQ = quarterlyFromFlow(niUnits);
    const r = cfpsToEpsRatio(cfoQ, niQ);
    if (r != null && Number.isFinite(r)) out.h2_cfps_to_eps = +r.toFixed(3);
  }

  // ---- H3 Net margin 5Y high ----
  if (niUnits && revUnits) {
    const niA = annualFromConcept(niUnits);
    const revA = annualFromConcept(revUnits);
    const h3 = netMargin5yHigh(niA, revA);
    if (h3 != null) out.h3_net_margin_5y_high = h3;
  }

  // ---- H4 NI CAGR 3Y ----
  if (niUnits) {
    const niA = annualFromConcept(niUnits);
    const h4 = niCagr3y(niA);
    if (h4 != null && Number.isFinite(h4)) out.h4_ni_cagr_3y_pct = +h4.toFixed(2);
  }

  // Use cfpsToEpsTtm reference to silence unused-export warning (kept for future).
  void cfpsToEpsTtm;

  // If nothing was extracted, treat as miss.
  if (Object.keys(out).length === 0) return null;
  return out;
}

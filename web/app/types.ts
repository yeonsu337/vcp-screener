export type RuleResult = {
  name: string;
  passed: boolean;
  value: number | null;
  threshold: number | null;
  note?: string;
};

export type ContractionRange = {
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
  high: number;
  low: number;
  depth_pct: number;
};

export type DryupRange = {
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
};

export type Candidate = {
  ticker: string;
  company: string;
  sector: string;
  industry: string;
  market: string; // "US" | "HK" | "KR"
  detected: boolean;
  stage: number;
  stage_name: string;
  score: number;
  vcp_quality: number;
  rs_rating: number;
  num_contractions: number;
  contractions: number[];
  last_contraction_pct: number | null;
  base_depth_pct: number | null;
  current_price: number | null;
  pivot_price: number | null;
  pct_to_pivot: number | null;
  volume_dryup_ratio: number | null;
  rs_line_pct_from_high: number | null;
  rules?: Record<string, RuleResult>;
  rules_passed?: number;
  rules_total?: number;
  // Composite Score v2 (Phase 1.4-α): score is now v2, score_v1 preserved.
  score_v1?: number;
  fundamentals_score?: number;        // 0~30pt
  fundamentals_basis?: "computed" | "fallback_kr_hk";
  a1_pts?: number;                    // 0~5pt sliding
  // Phase 2-4: strict Trend Template + Extended VCP penalty
  qualifies_strict?: boolean;         // true iff Trend Template 8/8 passes
  extended_penalty?: number;          // vcp_quality halved if pct_to_pivot > +8%
  // Phase 2-3 demotion tracking
  detection_demoted_reason?: string;
  // Provenance (added by /api/search): how this Candidate was produced.
  // "cached"        → daily-scan results.json (full 42-rule eval)
  // "computed"      → on-demand price-only eval (no fundamentals)
  // "computed+sec"  → on-demand + SEC EDGAR fundamentals (US only)
  source?: "cached" | "computed" | "computed+sec";
  // VCP visualization metadata (optional, hydrated by detect_vcp).
  contraction_ranges?: ContractionRange[];
  pivot_date?: string | null;
  shakeout_dates?: string[];
  dryup_ranges?: DryupRange[];
};

export type MarketBreakdown = {
  total: number;
  detected: number;
};

export type MarketDirection = {
  direction_rules: Record<string, RuleResult>;
  direction_passed: number;
  direction_total: number;
};

export type Meta = {
  updated_at: string;
  total_candidates: number;
  vcp_detected: number;
  min_rs: number;
  markets: Record<string, MarketBreakdown>;
  market_direction?: Record<string, MarketDirection>;
  runtime_sec: number;
};

export type OhlcvBar = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type RsLinePoint = {
  time: string;
  value: number;
};

export type FinancialMetrics = {
  eps_ttm: number | null;
  eps_forward: number | null;
  pe_ttm: number | null;
  pe_forward: number | null;
  market_cap: number | null;
  roe: number | null;
  roa: number | null;
  profit_margin: number | null;
  gross_margin: number | null;
  operating_margin: number | null;
  revenue_growth: number | null;
  earnings_growth: number | null;
  dividend_yield: number | null;
  payout_ratio: number | null;
  currency: string;
  sector: string;
  industry: string;
  name: string;
};

export type AnnualFinancials = {
  periods: string[];
  revenue: (number | null)[];
  gross_profit: (number | null)[];
  operating_income: (number | null)[];
  operating_margin: (number | null)[];
  net_income: (number | null)[];
  eps: (number | null)[];
  total_assets: (number | null)[];
  total_liabilities: (number | null)[];
  equity: (number | null)[];
  cash: (number | null)[];
  total_debt: (number | null)[];
  current_assets: (number | null)[];
  current_liabilities: (number | null)[];
  debt_to_equity: (number | null)[];
  current_ratio: (number | null)[];
  cash_ratio: (number | null)[];
  roe: (number | null)[];
  roa: (number | null)[];
  dividend_yield: (number | null)[];
  operating_cf: (number | null)[];
  capex: (number | null)[];
  free_cf: (number | null)[];
  // YoY growth (computed)
  revenue_yoy?: (number | null)[];
  operating_income_yoy?: (number | null)[];
  eps_yoy?: (number | null)[];
  free_cf_yoy?: (number | null)[];
};

export type QuarterlyFinancials = {
  periods: string[];
  revenue: (number | null)[];
  net_income: (number | null)[];
  eps: (number | null)[];
  gross_profit: (number | null)[];
  operating_income: (number | null)[];
  operating_margin: (number | null)[];
  total_debt: (number | null)[];
  equity: (number | null)[];
  current_assets: (number | null)[];
  current_liabilities: (number | null)[];
  cash: (number | null)[];
  total_assets: (number | null)[];
  debt_to_equity: (number | null)[];
  current_ratio: (number | null)[];
  cash_ratio: (number | null)[];
  roe: (number | null)[];
  roa: (number | null)[];
  dividend_yield: (number | null)[];
  operating_cf: (number | null)[];
  capex: (number | null)[];
  free_cf: (number | null)[];
  eps_yoy: (number | null)[];
  revenue_yoy: (number | null)[];
  operating_income_yoy: (number | null)[];
};

export type TickerFinancials = {
  ticker: string;
  metrics: FinancialMetrics;
  annual: AnnualFinancials;
  quarterly: QuarterlyFinancials;
};

export type ChartPayload = {
  ticker: string;
  ohlcv: OhlcvBar[];
  rs_line?: RsLinePoint[];
};

// Minervini bot recommendation per ticker (spec: docs/minervini-bot-persona.md).
export type MinerviniVerdict =
  | "BUY_NOW"
  | "BUY_AT_PIVOT"
  | "WATCH"
  | "EXTENDED"
  | "AVOID"
  | "STOP_OUT";

export type MinerviniCall = {
  $schema: "minervini-bot.v1";
  ticker: string;
  generated_at: string;
  source_results_date: string;
  verdict: MinerviniVerdict;
  verdict_kr: string;
  confidence: number;
  lines: string[];
  action: {
    entry_type: "pivot_breakout" | "immediate" | "none";
    entry_price: number | null;
    stop_price: number | null;
    stop_pct: number | null;
    target1_price: number | null;
    target1_pct: number | null;
    trailing_rule: string | null;
    position_risk_pct: number;
  };
  framework: {
    trend_template_score: string;
    vcp_quality_score: string;
    rs_rating: number;
    stage: number;
    base_count: number;
    late_base_warning: boolean;
    market_regime: "bull" | "neutral" | "bear";
  };
  rule_references: string[];
  key_failures: string[];
  warnings: string[];
};

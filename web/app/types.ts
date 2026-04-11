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
};

export type MarketBreakdown = {
  total: number;
  detected: number;
};

export type Meta = {
  updated_at: string;
  total_candidates: number;
  vcp_detected: number;
  min_rs: number;
  markets: Record<string, MarketBreakdown>;
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

export type ChartPayload = {
  ticker: string;
  ohlcv: OhlcvBar[];
  rs_line?: RsLinePoint[];
};

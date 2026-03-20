export interface PlatformTrendTotal {
  count: number;
  gmv: number;
  prevCount: number;
  prevGmv: number;
}

export interface PlatformTrendPoint {
  date: string;
  [platform: string]: number | string;
}

export interface PlatformTrendViewData {
  data: PlatformTrendPoint[];
  platforms: string[];
  totals?: Record<string, PlatformTrendTotal>;
}

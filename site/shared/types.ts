export interface Summary {
  n: number;
  median: number;
  mean: number;
  stddev: number;
  min: number;
  max: number;
}

export interface HostInfo {
  id: string;
  label: string;
  cpu: string;
  cores: number;
  memory_gb: number;
  os: string;
  runs: number;
  first: string;
  last: string;
}

export interface VariantInfo {
  id: string;
  name: string;
  default: boolean;
}

export interface RuntimeInfo {
  id: string;
  base: string;
  variant: VariantInfo | null;
  name: string;
  kind: string;
  version: string;
  launcher: string | null;
}

export interface Meta {
  runtimes: RuntimeInfo[];
  hasVariants: boolean;
  hosts: HostInfo[];
  suites: string[];
  runCount: number;
  latest: string | null;
  scoreVersion: number;
  demo: boolean;
  warnings: string[];
}

export interface ParitySummary {
  verdict: "passed" | "failed" | "unknown";
  passed: number | null;
  total: number | null;
  failed_groups: { name: string; passed: number; total: number }[];
}

export interface LatestRuntime {
  id: string;
  base: string;
  variant: VariantInfo | null;
  name: string;
  kind: string;
  version: string;
  launcher: string | null;
  display: string | null;
  timestamp: string;
  stale: boolean;
  suiteHash: string;
  repoSha: string | null;
  runs: { ok: number; total: number };
  benchmarks: Record<string, Summary | null>;
  startup_ms: Summary | null;
  run_ms: Summary | null;
  peak_rss_mb: Summary | null;
  parity: (ParitySummary & { timestamp: string; stale: boolean }) | null;
}

export interface LatestParity {
  id: string;
  name: string;
  parity: ParitySummary & { timestamp: string; stale: boolean };
}

export interface Latest {
  host: string;
  timestamp: string | null;
  runtimes: LatestRuntime[];
  parity: LatestParity[];
}

export interface HistoryRuntime {
  versions: (string | null)[];
  startup_ms: (number | null)[];
  peak_rss_mb: (number | null)[];
  parity_passed: (number | null)[];
  parity_total: (number | null)[];
  backfilled: boolean[];
  bench: Record<string, (number | null)[]>;
  rsd: Record<string, (number | null)[]>;
}

export interface History {
  host: string;
  timestamps: string[];
  suiteHashes: (string | null)[];
  shas: (string | null)[];
  runtimes: Record<string, HistoryRuntime>;
}

export interface ScoreSeries {
  total: (number | null)[];
  categories: Record<string, (number | null)[]>;
  coverage: (number | null)[];
}

export interface ScoreHistory {
  host: string;
  weights: "default" | "equal";
  scoreVersion: number;
  timestamps: string[];
  suiteHashes: (string | null)[];
  runtimes: Record<string, ScoreSeries>;
}

export interface BenchStatus {
  running: boolean;
  startedAt: string | null;
  lastRun: {
    startedAt: string;
    finishedAt: string;
    ok: boolean;
    message: string;
    durationMs: number;
  } | null;
  nextRun: string | null;
  schedule: string | null;
}

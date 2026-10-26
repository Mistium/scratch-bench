export interface Summary {
  n: number;
  median: number;
  mean: number;
  stddev: number;
  min: number;
  max: number;
}

export const summarize = (values: number[]): Summary | null => {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const mid = v.length >> 1;
  const median = v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  const variance = v.length > 1
    ? v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1)
    : 0;
  return {
    n: v.length,
    median,
    mean,
    stddev: Math.sqrt(variance),
    min: v[0],
    max: v[v.length - 1],
  };
};

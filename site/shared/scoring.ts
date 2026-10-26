import {
  BENCHMARK_BY_ID,
  benchmarksIn,
  CATEGORIES,
  CATEGORY_IDS,
  type CategoryId,
} from "./benchmarks.ts";

export const SCORE_VERSION = 2;

export const MIN_COVERAGE = 0.8;

export type WeightMode = "default" | "equal";

export type Medians = Record<string, number | null | undefined>;

export interface CategoryScore {
  score: number | null;
  coverage: number;
  counted: number;
  total: number;
}

export interface RuntimeScore {
  total: number | null;
  coverage: number;
  categories: Record<CategoryId, CategoryScore>;
}

const usable = (x: number | null | undefined): x is number =>
  typeof x === "number" && Number.isFinite(x) && x > 0;

export const geometricMean = (
  items: { value: number; weight: number }[],
): number | null => {
  let sum = 0;
  let weights = 0;
  for (const { value, weight } of items) {
    if (!(weight > 0) || !(value > 0)) continue;
    sum += weight * Math.log(value);
    weights += weight;
  }
  return weights > 0 ? Math.exp(sum / weights) : null;
};

export const categoryWeight = (id: CategoryId, mode: WeightMode): number =>
  mode === "equal" ? 1 : CATEGORIES[id].weight;

export const scoreRuntime = (
  runtime: Medians,
  mode: WeightMode = "default",
): RuntimeScore => {
  const categories = {} as Record<CategoryId, CategoryScore>;
  let counted = 0;
  let all = 0;

  for (const id of CATEGORY_IDS) {
    const benches = benchmarksIn(id);
    const values: { value: number; weight: number }[] = [];
    for (const bench of benches) {
      const v = runtime[bench.id];
      if (usable(v)) {
        values.push({
          value: v,
          weight: mode === "equal" ? 1 : bench.weight ?? 1,
        });
      }
    }
    const coverage = benches.length ? values.length / benches.length : 0;
    counted += values.length;
    all += benches.length;
    categories[id] = {
      score: coverage >= MIN_COVERAGE ? geometricMean(values) : null,
      coverage,
      counted: values.length,
      total: benches.length,
    };
  }

  const parts = CATEGORY_IDS.map((id) => ({ id, score: categories[id].score }));
  const complete = parts.every((p) => p.score !== null);
  const total = complete
    ? geometricMean(
      parts.map((p) => ({
        value: p.score!,
        weight: categoryWeight(p.id, mode),
      })),
    )
    : null;

  return { total, coverage: all ? counted / all : 0, categories };
};

export const ratioToBaseline = (
  value: number | null | undefined,
  base: number | null | undefined,
): number | null => usable(value) && usable(base) ? value / base : null;

export const unknownBenchmarks = (medians: Medians): string[] =>
  Object.keys(medians).filter((id) => !BENCHMARK_BY_ID[id]);

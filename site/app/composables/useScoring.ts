import type { ScoreHistory } from "#shared/types";

export const lastIndex = (series: (number | null)[] | undefined): number => {
  if (!series) return -1;
  for (let i = series.length - 1; i >= 0; i--) if (series[i] != null) return i;
  return -1;
};

export const lastValue = (
  series: (number | null)[] | undefined,
): number | null => {
  const i = lastIndex(series);
  return i < 0 ? null : series?.[i] ?? null;
};

export const previousValue = (
  series: (number | null)[] | undefined,
): number | null => {
  const i = lastIndex(series);
  if (i <= 0) return null;
  for (let j = i - 1; j >= 0; j--) {
    if (series?.[j] != null) return series[j] ?? null;
  }
  return null;
};

/**
 * The latest total in a runtime's series, from a run of the same kind as the latest run (one that
 * scored real projects, or one that didn't): totals of different kinds aren't on one scale, so a
 * runtime without one of the latest kind has none, rather than an older one of the other kind.
 */
export const lastTotal = (
  scores: ScoreHistory | null | undefined,
  series: (number | null)[] | undefined,
): number | null => totalsOfKind(scores, series).at(-1) ?? null;

/** The total before lastTotal, from a run of the same kind. */
export const previousTotal = (
  scores: ScoreHistory | null | undefined,
  series: (number | null)[] | undefined,
): number | null => totalsOfKind(scores, series).at(-2) ?? null;

const totalsOfKind = (
  scores: ScoreHistory | null | undefined,
  series: (number | null)[] | undefined,
): number[] => {
  if (!scores || !series) return [];
  const kinds = scores.projectRuns ?? [];
  const kind = kinds.at(-1) ?? false;
  return series.filter((v, i): v is number => v != null && (kinds[i] ?? false) === kind);
};

export const useRankedRuntimeIds = (
  host: Ref<string>,
  weights: Ref<string>,
) => {
  const { data: scores } = useScoreData(host, weights);
  return computed(() =>
    Object.entries(scores.value?.runtimes ?? {})
      .map(([id, s]) => ({ id, total: lastTotal(scores.value, s.total) }))
      .sort((a, b) => (b.total ?? -1) - (a.total ?? -1))
      .map((r) => r.id)
  );
};

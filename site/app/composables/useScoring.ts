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

export const useRankedRuntimeIds = (
  host: Ref<string>,
  weights: Ref<string>,
) => {
  const { data: scores } = useScoreData(host, weights);
  return computed(() =>
    Object.entries(scores.value?.runtimes ?? {})
      .map(([id, s]) => ({ id, total: lastValue(s.total) }))
      .sort((a, b) => (b.total ?? -1) - (a.total ?? -1))
      .map((r) => r.id)
  );
};

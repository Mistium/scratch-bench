export interface Measure {
  id: string;
  better: "higher" | "lower";
}

export const rankFor = (
  rows: { id: string; values: Record<string, number | null> }[],
  measures: Measure[],
) => {
  const usable = rows.filter((r) =>
    measures.every((m) => (r.values[m.id] ?? 0) > 0)
  );
  if (!measures.length || !usable.length) return [];
  const best = Object.fromEntries(measures.map((m) => {
    const values = usable.map((r) => r.values[m.id]!);
    return [
      m.id,
      m.better === "higher" ? Math.max(...values) : Math.min(...values),
    ];
  }));
  return usable
    .map((r) => {
      const logs = measures.map((m) =>
        Math.log(
          m.better === "higher"
            ? r.values[m.id]! / best[m.id]!
            : best[m.id]! / r.values[m.id]!,
        )
      );
      return {
        id: r.id,
        fit: Math.exp(logs.reduce((a, x) => a + x, 0) / logs.length),
      };
    })
    .sort((a, b) => b.fit - a.fit);
};

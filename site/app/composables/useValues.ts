import { ratioToBaseline } from "#shared/scoring";
import type { Latest } from "#shared/types";

export const useValues = (
  latest: Ref<Latest | null | undefined>,
  baseline: Ref<string>,
  mode: Ref<"absolute" | "relative">,
) => {
  const median = (runtime: string, bench: string): number | null =>
    latest.value?.runtimes.find((r) => r.id === runtime)?.benchmarks[bench]
      ?.median ?? null;
  const ratio = (runtime: string, bench: string): number | null =>
    ratioToBaseline(median(runtime, bench), median(baseline.value, bench));
  const value = (runtime: string, bench: string): number | null =>
    mode.value === "relative" ? ratio(runtime, bench) : median(runtime, bench);
  const text = (runtime: string, bench: string): string =>
    mode.value === "relative"
      ? fmtSpeedup(ratio(runtime, bench))
      : fmtOps(median(runtime, bench));
  return { median, ratio, value, text };
};

import {
  BENCHMARK_BY_ID,
  BENCHMARKS,
  benchmarksIn,
  CATEGORIES,
  CATEGORY_IDS,
  type CategoryId,
} from "./benchmarks.ts";

export const SCORE_VERSION = 3;

/** Each real project counts as much as this many benchmarks of average weight in the total. */
export const PROJECT_WEIGHT = 2;

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
  /** The real projects, when the run replayed them. */
  projects: CategoryScore | null;
}

/**
 * The runtime whose replays the others are compared with. There is no fallback: comparing some
 * projects with one runtime and others with another would mix scales in one score.
 */
export const PROJECT_REFERENCE = "turbowarp";

type Replayed = {
  error?: string | null;
  frames?: number | null;
  drifted?: number | null;
  checkpoints?: Record<string, number> | null;
} | undefined;

/** A replay that ran without error and did the recorded work (drifted on at most 1% of frames). */
const comparable = (p: Replayed): p is NonNullable<Replayed> =>
  !!p && !p.error && p.frames != null && !!p.checkpoints && (p.drifted ?? 0) <= p.frames * 0.01;

/**
 * A replay's checkpoints, as frame → script time. One past the frames it reached is a bound: it was
 * cut in a frame that didn't end, and would have reached that checkpoint no sooner. Compared there
 * a runtime does no worse than it deserves, so its own bound counts, but a reference's doesn't.
 */
const marksOf = (p: NonNullable<Replayed>, bounds: boolean) =>
  Object.entries(p.checkpoints ?? {}).filter(([f, ms]) => ms > 0 && (bounds || Number(f) <= p.frames!));

/** The furthest checkpoint frame both replays reached, with each one's script time there. */
const sharedCheckpoint = (p: NonNullable<Replayed>, ref: NonNullable<Replayed>) => {
  const theirs = Object.fromEntries(marksOf(ref, false));
  const [frame, mine] = marksOf(p, true)
    .filter(([f]) => f in theirs)
    .sort(([x], [y]) => Number(y) - Number(x))[0] ?? [];
  return frame === undefined ? null : { mine: mine!, theirs: theirs[frame]! };
};

/**
 * How fast a replay ran against the reference's, on exactly the same frames: the reference's script
 * time over its own at the furthest checkpoint both reached (a runtime that couldn't get through the
 * recording in its time is compared on the frames it did). 1 for the reference itself; null when
 * either can't be compared.
 */
export const relativeSpeed = (p: Replayed, reference: Replayed): number | null => {
  if (!comparable(p) || !comparable(reference)) return null;
  const shared = sharedCheckpoint(p, reference);
  return shared && shared.theirs / shared.mine;
};

/**
 * A replay's score for one project, in frames per millisecond of script time: its speed against the
 * reference on the same frames, times the reference's own frames per millisecond over as much of the recording
 * as it got through. Absolute, so a change in the reference shows in its own score; comparable
 * between runtimes of the same run.
 */
export const projectValue = (p: Replayed, reference: Replayed): number | null => {
  const speed = relativeSpeed(p, reference);
  if (speed === null || !comparable(reference)) return null;
  const [furthest, ms] = marksOf(reference, false).sort(([x], [y]) => Number(y) - Number(x))[0] ?? [];
  return furthest === undefined ? null : speed * (Number(furthest) / ms!);
};

/** The reference replay for a project among a run's results, if it can be compared. */
export const referenceFor = <T extends Replayed>(id: string, runtimes: Record<string, Record<string, T>>): T | undefined => {
  const p = runtimes[PROJECT_REFERENCE]?.[id];
  return comparable(p) && marksOf(p, false).length ? p : undefined;
};

/** The share of the total an average benchmark has: its category's weight over its category's size. */
const averageBenchmarkWeight = (mode: WeightMode): number =>
  CATEGORY_IDS.reduce((n, id) => n + categoryWeight(id, mode), 0) / BENCHMARKS.length;

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

/**
 * `projects` maps each project the run scored to the runtime's value for it (see projectValue), null
 * where it can't be compared. Without it the total is the benchmarks' alone, as for runs that scored
 * no projects; with it, a runtime with none of them comparable has no total, since its total
 * wouldn't be comparable with the others'.
 */
export const scoreRuntime = (
  runtime: Medians,
  mode: WeightMode = "default",
  projects?: Medians,
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

  let projectScore: CategoryScore | null = null;
  const ids = Object.keys(projects ?? {});
  if (ids.length) {
    // Projects that couldn't be compared (a failed or cut-off replay) are left out rather than
    // blanking the total; none at all means the runtime can't be compared.
    const speeds = ids.map((id) => projects![id]).filter(usable);
    const coverage = speeds.length / ids.length;
    projectScore = {
      score: speeds.length ? geometricMean(speeds.map((value) => ({ value, weight: 1 }))) : null,
      coverage,
      counted: speeds.length,
      total: ids.length,
    };
  }

  const parts = CATEGORY_IDS.map((id) => ({
    score: categories[id].score,
    weight: categoryWeight(id, mode),
  }));
  if (projectScore) {
    parts.push({
      score: projectScore.score,
      weight: PROJECT_WEIGHT * ids.length * averageBenchmarkWeight(mode),
    });
  }
  const complete = parts.every((p) => p.score !== null);
  const total = complete
    ? geometricMean(parts.map((p) => ({ value: p.score!, weight: p.weight })))
    : null;

  return { total, coverage: all ? counted / all : 0, categories, projects: projectScore };
};

export const ratioToBaseline = (
  value: number | null | undefined,
  base: number | null | undefined,
): number | null => usable(value) && usable(base) ? value / base : null;

export const unknownBenchmarks = (medians: Medians): string[] =>
  Object.keys(medians).filter((id) => !BENCHMARK_BY_ID[id]);

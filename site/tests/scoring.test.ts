import { describe, expect, it } from "vitest";
import { BENCHMARKS, CATEGORIES, CATEGORY_IDS } from "../shared/benchmarks.ts";
import {
  geometricMean,
  type Medians,
  MIN_COVERAGE,
  PROJECT_WEIGHT,
  projectValue,
  referenceFor,
  relativeSpeed,
  ratioToBaseline,
  scoreRuntime,
} from "../shared/scoring.ts";

const all = (value: number): Medians =>
  Object.fromEntries(BENCHMARKS.map((b) => [b.id, value]));

describe("geometricMean", () => {
  it("is the weighted geometric mean", () => {
    expect(geometricMean([{ value: 2, weight: 1 }, { value: 8, weight: 1 }]))
      .toBeCloseTo(4);
    expect(geometricMean([{ value: 2, weight: 3 }, { value: 16, weight: 1 }]))
      .toBeCloseTo(2 ** 1.75);
  });
  it("ignores non-positive weights and values, and is null when nothing is left", () => {
    expect(
      geometricMean([{ value: 4, weight: 1 }, { value: 9, weight: 0 }, {
        value: -1,
        weight: 1,
      }]),
    ).toBeCloseTo(4);
    expect(geometricMean([])).toBeNull();
  });
});

describe("scoreRuntime", () => {
  it("scores uniform results as that result, whatever the weights", () => {
    const s = scoreRuntime(all(123));
    expect(s.total).toBeCloseTo(123);
    expect(s.coverage).toBe(1);
    for (const id of CATEGORY_IDS) {
      expect(s.categories[id].score).toBeCloseTo(123);
    }
    expect(scoreRuntime(all(123), "equal").total).toBeCloseTo(123);
  });

  it("is the raw result, with no baseline involved", () => {
    expect(scoreRuntime(all(500)).total).toBeCloseTo(500);
    const mixed = { ...all(10), loops_empty: 1000 };
    expect(scoreRuntime(mixed).categories.loops.score).toBeGreaterThan(10);
  });

  it("a category score is the geometric mean of its benchmarks", () => {
    const r = all(1);
    const loops = BENCHMARKS.filter((b) => b.category === "loops");
    loops.forEach((b, i) => (r[b.id] = 2 ** i));
    const mean = 2 ** ((loops.length - 1) / 2);
    expect(scoreRuntime(r).categories.loops.score).toBeCloseTo(mean);
  });

  it("weights categories: a faster applications category moves the total more than a faster loops category", () => {
    const base = all(100);
    const fasterApps: Medians = { ...base };
    const fasterLoops: Medians = { ...base };
    for (const b of BENCHMARKS) {
      if (b.category === "applications") fasterApps[b.id] = 400;
      if (b.category === "loops") fasterLoops[b.id] = 400;
    }
    expect(scoreRuntime(fasterApps).total!).toBeGreaterThan(
      scoreRuntime(fasterLoops).total!,
    );
    expect(scoreRuntime(fasterApps, "equal").total).toBeCloseTo(
      scoreRuntime(fasterLoops, "equal").total!,
    );
  });

  it("uses the registry's category weights", () => {
    const r: Medians = all(1);
    for (const b of BENCHMARKS) if (b.category === "applications") r[b.id] = 16;
    const totalWeight = CATEGORY_IDS.reduce(
      (s, id) => s + CATEGORIES[id].weight,
      0,
    );
    expect(scoreRuntime(r).total).toBeCloseTo(
      Math.exp((CATEGORIES.applications.weight * Math.log(16)) / totalWeight),
    );
  });

  it("gives no category score below the coverage threshold, and then no total", () => {
    const r = all(20);
    const loops = BENCHMARKS.filter((b) => b.category === "loops");
    const drop = Math.floor(loops.length * (1 - MIN_COVERAGE)) + 1;
    for (const b of loops.slice(0, drop)) r[b.id] = null;
    const s = scoreRuntime(r);
    expect(s.categories.loops.score).toBeNull();
    expect(s.total).toBeNull();
    expect(s.categories.math.score).toBeCloseTo(20);
  });

  it("still scores a category with a missing benchmark when coverage is high enough", () => {
    const r = all(20);
    r["math_arith"] = undefined;
    const s = scoreRuntime(r);
    expect(s.categories.math.score).toBeCloseTo(20);
    expect(s.categories.math.coverage).toBeLessThan(1);
    expect(s.total).toBeCloseTo(20);
  });

  it("treats zero, negative and non-finite results as missing", () => {
    const r = all(50);
    r["loops_empty"] = 0;
    r["loops_repeat"] = Number.NaN;
    r["loops_until"] = -4;
    const s = scoreRuntime(r);
    expect(s.categories.loops.counted).toBe(s.categories.loops.total - 3);
  });
});

describe("ratioToBaseline", () => {
  it("is null unless both sides are usable", () => {
    expect(ratioToBaseline(10, 5)).toBe(2);
    expect(ratioToBaseline(null, 5)).toBeNull();
    expect(ratioToBaseline(10, 0)).toBeNull();
  });
});

describe("scoreRuntime with real projects", () => {
  const categoryWeights = CATEGORY_IDS.reduce((n, id) => n + CATEGORIES[id].weight, 0);

  it("counts each project as much as two benchmarks of average weight", () => {
    const projects = { a: 100, b: 100, c: 100 };
    const s = scoreRuntime(all(1), "default", projects);
    expect(s.projects?.score).toBeCloseTo(100);
    // Benchmarks at 1 and projects at 100: the total is 100 to the projects' share of the weight.
    const projectWeight = PROJECT_WEIGHT * 3 * (categoryWeights / BENCHMARKS.length);
    expect(s.total).toBeCloseTo(100 ** (projectWeight / (categoryWeights + projectWeight)));
  });

  const replay = (frames: number, checkpoints: Record<string, number>, extra = {}) => ({
    error: null, frames, drifted: 0, checkpoints, ...extra,
  });

  it("compares a replay with the reference on the furthest frame both got to", () => {
    const reference = replay(300, { 1: 2, 30: 40, 300: 500 });
    // Twice as slow on the same 300 frames.
    expect(relativeSpeed(replay(300, { 1: 3, 30: 80, 300: 1000 }), reference)).toBe(0.5);
    // Only got to frame 30 in its time: compared on those 30 frames.
    expect(relativeSpeed(replay(41, { 1: 10, 30: 160, 41: 300 }), reference)).toBe(0.25);
    expect(relativeSpeed(reference, reference)).toBe(1);
  });

  it("doesn't score a replay that failed, drifted or has nothing to compare", () => {
    const reference = replay(300, { 1: 2, 300: 500 });
    expect(relativeSpeed({ error: "crashed", frames: 0, checkpoints: null }, reference)).toBeNull();
    expect(relativeSpeed(replay(300, { 300: 600 }, { drifted: 3 }), reference)).toBeCloseTo(500 / 600);
    expect(relativeSpeed(replay(300, { 300: 600 }, { drifted: 4 }), reference)).toBeNull();
    expect(relativeSpeed(replay(300, { 300: 600 }), undefined)).toBeNull();
    expect(relativeSpeed(replay(300, { 300: 600 }), replay(300, { 300: 500 }, { error: "x" }))).toBeNull();
    // No checkpoint in common.
    expect(relativeSpeed(replay(2, { 2: 10 }), replay(300, { 1: 2, 300: 500 }))).toBeNull();
  });

  it("values a replay in frames per millisecond, through the reference's own speed", () => {
    const reference = replay(300, { 1: 2, 30: 40, 300: 500 });
    // The reference ran 300 frames in 500 ms.
    expect(projectValue(reference, reference)).toBeCloseTo(300 / 500);
    expect(projectValue(replay(300, { 300: 1000 }), reference)).toBeCloseTo(0.5 * 300 / 500);
    // Cut off at frame 30, at a quarter of the reference's speed there: a quarter of its value.
    expect(projectValue(replay(41, { 30: 160, 41: 300 }), reference)).toBeCloseTo(0.25 * 300 / 500);
    // A faster reference raises every runtime's value with it, so the reference's own changes show.
    const faster = replay(300, { 1: 1, 30: 20, 300: 250 });
    expect(projectValue(replay(300, { 300: 1000 }), faster)).toBeCloseTo(projectValue(replay(300, { 300: 1000 }), reference)!);
    expect(projectValue(faster, faster)).toBeCloseTo(2 * projectValue(reference, reference)!);
    expect(projectValue(replay(300, { 300: 1000 }), undefined)).toBeNull();
  });

  it("compares a replay cut in a frame that didn't end on its bound, and never a reference's", () => {
    const reference = replay(300, { 1: 2, 30: 40, 300: 500 });
    // Stuck in its first frame for at least 3 s: at most 2/3000 of the reference's speed.
    expect(relativeSpeed(replay(0, { 1: 3000 }, { hash: "unfinished" }), reference)).toBeCloseTo(2 / 3000);
    // Reached frame 30, then stuck: its bound at the next checkpoint, 50, has no match, so frame 30.
    expect(relativeSpeed(replay(30, { 1: 4, 30: 80, 50: 3080 }), reference)).toBe(0.5);
    // A reference cut at frame 30 is only compared where it really got to.
    const cut = replay(30, { 1: 2, 30: 40, 50: 3040 });
    expect(relativeSpeed(replay(300, { 1: 4, 30: 80, 50: 100, 300: 1000 }), cut)).toBe(0.5);
    expect(projectValue(cut, cut)).toBeCloseTo(30 / 40);
    // One stuck in its first frame has nothing real to be compared with.
    expect(referenceFor("1", { turbowarp: { 1: replay(0, { 1: 3000 }) } })).toBeUndefined();
  });

  it("uses TurboWarp's replay as the reference, and no other", () => {
    const tw = replay(300, { 300: 500 });
    const scratch = replay(40, { 30: 900, 40: 1200 });
    expect(referenceFor("1", { turbowarp: { 1: tw }, scratch: { 1: scratch } })).toBe(tw);
    expect(referenceFor("1", { turbowarp: { 1: { ...tw, error: "x" } }, scratch: { 1: scratch } })).toBeUndefined();
    expect(referenceFor("1", { turbowarp: { 1: { ...tw, drifted: 4 } } })).toBeUndefined();
    expect(referenceFor("1", { scratch: { 1: scratch } })).toBeUndefined();
  });

  it("leaves the total to the benchmarks for runs without projects", () => {
    expect(scoreRuntime(all(7), "default", undefined).total).toBeCloseTo(7);
    expect(scoreRuntime(all(7)).projects).toBeNull();
  });

  it("leaves out projects it couldn't compare, and has no total with none", () => {
    const s = scoreRuntime(all(1), "default", { a: 5, b: null, c: null, d: 5, e: 5 });
    expect(s.projects?.coverage).toBeCloseTo(0.6);
    expect(s.projects?.counted).toBe(3);
    expect(s.projects?.score).toBeCloseTo(5);
    expect(s.total).not.toBeNull();
    const none = scoreRuntime(all(1), "default", { a: null, b: null });
    expect(none.projects?.score).toBeNull();
    expect(none.total).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { BENCHMARKS, CATEGORIES, CATEGORY_IDS } from "../shared/benchmarks.ts";
import {
  geometricMean,
  type Medians,
  MIN_COVERAGE,
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

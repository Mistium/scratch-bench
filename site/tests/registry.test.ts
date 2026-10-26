import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BENCHMARK_BY_ID,
  BENCHMARKS,
  CATEGORY_IDS,
  MAIN_BENCHMARKS,
} from "../shared/benchmarks.ts";

const stageDir = path.resolve(
  import.meta.dirname,
  "../../performance/project/Stage",
);

const projectIds = (): string[] => {
  const ids = new Set<string>();
  for (const file of fs.readdirSync(stageDir)) {
    if (!file.endsWith(".fractch")) continue;
    const text = fs.readFileSync(path.join(stageDir, file), "utf8");
    for (const m of text.matchAll(/@bench_end\("([a-z0-9_]+)"/g)) ids.add(m[1]);
  }
  return [...ids];
};

describe("benchmark registry", () => {
  it("matches the benchmarks in performance/project exactly", () => {
    const fromProject = projectIds().sort();
    const fromRegistry = BENCHMARKS.map((b) => b.id).sort();
    expect(fromRegistry).toEqual(fromProject);
  });

  it("has unique ids and puts every benchmark in a known category", () => {
    expect(new Set(BENCHMARKS.map((b) => b.id)).size).toBe(BENCHMARKS.length);
    for (const b of BENCHMARKS) expect(CATEGORY_IDS).toContain(b.category);
    expect(Object.keys(BENCHMARK_BY_ID).length).toBe(BENCHMARKS.length);
  });

  it("has benchmarks in every category and some marked as main", () => {
    for (const id of CATEGORY_IDS) {
      expect(BENCHMARKS.some((b) => b.category === id)).toBe(true);
    }
    expect(MAIN_BENCHMARKS.length).toBeGreaterThanOrEqual(5);
  });

  it("describes every benchmark", () => {
    for (const b of BENCHMARKS) {
      expect(b.label.length).toBeGreaterThan(2);
      expect(b.description.length).toBeGreaterThan(10);
      expect(b.unit.length).toBeGreaterThan(1);
    }
  });
});

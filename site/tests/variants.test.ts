import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generate } from "../scripts/demo-results.ts";
import {
  buildHistory,
  buildLatest,
  buildMeta,
  buildScores,
  viewOf,
} from "../server/utils/queries.ts";
import { loadDataset } from "../server/utils/results.ts";

let dir: string;
let template: Record<string, any>;

const NAMES: Record<string, string> = {
  turbowarp: "TurboWarp",
  "scratch-everywhere": "Scratch Everywhere!",
  scratch: "Scratch",
};

const mode = (id: string, name: string, isDefault: boolean) => ({
  id,
  name,
  default: isDefault,
});

const write = (
  night: string,
  base: string,
  variant: ReturnType<typeof mode> | null,
  scale: number,
  suite: "performance" | "parity" = "performance",
) => {
  const run = path.join(dir, `${night}T03-00-00-000Z`);
  fs.mkdirSync(run, { recursive: true });
  const t = suite === "performance"
    ? template
    : JSON.parse(JSON.stringify(template));
  const results = Object.fromEntries(
    Object.entries(t.results as Record<string, any>).map(([k, v]) => [
      k,
      {
        ...v,
        ops_per_ms: { ...v.ops_per_ms, median: v.ops_per_ms.median * scale },
      },
    ]),
  );
  const body = {
    ...t,
    timestamp: `${night}T03:00:00.000Z`,
    runtime: { ...t.runtime, id: base, name: NAMES[base], variant },
    results,
  };
  const file = `${suite}-${base}${
    variant && !variant.default ? `@${variant.id}` : ""
  }.json`;
  fs.writeFileSync(path.join(run, file), JSON.stringify(body));
};

beforeAll(() => {
  const demo = fs.mkdtempSync(path.join(os.tmpdir(), "bench-demo-"));
  generate(demo, { nights: 2, end: new Date("2026-09-30T00:00:00Z"), seed: 3 });
  const first = fs.readdirSync(demo).sort()[0]!;
  template = JSON.parse(
    fs.readFileSync(path.join(demo, first, "performance-scratch.json"), "utf8"),
  );
  fs.rmSync(demo, { recursive: true, force: true });

  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bench-variants-"));
  for (const night of ["2026-10-01", "2026-10-02"]) {
    write(night, "turbowarp", mode("compiler", "compiler", true), 1);
    write(night, "turbowarp", mode("interpreter", "interpreter", false), 0.1);
  }
  write(
    "2026-10-01",
    "scratch-everywhere",
    mode("interpreter", "interpreter", true),
    0.2,
  );
  write(
    "2026-10-02",
    "scratch-everywhere",
    mode("bytecode", "bytecode VM", true),
    2,
  );
  write(
    "2026-10-02",
    "scratch-everywhere",
    mode("interpreter", "interpreter", false),
    0.2,
  );
  write("2026-10-01", "scratch", null, 1);
  write("2026-10-02", "scratch", null, 1);
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const ids = (o: Record<string, unknown>) => Object.keys(o).sort();

describe("VM modes shown together", () => {
  it("shows each runtime once, in the mode it uses by default at the time", () => {
    const ds = loadDataset(dir);
    const meta = buildMeta(ds);
    expect(meta.runtimes.map((r) => r.id).sort()).toEqual([
      "scratch",
      "scratch-everywhere",
      "turbowarp",
    ]);
    expect(meta.runtimes.find((r) => r.id === "turbowarp")!.name).toBe(
      "TurboWarp",
    );
    expect(meta.hasVariants).toBe(true);
    const scores = buildScores(ds);
    expect(ids(scores.runtimes)).toEqual([
      "scratch",
      "scratch-everywhere",
      "turbowarp",
    ]);
    const se = scores.runtimes["scratch-everywhere"]!.total;
    expect(se[1]!).toBeGreaterThan(se[0]! * 5);
  });

  it("leaves out the non-default modes", () => {
    const ds = loadDataset(dir);
    expect(
      viewOf(ds, false).some((e) =>
        e.runtime.variant && !e.runtime.variant.default
      ),
    ).toBe(false);
    expect(buildLatest(ds).runtimes.map((r) => r.id).sort()).toEqual([
      "scratch",
      "scratch-everywhere",
      "turbowarp",
    ]);
  });
});

describe("VM modes separated", () => {
  it("makes one series per mode, and the mode that is the default now keeps the runtime's id", () => {
    const ds = loadDataset(dir);
    const meta = buildMeta(ds, true);
    expect(meta.runtimes.map((r) => r.id).sort()).toEqual([
      "scratch",
      "scratch-everywhere",
      "scratch-everywhere~interpreter",
      "turbowarp",
      "turbowarp~interpreter",
    ]);
    const byId = Object.fromEntries(meta.runtimes.map((r) => [r.id, r]));
    expect(byId["turbowarp"]!.name).toBe("TurboWarp (compiler)");
    expect(byId["turbowarp~interpreter"]!.name).toBe("TurboWarp (interpreter)");
    expect(byId["turbowarp~interpreter"]!.base).toBe("turbowarp");
    expect(byId["scratch"]!.name).toBe("Scratch");
    expect(byId["scratch-everywhere"]!.name).toBe(
      "Scratch Everywhere! (bytecode VM)",
    );
  });

  it("follows a mode over time even when the default changed", () => {
    const ds = loadDataset(dir);
    const scores = buildScores(ds, { separate: true });
    const interp = scores.runtimes["scratch-everywhere~interpreter"]!.total;
    expect(interp.filter((x) => x != null).length).toBe(2);
    const bytecode = scores.runtimes["scratch-everywhere"]!.total;
    expect(bytecode[0]).toBeNull();
    expect(bytecode[1]).not.toBeNull();
    const tw = scores.runtimes["turbowarp"]!.total[0]!;
    const twInterp = scores.runtimes["turbowarp~interpreter"]!.total[0]!;
    expect(tw / twInterp).toBeCloseTo(10, 1);
  });

  it("carries the setting through latest and history", () => {
    const ds = loadDataset(dir);
    expect(buildLatest(ds, undefined, true).runtimes.map((r) => r.id))
      .toContain("turbowarp~interpreter");
    const h = buildHistory(ds, { separate: true });
    expect(Object.keys(h.runtimes)).toContain("scratch-everywhere~interpreter");
    expect(buildHistory(ds).runtimes["turbowarp~interpreter"]).toBeUndefined();
  });
});

describe("without any VM modes", () => {
  it("reports none, and the setting changes nothing", () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), "bench-plain-"));
    generate(plain, {
      nights: 3,
      end: new Date("2026-09-30T00:00:00Z"),
      seed: 5,
    });
    const ds = loadDataset(plain);
    expect(buildMeta(ds).hasVariants).toBe(false);
    expect(buildMeta(ds, true).runtimes.map((r) => r.id)).toEqual(
      buildMeta(ds).runtimes.map((r) => r.id),
    );
    fs.rmSync(plain, { recursive: true, force: true });
  });
});

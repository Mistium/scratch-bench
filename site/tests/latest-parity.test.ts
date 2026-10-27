import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generate } from "../scripts/demo-results.ts";
import { buildLatest } from "../server/utils/queries.ts";
import { loadDataset } from "../server/utils/results.ts";

let dir: string;

beforeAll(() => {
  const demo = fs.mkdtempSync(path.join(os.tmpdir(), "bench-demo-"));
  generate(demo, { nights: 1, end: new Date("2026-09-30T00:00:00Z"), seed: 3 });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bench-parity-only-"));
  for (const night of fs.readdirSync(demo)) {
    const to = path.join(dir, night);
    fs.mkdirSync(to);
    for (const f of fs.readdirSync(path.join(demo, night))) {
      if (f.startsWith("parity-") || f === "meta.json") {
        fs.copyFileSync(path.join(demo, night, f), path.join(to, f));
      }
    }
  }
  fs.rmSync(demo, { recursive: true, force: true });
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("latest parity", () => {
  it("lists parity results even before any performance result exists", () => {
    const latest = buildLatest(loadDataset(dir));
    expect(latest.runtimes).toEqual([]);
    expect(latest.parity.length).toBeGreaterThan(0);
    for (const p of latest.parity) {
      expect(p.parity.total).toBeGreaterThan(0);
      expect(p.name).toBeTruthy();
    }
  });
});

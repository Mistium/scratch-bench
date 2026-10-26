import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { measureSuite } from "../measure-suite.ts";
import type { Pin, Runtime } from "../runtimes/types.ts";
import { buildLaunch } from "./build.ts";
import { backfill, type Deps, type Options } from "./engine.ts";
import { resetState } from "./state.ts";
import type { Source } from "./source.ts";

let tmp: string;
let results: string;

const fakeRuntime = (
  id: string,
  opts: { failVersion?: string } = {},
): Runtime => ({
  id,
  name: `Fake ${id}`,
  kind: "native",
  setup: async () => ({ version: "x" }),
  history: {
    since: { parity: "2026-10-02" },
    custom: {
      resolve: async (date): Promise<Pin | null> => ({
        parts: [],
        custom: { version: date < "2026-10-04" ? "v1" : "v2" },
      }),
      build: async (pin) => {
        const v = pin.custom!.version!;
        if (v === opts.failVersion) throw new Error(`cannot build ${v}`);
        const passed = v === "v1" ? 8 : 10;
        const line = passed === 10
          ? "[PROJECT] [PASSED] All Tests Were Successful: 10/10 (100%)"
          : `[PROJECT] [FAILED] Some Tests Were Not Successful: ${passed}/10 (80%)`;
        return {
          command: () => ({
            cmd: ["node", "-e", `console.log(${JSON.stringify(line)})`],
          }),
        };
      },
    },
  },
});

const source: Source = {
  gitHead: async () => null,
  npmVersion: async () => null,
};

const deps = (): Deps => ({
  source,
  build: buildLaunch,
  measure: measureSuite,
  suiteBuild: async () => ({ sb3: "unused.sb3", hash: "suitehash" }),
  cleanup: () => {},
  resultsDir: results,
});

const options = (
  runtimes: Runtime[],
  extra: Partial<Options> = {},
): Options => ({
  runtimes,
  suites: ["parity"],
  dates: ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"],
  perfRuns: 1,
  timeoutMs: 30_000,
  displayKind: "x11",
  dryRun: false,
  retryFailed: false,
  concurrency: 2,
  log: () => {},
  ...extra,
});

const read = (date: string, id: string) => {
  const f = path.join(results, `${date}T03-00-00-000Z`, `parity-${id}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
};

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "backfill-"));
  results = path.join(tmp, "results");
  process.env.BENCH_BACKFILL_DIR = path.join(tmp, "state");
  resetState();
});
afterEach(() => {
  delete process.env.BENCH_BACKFILL_DIR;
  resetState();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("the backfill engine, with a runtime it has never heard of", () => {
  test("resolves, builds, runs and writes results for it, sharing one run between dates with the same version", async () => {
    const sum = await backfill(options([fakeRuntime("fake")]), deps());
    expect(sum.unavailable).toBe(1);
    expect(sum.resolved).toBe(4);
    expect(sum.distinct).toBe(2);
    expect(sum.ran).toBe(2);

    expect(read("2026-10-01", "fake")).toBeNull();
    const first = read("2026-10-02", "fake");
    expect(first.schema_version).toBe(1);
    expect(first.suite.id).toBe("parity");
    expect(first.suite.source_hash).toBe("suitehash");
    expect(first.timestamp).toBe("2026-10-02T03:00:00.000Z");
    expect(first.results.passed).toBe(8);
    expect(first.backfill.date).toBe("2026-10-02");
    expect(first.backfill.reused_from).toBeUndefined();
    expect(first.runtime.version).toBe("v1");

    const reused = read("2026-10-03", "fake");
    expect(reused.results.passed).toBe(8);
    expect(reused.backfill.reused_from).toBe("2026-10-02");

    expect(read("2026-10-04", "fake").results.passed).toBe(10);
    expect(read("2026-10-05", "fake").results.verdict).toBe("passed");
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(results, "2026-10-02T03-00-00-000Z", "meta.json"),
          "utf8",
        ),
      ).backfill,
    ).toBe(true);
  });

  test("a second run does no work and changes no files", async () => {
    await backfill(options([fakeRuntime("fake")]), deps());
    const before = fs.statSync(
      path.join(results, "2026-10-04T03-00-00-000Z", "parity-fake.json"),
    ).mtimeMs;
    const sum = await backfill(options([fakeRuntime("fake")]), deps());
    expect(sum.built).toBe(0);
    expect(sum.ran).toBe(0);
    expect(sum.cached).toBe(2);
    expect(sum.written).toBe(0);
    expect(
      fs.statSync(
        path.join(results, "2026-10-04T03-00-00-000Z", "parity-fake.json"),
      ).mtimeMs,
    ).toBe(before);
  });

  test("a later run with more dates fills in only the new ones", async () => {
    await backfill(
      options([fakeRuntime("fake")], { dates: ["2026-10-02", "2026-10-03"] }),
      deps(),
    );
    const sum = await backfill(options([fakeRuntime("fake")]), deps());
    expect(sum.ran).toBe(1);
    expect(read("2026-10-05", "fake")).not.toBeNull();
  });

  test("a newly added runtime is filled in without touching the others", async () => {
    await backfill(options([fakeRuntime("one")]), deps());
    const sum = await backfill(
      options([fakeRuntime("one"), fakeRuntime("two")]),
      deps(),
    );
    expect(sum.ran).toBe(2);
    expect(read("2026-10-04", "two").results.passed).toBe(10);
  });

  test("never overwrites a real nightly result", async () => {
    const dir = path.join(results, "2026-10-03T03-00-00-000Z");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "parity-fake.json"),
      JSON.stringify({ schema_version: 1, real: true }),
    );
    const sum = await backfill(options([fakeRuntime("fake")]), deps());
    expect(sum.keptReal).toBe(1);
    expect(read("2026-10-03", "fake")).toEqual({
      schema_version: 1,
      real: true,
    });
  });

  test("records a failed build as a failed result, and retries it on request", async () => {
    const bad = fakeRuntime("bad", { failVersion: "v2" });
    const sum = await backfill(options([bad]), deps());
    expect(sum.failed).toBe(1);
    const failed = read("2026-10-04", "bad");
    expect(failed.error).toMatch(/build failed: cannot build v2/);
    expect(failed.runs[0].ok).toBe(false);
    expect(read("2026-10-02", "bad").results.passed).toBe(8);

    expect((await backfill(options([bad]), deps())).built).toBe(0);
    const fixed = fakeRuntime("bad");
    const retry = await backfill(
      options([fixed], { retryFailed: true }),
      deps(),
    );
    expect(retry.ran).toBe(1);
    expect(read("2026-10-04", "bad").error).toBeUndefined();
    expect(read("2026-10-04", "bad").results.passed).toBe(10);
  });

  test("--dry-run plans without building, running or writing", async () => {
    const lines: string[] = [];
    await backfill(
      options([fakeRuntime("fake")], {
        dryRun: true,
        log: (l) => lines.push(l),
      }),
      deps(),
    );
    expect(lines.join("\n")).toMatch(/2 distinct versions/);
    expect(fs.existsSync(results)).toBe(false);
  });

  test("--limit does only the newest missing versions", async () => {
    const sum = await backfill(
      options([fakeRuntime("fake")], { limit: 1 }),
      deps(),
    );
    expect(sum.ran).toBe(1);
    expect(read("2026-10-05", "fake")).not.toBeNull();
    expect(read("2026-10-02", "fake")).toBeNull();
  });

  test("a runtime without a history spec is ignored", async () => {
    const plain: Runtime = {
      id: "plain",
      name: "Plain",
      kind: "node",
      setup: async () => ({ version: "x" }),
    };
    const sum = await backfill(options([plain]), deps());
    expect(sum.distinct).toBe(0);
  });
});

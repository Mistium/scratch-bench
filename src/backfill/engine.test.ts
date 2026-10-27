import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { measureSuite } from "../measure-suite.ts";
import type { Pin, Runtime, Variant } from "../runtimes/types.ts";
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

const variantRuntime = (
  id: string,
  modern: (version: string) => boolean = () => true,
): Runtime => {
  const both: Variant[] = [
    { id: "fast", name: "fast", default: true, env: { MODE: "fast" } },
    { id: "slow", name: "slow", default: false, env: { MODE: "slow" } },
  ];
  const onlySlow: Variant[] = [{
    id: "slow",
    name: "slow",
    default: true,
    env: { MODE: "slow" },
  }];
  return {
    id,
    name: `Fake ${id}`,
    kind: "native",
    setup: async () => ({ version: "x" }),
    history: {
      since: { parity: "2026-10-02" },
      variants: async (pin) => (modern(pin.custom!.version!) ? both : onlySlow),
      custom: {
        resolve: async (date): Promise<Pin | null> => ({
          parts: [],
          custom: { version: date < "2026-10-04" ? "v1" : "v2" },
        }),
        build: async () => ({
          command: () => ({
            cmd: [
              "node",
              "-e",
              `const slow=process.env.MODE==="slow";console.log("[PROJECT] [PASSED] All Tests Were Successful: "+(slow?7:10)+"/10 (100%)")`,
            ],
          }),
        }),
      },
    },
  };
};

describe("VM modes", () => {
  test("every mode is run, and written under its own file with the default keeping the plain name", async () => {
    const sum = await backfill(options([variantRuntime("vm")]), deps());
    expect(sum.distinct).toBe(2);
    expect(sum.ran).toBe(4);
    const fast = read("2026-10-04", "vm");
    expect(fast.runtime.variant).toEqual({
      id: "fast",
      name: "fast",
      default: true,
    });
    expect(fast.results.passed).toBe(10);
    const slow = JSON.parse(
      fs.readFileSync(
        path.join(results, "2026-10-04T03-00-00-000Z", "parity-vm@slow.json"),
        "utf8",
      ),
    );
    expect(slow.runtime.variant).toEqual({
      id: "slow",
      name: "slow",
      default: false,
    });
    expect(slow.results.passed).toBe(7);
  });

  test("a version from before a mode existed is run only in the modes it has", async () => {
    const rt = variantRuntime("old", (v) => v === "v2");
    const sum = await backfill(options([rt]), deps());
    expect(sum.ran).toBe(3);
    const old = read("2026-10-02", "old");
    expect(old.runtime.variant).toEqual({
      id: "slow",
      name: "slow",
      default: true,
    });
    expect(old.results.passed).toBe(7);
    expect(
      fs.existsSync(
        path.join(results, "2026-10-02T03-00-00-000Z", "parity-old@slow.json"),
      ),
    ).toBe(false);
    expect(read("2026-10-05", "old").runtime.variant.id).toBe("fast");
  });

  test("a second run does nothing, and a mode added later is the only thing run", async () => {
    await backfill(
      options([variantRuntime("grow", (v) => v === "v1")]),
      deps(),
    );
    const sum = await backfill(options([variantRuntime("grow")]), deps());
    expect(sum.ran).toBe(1);
    expect(sum.built).toBe(1);
    expect((await backfill(options([variantRuntime("grow")]), deps())).ran)
      .toBe(0);
  });

  test("--retry-failed retries only the mode that failed", async () => {
    const rt = variantRuntime("flaky");
    let slowFails = true;
    const base = rt.history!.custom!.build;
    rt.history!.custom!.build = async (pin, suite) => {
      const launch = await base(pin, suite);
      return {
        command: (
          sb3,
        ) => (slowFails
          ? {
            cmd: [
              "node",
              "-e",
              'if(process.env.MODE==="slow")process.exit(3);console.log("[PROJECT] [PASSED] All Tests Were Successful: 10/10 (100%)")',
            ],
          }
          : launch.command(sb3)),
      };
    };
    const first = await backfill(options([rt]), deps());
    expect(first.failed).toBe(2);
    slowFails = false;
    const retry = await backfill(options([rt], { retryFailed: true }), deps());
    expect(retry.ran).toBe(2);
    expect(read("2026-10-04", "flaky").results.passed).toBe(10);
  });
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

  test("a runtime whose lookups fail is skipped and reported, and the others are still done", async () => {
    const broken = fakeRuntime("broken");
    broken.history!.custom!.resolve = async () => {
      throw new Error("HTTP 403: the organization forbids this token");
    };
    const lines: string[] = [];
    const sum = await backfill(options([broken, fakeRuntime("fine")], { log: (l) => lines.push(l) }), deps());
    expect(sum.errors).toBe(1);
    expect(sum.ran).toBe(2); // the healthy runtime's two versions
    expect(read("2026-10-04", "fine")).not.toBeNull();
    expect(read("2026-10-04", "broken")).toBeNull();
    expect(lines.join("\n")).toMatch(/could not plan parity \/ Fake broken, skipping it: HTTP 403/);
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

import os from "node:os";
import { parseArgs } from "node:util";
import { buildSuite } from "../build.ts";
import type { DisplayKind } from "../display.ts";
import { measureSuite } from "../measure-suite.ts";
import { RUNTIMES, selectRuntimes } from "../runtimes/index.ts";
import type { SuiteId } from "../runtimes/types.ts";
import "../cleanup.ts";
import { acquireLock } from "../lock.ts";
import {
  progressDone,
  progressFailed,
  progressStart,
  progressUpdate,
} from "../progress.ts";
import { buildLaunch } from "./build.ts";
import { backfill } from "./engine.ts";
import { everySchedule, fadingSchedule, monthlySchedule, schedule } from "./schedule.ts";
import { realSource } from "./source.ts";

const FINISHED_WITH_FAILURES = 3;

const USAGE = `usage: bun run backfill [options]

Runs the current parity and performance projects on the version of each runtime that was current on each date, and
writes the results into results/ (never over real nightly results). Resumable: finished work is skipped.

  --suite a,b          parity, performance (default: both)
  --runtime a,b        runtimes to fill in (default: every runtime that has a history spec)
  --from YYYY-MM-DD    first date (default: the start of the schedule)
  --to YYYY-MM-DD      last date (default: today)
  --perf-runs N        runs per version for the performance suite (default 3; the nightly uses 10)
  --min-runs N         stop a performance version early after N runs when results settle
  --target-rsd PCT     settle threshold, as a percent of the mean (default 4)
  --timeout S          seconds before a run is killed (default 300)
  --parity-timeout S   seconds before a parity run is killed (default 180; a normal run takes seconds)
  --display x11|wayland
  (default: from the earliest date any runtime goes back to (or --from) to today, steadily less detailed the further back: each gap is 12% of
   the date's age, at least a week, so weekly near today and months apart years back)
  --monthly            only the 1st of every month, plus today
  --every N            one checkpoint every N days instead, counted back from today (or --to) to --from
  --weekly             same as --every 7
  --tiered             daily for 60 days, then weekly, every two weeks, and monthly further back
  --no-variants        only run each version in its default VM mode
  --limit N            only do the newest N missing versions (to try things out)
  --jobs N             performance versions to build and measure at once (default 1; >1 is faster but noisier)
  --build-ahead N      build the next N performance versions while others are measured (default 0)
                       BENCH_MEASURE_CPUS="0,6;1,7" gives each of the --jobs measuring workers its own cores, and
                       BENCH_BUILD_CPUS="2-5,8-11" keeps builds on the others once performance runs start
  --parity-jobs N      parity versions to build and check at once, before any performance runs (default: a third of
                       the CPU threads, and at most one per 4 GB of memory)
                       Each version is built, run, then its build deleted, so disk use stays at a few builds.
  --retry-failed       build and run failed versions again
  --redo               measure the selected versions again and replace their results
                       (e.g. --redo --runtime mistwarp --from 2026-10-27 --to 2026-10-27)
  --dry-run            show what would be done and exit

Exit status: 0 on success, 3 when it finished but some versions failed, 1 when the command itself failed.
`;

const { values: o } = parseArgs({
  options: {
    suite: { type: "string" },
    runtime: { type: "string" },
    from: { type: "string" },
    to: { type: "string" },
    "perf-runs": { type: "string", default: "3" },
    "min-runs": { type: "string" },
    "target-rsd": { type: "string" },
    timeout: { type: "string", default: "300" },
    "parity-timeout": { type: "string", default: "180" },
    display: { type: "string", default: "x11" },
    every: { type: "string" },
    weekly: { type: "boolean", default: false },
    tiered: { type: "boolean", default: false },
    monthly: { type: "boolean", default: false },
    "no-variants": { type: "boolean", default: false },
    limit: { type: "string" },
    jobs: { type: "string", default: "1" },
    "build-ahead": { type: "string", default: "0" },
    "parity-jobs": {
      type: "string",
      // Each parity job is a full webpack build plus a browser, about 3-4 GB at peak, so memory caps it too: six at
      // once on a 15 GB machine made it stop responding.
      default: String(Math.max(
        1,
        Math.min(
          Math.floor(os.availableParallelism() / 3),
          Math.floor(os.totalmem() / 4 / 1024 ** 3),
        ),
      )),
    },
    "retry-failed": { type: "boolean", default: false },
    redo: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (o.help) {
  console.log(USAGE);
  process.exit(0);
}

const log = (line: string) => console.log(line);
const split = (s?: string) =>
  s?.split(",").map((x) => x.trim()).filter(Boolean);
const int = (s: string | undefined, name: string) => {
  if (s === undefined) return undefined;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return n;
};

const percent = (s: string | undefined, name: string) => {
  if (s === undefined) return undefined;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`--${name} must be a non-negative percentage`);
  }
  return n / 100;
};

// Read once and cleared: the engine sets it again when performance runs start, so parity builds use every core.
const buildCpus = process.env.BENCH_BUILD_CPUS;
delete process.env.BENCH_BUILD_CPUS;

const main = async () => {
  const today = new Date().toISOString().slice(0, 10);
  const wanted = split(o.runtime) ? selectRuntimes(split(o.runtime)) : RUNTIMES;
  const runtimes = wanted.filter((r) => r.history);
  const tiered = schedule(today);
  // By default the history goes back as far as any selected runtime's does (TurboWarp's fork, in June 2020).
  const earliest = runtimes.flatMap((r) => Object.values(r.history!.since)).filter(Boolean).sort()[0] ??
    tiered[0]!;
  const from = o.from ?? (o.monthly || o.every || o.weekly ? tiered[0]! : earliest);
  const to = o.to ?? today;
  const every = o.weekly ? 7 : int(o.every, "every");
  let dates = o.tiered
    ? tiered
    : every
    ? everySchedule(from, to, every)
    : o.monthly
    ? monthlySchedule(from, to)
    : fadingSchedule(from, to);
  if (o.tiered) {
    if (o.from) dates = dates.filter((d) => d >= o.from!);
    if (o.to) dates = dates.filter((d) => d <= o.to!);
  }
  if (!dates.length) throw new Error("no dates in that range");

  const suites = (split(o.suite) ?? ["parity", "performance"]) as SuiteId[];
  for (const s of suites) {
    if (s !== "parity" && s !== "performance") {
      throw new Error(`unknown suite "${s}"`);
    }
  }

  for (const r of wanted) {
    if (!r.history) log(`skipping ${r.name}: it has no history spec`);
  }

  if (!o["dry-run"] && !acquireLock()) {
    throw new Error(
      "another benchmark job is running (see .bench.lock in the results directory); try again when it finishes",
    );
  }

  if (!o["dry-run"]) {
    progressStart({
      phase: "planning",
      total: dates.length,
      detail: `planning ${dates.length} checkpoints`,
    });
  }

  log(
    `${runtimes.map((r) => r.name).join(", ")} on ${dates.length} dates (${
      dates[0]
    } to ${dates.at(-1)})`,
  );
  const summary = await backfill(
    {
      runtimes,
      suites,
      dates,
      perfRuns: int(o["perf-runs"], "perf-runs")!,
      minRuns: int(o["min-runs"], "min-runs"),
      targetRsd: percent(o["target-rsd"], "target-rsd"),
      timeoutMs: int(o.timeout, "timeout")! * 1000,
      parityTimeoutMs: int(o["parity-timeout"], "parity-timeout")! * 1000,
      displayKind: o.display as DisplayKind,
      limit: int(o.limit, "limit"),
      dryRun: o["dry-run"]!,
      retryFailed: o["retry-failed"]!,
      redo: o.redo!,
      variants: !o["no-variants"],
      jobs: int(o.jobs, "jobs"),
      parityJobs: int(o["parity-jobs"], "parity-jobs"),
      buildAhead: o["build-ahead"] === "0" ? 0 : int(o["build-ahead"], "build-ahead"),
      measureCpus: process.env.BENCH_MEASURE_CPUS?.split(";").filter(Boolean),
      buildCpus: buildCpus,
      progress: o["dry-run"] ? undefined : progressUpdate,
      log,
    },
    {
      source: realSource,
      build: buildLaunch,
      measure: measureSuite,
      suiteBuild: (suite) => buildSuite(suite),
    },
  );
  log(`\n${JSON.stringify(summary)}`);
  if (!o["dry-run"]) {
    progressDone({
      detail: `${summary.written} results written, ${summary.failed} failed`,
    });
  }
  if (summary.errors > 0) return 1;
  return summary.failed > 0 ? FINISHED_WITH_FAILURES : 0;
};

main().then(
  (code) => process.exit(code),
  (e) => {
    const message = e instanceof Error ? e.message : String(e);
    progressFailed(message);
    console.error(message);
    process.exit(1);
  },
);

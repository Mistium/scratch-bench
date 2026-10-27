import { parseArgs } from "node:util";
import { buildSuite } from "../build.ts";
import type { DisplayKind } from "../display.ts";
import { measureSuite } from "../measure-suite.ts";
import { RUNTIMES, selectRuntimes } from "../runtimes/index.ts";
import type { SuiteId } from "../runtimes/types.ts";
import "../cleanup.ts";
import { acquireLock } from "../lock.ts";
import { buildLaunch } from "./build.ts";
import { backfill } from "./engine.ts";
import { schedule } from "./schedule.ts";
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
  --timeout S          seconds before a run is killed (default 300)
  --display x11|wayland
  --limit N            only do the newest N missing versions (to try things out)
  --concurrency N      builds in parallel (default 3; runs are always one at a time)
  --retry-failed       build and run failed versions again
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
    timeout: { type: "string", default: "300" },
    display: { type: "string", default: "x11" },
    limit: { type: "string" },
    concurrency: { type: "string", default: "3" },
    "retry-failed": { type: "boolean", default: false },
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

const main = async () => {
  const today = new Date().toISOString().slice(0, 10);
  let dates = schedule(today);
  if (o.from) dates = dates.filter((d) => d >= o.from!);
  if (o.to) dates = dates.filter((d) => d <= o.to!);
  if (!dates.length) throw new Error("no dates in that range");

  const suites = (split(o.suite) ?? ["parity", "performance"]) as SuiteId[];
  for (const s of suites) {
    if (s !== "parity" && s !== "performance") {
      throw new Error(`unknown suite "${s}"`);
    }
  }

  const wanted = split(o.runtime) ? selectRuntimes(split(o.runtime)) : RUNTIMES;
  const runtimes = wanted.filter((r) => r.history);
  for (const r of wanted) {
    if (!r.history) log(`skipping ${r.name}: it has no history spec`);
  }

  if (!o["dry-run"] && !acquireLock()) {
    throw new Error(
      "another benchmark job is running (see .bench.lock in the results directory); try again when it finishes",
    );
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
      timeoutMs: int(o.timeout, "timeout")! * 1000,
      displayKind: o.display as DisplayKind,
      limit: int(o.limit, "limit"),
      dryRun: o["dry-run"]!,
      retryFailed: o["retry-failed"]!,
      concurrency: int(o.concurrency, "concurrency")!,
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
  if (summary.errors > 0) return 1;
  return summary.failed > 0 ? FINISHED_WITH_FAILURES : 0;
};

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);

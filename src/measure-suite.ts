import { type DisplayKind, startDisplay } from "./display.ts";
import { runOnce, type RunResult } from "./measure.ts";
import type { SuiteResult } from "./report.ts";
import type { Command, Launcher, Variant } from "./runtimes/types.ts";
import { withVariant } from "./variants.ts";
import { summarize } from "./stats.ts";
import type { Suite } from "./suites.ts";

export interface MeasureOptions {
  runs: number;
  timeoutMs: number;
  displayKind: DisplayKind;
  variant?: Variant | null;
  /** CPUs (taskset list, e.g. "0,6") to pin the measured process to. Defaults to BENCH_MEASURE_CPUS. */
  cpus?: string;
  /** Stop early once at least this many runs have completed. */
  minRuns?: number;
  /** Stop early when the run time's relative standard deviation is at most this (0.03 = 3%). */
  targetRsd?: number;
  onRun?: (run: number, total: number, ok: boolean) => void;
  log?: (line: string) => void;
}

export interface Measured {
  runs: SuiteResult["runs"];
  stats: SuiteResult["stats"];
  results: unknown;
  display: string | null;
}

export type LaunchLike = Pick<Launcher, "display"> & {
  command(sb3: string, variant?: Variant | null): Command;
};

export const measureSuite = async (
  suite: Suite,
  launcher: LaunchLike,
  sb3: string,
  o: MeasureOptions,
): Promise<Measured> => {
  const log = o.log ?? (() => {});
  const runs: SuiteResult["runs"] = [];
  const datas: unknown[] = [];
  let displayName: string | null = null;
  const minRuns = Math.max(1, Math.min(o.minRuns ?? Math.min(3, o.runs), o.runs));
  const targetRsd = o.targetRsd ?? 0.04;
  let completed = 0;
  o.variant?.prepare?.(sb3);

  for (let i = 1; i <= o.runs; i++) {
    let run: RunResult;
    let display = null;
    try {
      let command = withVariant(launcher.command(sb3, o.variant), o.variant);
      // Keep the measured process on its own cores, so builds running elsewhere do not disturb its timings.
      const cpus = o.cpus ?? process.env.BENCH_MEASURE_CPUS?.split(";")[0];
      if (cpus) command = { ...command, cmd: ["taskset", "-c", cpus, ...command.cmd] };
      if (launcher.display) {
        display = await startDisplay(o.displayKind);
        displayName = display.backend;
        command = display.wrap(command);
      }
      run = await runOnce(command, suite, o.timeoutMs);
    } catch (e) {
      run = {
        ok: false,
        error: (e as Error).message,
        startup_ms: null,
        run_ms: null,
        wall_ms: null,
        peak_rss_mb: null,
        lines: [],
        exit_code: null,
      };
    } finally {
      await display?.stop();
    }
    // A run that stopped early may still have reported something worth keeping (parity: the groups that ran).
    let data = run.ok ? suite.parse(run.lines) : undefined;
    if (!run.ok && suite.partial) {
      const part = suite.partial(run.lines);
      if (part !== undefined) {
        log(`  run ${i}: stopped early (${run.error}); keeping its partial result`);
        data = part;
        run = { ...run, ok: true };
      }
    }
    if (data !== undefined) datas.push(data);
    runs.push({
      ok: run.ok,
      error: run.error,
      startup_ms: run.startup_ms,
      run_ms: run.run_ms,
      wall_ms: run.wall_ms,
      peak_rss_mb: run.peak_rss_mb,
      data,
      tail: run.ok ? undefined : run.lines.slice(-30),
    });
    log(
      run.ok
        ? `  run ${i}/${o.runs}: startup ${run.startup_ms} ms, run ${run.run_ms} ms, peak ${run.peak_rss_mb} MB`
        : `  run ${i}/${o.runs}: FAILED ${run.error}`,
    );
    o.onRun?.(i, o.runs, run.ok);
    if (run.ok) completed++;
    // A run that hit the timeout will almost certainly hit it again, so stop there instead of spending another
    // timeout on each remaining run; what completed so far still counts.
    if (!run.ok && /^timed out/.test(run.error ?? "")) {
      if (i < o.runs) log(`  stopping after a timeout`);
      break;
    }

    if (i < o.runs && completed >= minRuns) {
      const settled = summarize(
        runs.filter((r) => r.ok).map((r) => r.run_ms!).filter((x) =>
          x !== null
        ),
      );
      const rsd = settled && settled.mean > 0
        ? settled.stddev / settled.mean
        : Infinity;
      if (rsd <= targetRsd) {
        log(
          `  converged after ${i} run${i > 1 ? "s" : ""} (rsd ${
            (rsd * 100).toFixed(1)
          }%)`,
        );
        break;
      }
    }
  }

  const ok = runs.filter((r) => r.ok);
  const stats: SuiteResult["stats"] = {};
  for (
    const metric of ["startup_ms", "run_ms", "wall_ms", "peak_rss_mb"] as const
  ) {
    stats[metric] = summarize(
      ok.map((r) => r[metric]!).filter((x) => x !== null),
    );
  }

  let results: unknown = null;
  if (suite.id === "performance") {
    const perRun = datas as Record<
      string,
      { ops_per_ms: number; total_ms: number }
    >[];
    const ids = [...new Set(perRun.flatMap((d) => Object.keys(d)))];
    results = Object.fromEntries(
      ids.map((id) => [
        id,
        {
          ops_per_ms: summarize(
            perRun.map((d) => d[id]?.ops_per_ms).filter((x) => x !== undefined),
          ),
          total_ms: summarize(
            perRun.map((d) => d[id]?.total_ms).filter((x) => x !== undefined),
          ),
        },
      ]),
    );
  } else if (datas.length) {
    results = datas[datas.length - 1];
  }
  return { runs, stats, results, display: displayName };
};

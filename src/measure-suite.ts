import { type DisplayKind, startDisplay } from "./display.ts";
import { runOnce, type RunResult } from "./measure.ts";
import type { SuiteResult } from "./report.ts";
import type { Command, Launcher, Variant } from "./runtimes/types.ts";
import { withVariant } from "./variants.ts";
import { summarize } from "./stats.ts";
import type { ProjectRun, Suite } from "./suites.ts";

export interface MeasureOptions {
  runs: number;
  timeoutMs: number;
  displayKind: DisplayKind;
  variant?: Variant | null;
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
  o.variant?.prepare?.(sb3);

  for (let i = 1; i <= o.runs; i++) {
    let run: RunResult;
    let display = null;
    try {
      let command = withVariant(launcher.command(sb3, o.variant), o.variant);
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
    const data = run.ok ? suite.parse(run.lines) : undefined;
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
  }

  const stats = statsOf(runs);

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
  } else if (suite.id === "projects") {
    results = combineReplays(
      (datas as Record<string, ProjectRun>[]).flatMap((d) => Object.values(d)),
      runs.find((r) => r.error)?.error,
    );
    if (!("error" in (results as object))) (results as Record<string, unknown>).load_ms = stats.startup_ms;
  } else if (datas.length) {
    results = datas[datas.length - 1];
  }
  return { runs, stats, results, display: displayName };
};

export const statsOf = (runs: SuiteResult["runs"]): SuiteResult["stats"] => {
  const ok = runs.filter((r) => r.ok);
  const stats: SuiteResult["stats"] = {};
  for (
    const metric of ["startup_ms", "run_ms", "wall_ms", "peak_rss_mb"] as const
  ) {
    stats[metric] = summarize(
      ok.map((r) => r[metric]!).filter((x) => x !== null),
    );
  }
  return stats;
};

/**
 * One project's replays, combined: times as medians; the checkpoints every run reached, each its
 * median (so another runtime is compared on frames all of them got through); the fewest frames, the
 * most drift, and the hash only if every run agrees ("mixed" otherwise: not deterministic). A run
 * that failed fails the project, since its other runs may not have done the same work.
 */
export const combineReplays = (all: ProjectRun[], runError?: string): unknown => {
  const ran = all.filter((r) => !("error" in r)) as Extract<ProjectRun, { hash: string }>[];
  if (!ran.length || ran.length !== all.length) {
    return all.find((r) => "error" in r) ?? { error: runError ?? "no result" };
  }
  const median = (xs: number[]) => summarize(xs)!.median;
  const shared = Object.keys(ran[0].checkpoints).filter((f) => ran.every((r) => f in r.checkpoints));
  return {
    recorded_frames: ran[0].recorded_frames,
    frames: Math.min(...ran.map((r) => r.frames)),
    drifted: Math.max(...ran.map((r) => r.drifted)),
    hash: ran.every((r) => r.hash === ran[0].hash) ? ran[0].hash : "mixed",
    checkpoints: Object.fromEntries(shared.map((f) => [f, median(ran.map((r) => r.checkpoints[Number(f)]))])),
    script_ms: summarize(ran.map((r) => r.script_ms)),
    draw_ms: summarize(ran.map((r) => r.draw_ms)),
    wall_ms: summarize(ran.map((r) => r.wall_ms)),
  };
};

import path from "node:path";
import { ROOT } from "./paths.ts";

export interface PerfRecord {
  total_ms: number;
  ops: number;
  ops_per_ms: number;
  best_ops_per_ms: number;
  checksum: string;
}

export interface ParityData {
  verdict: "passed" | "failed" | "unknown";
  passed: number | null;
  total: number | null;
  failed_groups: {
    name: string;
    passed: number;
    total: number;
    failures: string[];
  }[];
}

/** One recorded project replayed (see src/bake.ts). */
export type ProjectRun =
  | {
    /** Real time the replay took. */
    ms: number;
    /** Real time the recording took; a runtime that keeps up takes about this long. */
    recorded_ms: number;
    /** Scheduler ticks replayed, of the recording's; fewer when it ran out of time. */
    ticks: number;
    recorded_ticks: number;
    /** The longest gap between two ticks: the worst frame. */
    worst_ms: number;
    /** Gaps between ticks longer than 50 ms: frames that couldn't keep up. */
    long_frames: number;
    /** From starting the runtime to the replay starting. */
    load_ms?: number;
  }
  | { error: string };

export interface Suite<T = unknown> {
  id: "performance" | "parity" | "projects";
  source: string;
  launcher: "headless" | "gui";
  runs: number;
  isDone(line: string): boolean;
  parse(lines: string[]): T;
  /** Run with the other launcher when a runtime doesn't have this one. */
  anyLauncher?: boolean;
  /** Run each runtime in its default mode only, not every variant. */
  defaultVariantOnly?: boolean;
}

const PERF_LINE =
  /^(\S+) \| ([\d.\-e+]+) \| ([\d.\-e+]+) \| ([\d.\-e+]+) \| ([\d.\-e+]+) \| (.*)$/;

export const performance: Suite<Record<string, PerfRecord>> = {
  id: "performance",
  source: "performance/project",
  launcher: "headless",
  runs: 10,
  isDone: (line) => line === "DONE",
  parse(lines) {
    const out: Record<string, PerfRecord> = {};
    for (const line of lines) {
      const m = PERF_LINE.exec(line);
      if (!m || m[1] === "id") continue;
      out[m[1]] = {
        total_ms: Number(m[2]),
        ops: Number(m[3]),
        ops_per_ms: Number(m[4]),
        best_ops_per_ms: Number(m[5]),
        checksum: m[6],
      };
    }
    return out;
  },
};

const PARITY_VERDICT = /Tests Were (Not )?Successful: (\d+)\/(\d+)/;

export const parity: Suite<ParityData> = {
  id: "parity",
  source: "parity/project",
  launcher: "gui",
  runs: 1,
  isDone: (line) => /Tests Were (Not )?Successful/.test(line),
  parse(lines) {
    const data: ParityData = {
      verdict: "unknown",
      passed: null,
      total: null,
      failed_groups: [],
    };
    for (const line of lines) {
      const v = PARITY_VERDICT.exec(line);
      if (v) {
        data.verdict = v[1] ? "failed" : "passed";
        data.passed = Number(v[2]);
        data.total = Number(v[3]);
      }
      const f = /^\[FAILED\] (.+?): (\d+)\/(\d+) /.exec(line);
      if (f && !v) {
        data.failed_groups.push({
          name: f[1],
          passed: Number(f[2]),
          total: Number(f[3]),
          failures: [],
        });
      }
      // "┣ Test 3 Failed: <what it checks> | got <what the runtime produced>" under its group
      const t = /^[┣┗] (.+)$/.exec(line);
      if (t) data.failed_groups.at(-1)?.failures.push(t[1]);
    }
    return data;
  },
};

const PROJECT_LINE = /^(\d+) \| ([\d.]+) \| (\d+)\/(\d+) \| ([\d.]+) \| (\d+) \| (\d+)$/;

/** Real projects replaying recorded play, baked into each project (src/bake.ts). One sb3 per run. */
export const projects: Suite<Record<string, ProjectRun>> = {
  id: "projects",
  source: "projects",
  launcher: "gui",
  anyLauncher: true,
  // Each project plays in real time, so every variant would add minutes to the nightly run.
  defaultVariantOnly: true,
  runs: 1,
  isDone: (line) => line === "DONE",
  parse(lines) {
    const out: Record<string, ProjectRun> = {};
    for (const line of lines) {
      const m = PROJECT_LINE.exec(line);
      if (!m) continue;
      out[m[1]] = {
        ms: Number(m[2]),
        ticks: Number(m[3]),
        recorded_ticks: Number(m[4]),
        worst_ms: Number(m[5]),
        long_frames: Number(m[6]),
        recorded_ms: Number(m[7]),
      };
    }
    return out;
  },
};

/** The suites run when none are named. */
export const SUITES = [performance, parity, projects] as Suite<any>[];

export const selectSuites = (ids: string[] | undefined): Suite<any>[] => {
  if (!ids) return SUITES;
  return ids.map((id) => {
    const s = SUITES.find((x) => x.id === id);
    if (!s) {
      throw new Error(
        `unknown suite "${id}" (known: ${SUITES.map((x) => x.id).join(", ")})`,
      );
    }
    return s;
  });
};

export const suiteSourceDir = (s: Suite) => path.join(ROOT, s.source);

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

/** One recorded project replayed (see runtimes/chromium/index.html `replay`). */
export type ProjectRun =
  | {
    /** The runtime's own work: handling the inputs and stepping the frames. */
    script_ms: number;
    /** Drawing, and waiting for the GPU to finish each frame. */
    draw_ms: number;
    /** Real time the replay took, frames back to back. */
    wall_ms: number;
    /** Frames replayed, of the recording's; fewer when it ran out of time. */
    frames: number;
    recorded_frames: number;
    /** Frames that made a different number of passes than recorded. */
    drifted: number;
    /** A hash of the project's state through the replay: a runtime that computes something else differs. */
    hash: string;
    /**
     * Script time so far at set frames (1, 2, 3, 5, 8, ... and the last), to compare runtimes on
     * exactly the frames both got through.
     */
    checkpoints: Record<number, number>;
  }
  | { error: string };

export interface Suite<T = unknown> {
  id: "performance" | "parity" | "projects";
  source: string;
  launcher: "headless" | "gui";
  runs: number;
  isDone(line: string): boolean;
  parse(lines: string[]): T;
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

const PROJECT_LINE =
  /^(\d+) \| ([\d.]+) \| ([\d.]+) \| ([\d.]+) \| (\d+)\/(\d+) \| (\d+) \| ([0-9a-f]+) \| ([\d.:,]*)$/;

/**
 * Real projects, each replaying a recording of someone using it, frame by frame and the same in
 * every runtime, the way TurboWarp's pianola benchmark does. One project per run of the runtime.
 */
export const projects: Suite<Record<string, ProjectRun>> = {
  id: "projects",
  source: "projects",
  launcher: "gui",
  // Only runtimes whose launcher can replay (projects/REPLAY.md) run it.
  defaultVariantOnly: true,
  runs: 1,
  isDone: (line) => line === "DONE",
  parse(lines) {
    const out: Record<string, ProjectRun> = {};
    for (const line of lines) {
      const m = PROJECT_LINE.exec(line);
      if (m) {
        out[m[1]] = {
          script_ms: Number(m[2]),
          draw_ms: Number(m[3]),
          wall_ms: Number(m[4]),
          frames: Number(m[5]),
          recorded_frames: Number(m[6]),
          drifted: Number(m[7]),
          hash: m[8],
          checkpoints: Object.fromEntries(
            m[9].split(",").filter(Boolean).map((c) => c.split(":").map(Number) as [number, number]),
          ),
        };
        continue;
      }
      const e = /^(\d+) \| error \| (.*)$/.exec(line);
      if (e) out[e[1]] = { error: e[2] };
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

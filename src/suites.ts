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
  failed_groups: { name: string; passed: number; total: number }[];
}

export interface Suite<T = unknown> {
  id: "performance" | "parity";
  source: string;
  launcher: "headless" | "gui";
  runs: number;
  isDone(line: string): boolean;
  parse(lines: string[]): T;
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
      if (f) {
        data.failed_groups.push({
          name: f[1],
          passed: Number(f[2]),
          total: Number(f[3]),
        });
      }
    }
    return data;
  },
};

export const SUITES = [performance, parity] as Suite<any>[];

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

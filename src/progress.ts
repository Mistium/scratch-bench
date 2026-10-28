import fs from "node:fs";
import path from "node:path";
import { RESULTS_DIR } from "./paths.ts";

export type ProgressPhase =
  | "planning"
  | "building"
  | "running"
  | "done"
  | "failed";

/** One parallel worker, or one build running ahead of the workers. */
export interface WorkerProgress {
  id: string;
  state: "building" | "waiting for build" | "running";
  label?: string;
  /** CPUs the measured process is pinned to. */
  cpus?: string;
  detail?: string;
  /** When it entered this state for this label. */
  since: string;
}

export interface BenchProgress {
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  phase: ProgressPhase;
  label?: string;
  suite?: string;
  runtime?: string;
  index?: number;
  total?: number;
  detail?: string;
  error?: string;
  workers?: WorkerProgress[];
}

const file = () => path.join(RESULTS_DIR, ".bench-progress.json");
let current: BenchProgress | null = null;

const write = (p: BenchProgress) => {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  const tmp = `${file()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(p, null, 2) + "\n");
  fs.renameSync(tmp, file());
};

export const progressStart = (patch: Partial<BenchProgress> = {}) => {
  const now = new Date().toISOString();
  current = {
    startedAt: now,
    updatedAt: now,
    phase: "planning",
    ...patch,
  };
  write(current);
};

export const progressUpdate = (patch: Partial<BenchProgress>) => {
  if (!current) progressStart(patch);
  else {
    current = { ...current, ...patch, updatedAt: new Date().toISOString() };
    write(current);
  }
  return current;
};

export const progressDone = (patch: Partial<BenchProgress> = {}) =>
  progressUpdate({
    phase: "done",
    finishedAt: new Date().toISOString(),
    detail: undefined,
    ...patch,
  });

export const progressFailed = (error: string) =>
  progressUpdate({
    phase: "failed",
    finishedAt: new Date().toISOString(),
    error: error.slice(0, 500),
  });

export const readProgress = (dir = RESULTS_DIR): BenchProgress | null => {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(dir, ".bench-progress.json"), "utf8"),
    ) as BenchProgress;
  } catch {
    return null;
  }
};

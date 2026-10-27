import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Cron } from "croner";
import type { BenchStatus } from "../../shared/types.ts";
import { repoDir, resultsDir } from "./paths.ts";

const LOCK = ".bench.lock";
const STATUS = ".bench-status.json";
const LOG = "bench-last.log";

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

interface Lock {
  pid: number;
  startedAt: string;
}

const readJson = <T>(file: string): T | null => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
};

const heldLock = (dir: string): Lock | null => {
  const file = path.join(dir, LOCK);
  const lock = readJson<Lock>(file);
  if (!lock) return null;
  if (alive(lock.pid)) return lock;
  fs.rmSync(file, { force: true });
  return null;
};

export const benchStatus = (schedule: string | null): BenchStatus => {
  const dir = resultsDir();
  const lock = heldLock(dir);
  let nextRun: string | null = null;
  if (schedule) {
    try {
      nextRun = new Cron(schedule).nextRun()?.toISOString() ?? null;
    } catch {}
  }
  return {
    running: lock !== null,
    startedAt: lock?.startedAt ?? null,
    lastRun: readJson<BenchStatus["lastRun"]>(path.join(dir, STATUS)),
    nextRun,
    schedule,
  };
};

export type StartResult = { started: true; outDir: string } | {
  started: false;
  reason: string;
};

const command =
  (): string[] => (process.env.BENCH_COMMAND?.trim()
    ? process.env.BENCH_COMMAND.trim().split(/\s+/)
    : ["bun", "src/cli.ts"]);

export const startBenchRun = (
  trigger: "schedule" | "manual",
  extraArgs: string[] = [],
): StartResult => {
  const dir = resultsDir();
  fs.mkdirSync(dir, { recursive: true });
  if (heldLock(dir)) {
    return { started: false, reason: "a benchmark run is already in progress" };
  }

  const startedAt = new Date().toISOString();
  const outDir = path.join(dir, startedAt.replace(/[:.]/g, "-"));
  const [bin = "bun", ...base] = command();
  const log = fs.openSync(path.join(dir, LOG), "w");
  fs.writeSync(
    log,
    `[${startedAt}] ${trigger} run: ${
      [bin, ...base, "--out", outDir, ...extraArgs].join(" ")
    }\n`,
  );

  const child = spawn(bin, [...base, "--out", outDir, ...extraArgs], {
    cwd: repoDir(),
    stdio: ["ignore", log, log],
    env: process.env,
  });
  if (child.pid) {
    fs.writeFileSync(
      path.join(dir, LOCK),
      JSON.stringify({ pid: child.pid, startedAt } satisfies Lock),
    );
  }

  const timeoutMs = Number(process.env.BENCH_TIMEOUT_MIN ?? 180) * 60_000;
  const timer = setTimeout(() => {
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 15_000).unref();
  }, timeoutMs);

  const finish = (ok: boolean, message: string) => {
    clearTimeout(timer);
    fs.rmSync(path.join(dir, LOCK), { force: true });
    try {
      fs.closeSync(log);
    } catch {}
    const finishedAt = new Date().toISOString();
    fs.writeFileSync(
      path.join(dir, STATUS),
      JSON.stringify({
        startedAt,
        finishedAt,
        ok,
        message,
        durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
      }),
    );
  };
  child.on("error", (e) => finish(false, `could not start: ${e.message}`));
  child.on(
    "exit",
    (code, signal) =>
      finish(
        code === 0,
        signal
          ? `stopped by ${signal}`
          : code === 0
          ? "completed"
          : `finished with exit code ${code} (some suites failed; see ${LOG})`,
      ),
  );
  return { started: true, outDir };
};

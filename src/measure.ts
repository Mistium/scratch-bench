import fs from "node:fs";
import { onCleanup } from "./cleanup.ts";
import type { Command } from "./runtimes/types.ts";
import type { Suite } from "./suites.ts";

export interface RunResult {
  ok: boolean;
  error?: string;
  startup_ms: number | null;
  run_ms: number | null;
  wall_ms: number | null;
  peak_rss_mb: number | null;
  lines: string[];
  exit_code: number | null;
}

const ANSI = /\x1b\[[0-9;]*m/g;
const PROJECT_LINE = /\[PROJECT\] (.*)$/;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const childrenOf = (pid: number): number[] => {
  try {
    const out = Bun.spawnSync(["pgrep", "-P", String(pid)], {
      stdout: "pipe",
      stderr: "ignore",
    });
    return out.stdout.toString().split("\n").filter(Boolean).map(Number);
  } catch {
    return [];
  }
};

const descendantsOf = (pid: number): number[] =>
  childrenOf(pid).flatMap((c) => [c, ...descendantsOf(c)]);

/** A run whose biggest process grows past this is stopped before it takes the machine with it. */
const MEMORY_LIMIT_MB = Number(process.env.BENCH_MEMORY_LIMIT_MB) || 6144;

/** The largest resident memory of `pid` and its descendants, read from /proc (Linux only). */
const largestRssMb = (pid: number): number => {
  const parent = new Map<number, number>();
  const rss = new Map<number, number>();
  for (const entry of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const status = fs.readFileSync(`/proc/${entry}/status`, "utf8");
      parent.set(Number(entry), Number(/PPid:\s+(\d+)/.exec(status)?.[1]));
      rss.set(Number(entry), Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? 0) / 1024);
    } catch {}
  }
  const inTree = (p: number): boolean => {
    for (let at = p, hops = 0; at > 1 && hops < 64; at = parent.get(at) ?? 0, hops++) {
      if (at === pid) return true;
    }
    return false;
  };
  let largest = 0;
  for (const [p, mb] of rss) if (mb > largest && inTree(p)) largest = mb;
  return largest;
};

const killGroup = (pid: number, signal: NodeJS.Signals) => {
  for (const p of descendantsOf(pid).reverse()) {
    try {
      process.kill(p, signal);
    } catch {}
  }
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {}
  }
};

export const runOnce = async (
  command: Command,
  suite: Suite,
  timeoutMs: number,
): Promise<RunResult> => {
  const result: RunResult = {
    ok: false,
    startup_ms: null,
    run_ms: null,
    wall_ms: null,
    peak_rss_mb: null,
    lines: [],
    exit_code: null,
  };
  const start = performance.now();
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(command.cmd, {
      cwd: command.cwd,
      env: command.env ?? (process.env as Record<string, string>),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      detached: true,
    });
  } catch (e) {
    result.error = `could not start: ${(e as Error).message}`;
    return result;
  }

  const unregister = onCleanup(() => killGroup(proc.pid, "SIGKILL"));
  let stderrTail = "";
  void (async () => {
    for await (const chunk of proc.stderr as ReadableStream<Uint8Array>) {
      stderrTail = (stderrTail + new TextDecoder().decode(chunk)).slice(-2000);
    }
  })();

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killGroup(proc.pid, "SIGKILL");
  }, timeoutMs);
  let outOfMemory = false;
  const memoryWatch = process.platform === "linux"
    ? setInterval(() => {
      if (largestRssMb(proc.pid) > MEMORY_LIMIT_MB) {
        outOfMemory = true;
        killGroup(proc.pid, "SIGKILL");
      }
    }, 1000)
    : undefined;

  let first: number | null = null;
  let done: number | null = null;
  const decoder = new TextDecoder();
  let buffer = "";
  const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
  read: while (true) {
    const { value, done: eof } = await reader.read();
    if (eof) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const raw = buffer.slice(0, nl).replace(ANSI, "").replace(/\r$/, "");
      buffer = buffer.slice(nl + 1);
      const m = (command.projectLine ?? PROJECT_LINE).exec(raw);
      if (!m) continue;
      const now = performance.now();
      first ??= now;
      result.lines.push(m[1]);
      if (suite.isDone(m[1])) {
        done = now;
        break read;
      }
    }
  }
  reader.cancel().catch(() => {});

  if (done !== null) {
    killGroup(proc.pid, "SIGTERM");
    await Promise.race([proc.exited, sleep(3000)]);
  }
  killGroup(proc.pid, "SIGKILL");
  const code = await proc.exited;
  clearTimeout(timer);
  clearInterval(memoryWatch);
  unregister();
  result.exit_code = code;
  try {
    const usage = proc.resourceUsage();
    if (usage) {
      result.peak_rss_mb = Math.round((usage.maxRSS / 1024 / 1024) * 10) / 10;
    }
  } catch {}

  if (done === null) {
    result.error = outOfMemory
      ? `stopped after a process used more than ${MEMORY_LIMIT_MB} MB of memory`
      : timedOut
      ? `timed out after ${timeoutMs / 1000}s`
      : `exited (code ${code}) before the suite finished${
        stderrTail
          ? `: ${stderrTail.trim().split("\n").slice(-3).join(" | ")}`
          : ""
      }`;
    return result;
  }
  result.ok = true;
  result.startup_ms = round(first! - start);
  result.run_ms = round(done - first!);
  result.wall_ms = round(done - start);
  return result;
};

const round = (x: number) => Math.round(x * 10) / 10;

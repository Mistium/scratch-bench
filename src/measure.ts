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

const killGroup = (pid: number, signal: NodeJS.Signals) => {
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
      const m = PROJECT_LINE.exec(raw);
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
  unregister();
  result.exit_code = code;
  try {
    const usage = proc.resourceUsage();
    if (usage) {
      result.peak_rss_mb = Math.round((usage.maxRSS / 1024 / 1024) * 10) / 10;
    }
  } catch {}

  if (done === null) {
    result.error = timedOut
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

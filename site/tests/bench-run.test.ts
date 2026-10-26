import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { benchStatus, startBenchRun } from "../server/utils/bench-run.ts";

const fake = path.resolve(import.meta.dirname, "fixtures/fake-bench.mjs");
let dir: string;

const waitFor = async (check: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 25));
  }
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bench-run-"));
  process.env.BENCH_RESULTS_DIR = path.join(dir, "results");
  process.env.BENCH_REPO_DIR = dir;
  process.env.BENCH_COMMAND = `node ${fake}`;
  delete process.env.FAKE_EXIT;
  delete process.env.FAKE_MS;
});
afterEach(() => {
  for (
    const k of [
      "BENCH_RESULTS_DIR",
      "BENCH_REPO_DIR",
      "BENCH_COMMAND",
      "BENCH_TIMEOUT_MIN",
      "FAKE_EXIT",
      "FAKE_MS",
    ]
  ) delete process.env[k];
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("benchStatus", () => {
  it("is idle with no history before anything has run", () => {
    const s = benchStatus("0 3 * * *");
    expect(s.running).toBe(false);
    expect(s.lastRun).toBeNull();
    expect(s.schedule).toBe("0 3 * * *");
    expect(s.nextRun).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it("copes with an invalid or missing schedule", () => {
    expect(benchStatus("not a cron").nextRun).toBeNull();
    expect(benchStatus(null).nextRun).toBeNull();
  });
});

describe("startBenchRun", () => {
  it("runs the command into a new results directory and records the outcome", async () => {
    const r = startBenchRun("manual");
    expect(r.started).toBe(true);
    await waitFor(() =>
      !benchStatus(null).running && benchStatus(null).lastRun !== null
    );
    const s = benchStatus(null);
    expect(s.lastRun?.ok).toBe(true);
    expect(s.lastRun?.message).toBe("completed");
    if (r.started) {
      expect(fs.existsSync(path.join(r.outDir, "meta.json"))).toBe(true);
    }
    expect(
      fs.existsSync(path.join(process.env.BENCH_RESULTS_DIR!, ".bench.lock")),
    ).toBe(false);
  });

  it("refuses to start a second run while one is going", async () => {
    process.env.FAKE_MS = "800";
    expect(startBenchRun("schedule").started).toBe(true);
    expect(benchStatus(null).running).toBe(true);
    const second = startBenchRun("manual");
    expect(second.started).toBe(false);
    if (!second.started) expect(second.reason).toMatch(/already in progress/);
    await waitFor(() => !benchStatus(null).running);
    expect(startBenchRun("manual").started).toBe(true);
    await waitFor(() => !benchStatus(null).running);
  });

  it("reports a failing run without throwing", async () => {
    process.env.FAKE_EXIT = "1";
    startBenchRun("manual");
    await waitFor(() => benchStatus(null).lastRun !== null);
    const s = benchStatus(null);
    expect(s.lastRun?.ok).toBe(false);
    expect(s.lastRun?.message).toMatch(/exit code 1/);
  });

  it("reports a command that cannot be started", async () => {
    process.env.BENCH_COMMAND = "definitely-not-a-real-binary";
    startBenchRun("manual");
    await waitFor(() => benchStatus(null).lastRun !== null);
    expect(benchStatus(null).lastRun?.message).toMatch(/could not start/);
    expect(benchStatus(null).running).toBe(false);
  });

  it("stops a run that exceeds its time limit", async () => {
    process.env.FAKE_MS = "30000";
    process.env.BENCH_TIMEOUT_MIN = String(0.02);
    startBenchRun("manual");
    await waitFor(() => benchStatus(null).lastRun !== null, 8000);
    expect(benchStatus(null).lastRun?.ok).toBe(false);
    expect(benchStatus(null).lastRun?.message).toMatch(/stopped by SIGTERM/);
  });

  it("clears a stale lock left by a process that no longer exists", () => {
    const results = process.env.BENCH_RESULTS_DIR!;
    fs.mkdirSync(results, { recursive: true });
    fs.writeFileSync(
      path.join(results, ".bench.lock"),
      JSON.stringify({
        pid: 2 ** 22 + 12345,
        startedAt: new Date().toISOString(),
      }),
    );
    expect(benchStatus(null).running).toBe(false);
    expect(fs.existsSync(path.join(results, ".bench.lock"))).toBe(false);
  });
});

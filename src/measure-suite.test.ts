import { expect, test } from "bun:test";
import { measureSuite } from "./measure-suite.ts";
import type { Suite } from "./suites.ts";

const suite: Suite = {
  id: "performance",
  source: "x",
  launcher: "headless",
  runs: 3,
  isDone: (l) => l.includes("DONE"),
  parse: () => ({}),
};

test("a timed-out run ends the measuring instead of spending a timeout on every run left", async () => {
  const started = Date.now();
  const m = await measureSuite(suite, { command: () => ({ cmd: ["sleep", "30"] }) }, "unused.sb3", {
    runs: 3,
    timeoutMs: 300,
    displayKind: "x11",
  });
  expect(m.runs.length).toBe(1);
  expect(m.runs[0]!.error).toMatch(/^timed out/);
  expect(Date.now() - started).toBeLessThan(5000);
});

import { expect, test } from "bun:test";
import { combineReplays } from "./measure-suite.ts";

const run = (frames: number, checkpoints: Record<number, number>, extra = {}) => ({
  script_ms: checkpoints[frames] ?? 0,
  draw_ms: 1,
  wall_ms: 2,
  frames,
  recorded_frames: 300,
  drifted: 0,
  hash: "aaaa0000",
  checkpoints,
  ...extra,
});

test("combineReplays takes medians, on the checkpoints every run reached", () => {
  const r = combineReplays([
    run(300, { 1: 2, 30: 40, 300: 500 }),
    run(250, { 1: 3, 30: 44, 250: 470 }),
    run(300, { 1: 1, 30: 42, 300: 520 }),
  ]) as any;
  expect(r.frames).toBe(250);
  expect(r.checkpoints).toEqual({ 1: 2, 30: 42 });
  expect(r.script_ms.median).toBe(500);
  expect(r.hash).toBe("aaaa0000");
});

test("combineReplays marks a hash that changed between runs, and fails on a failed run", () => {
  expect((combineReplays([run(300, { 300: 5 }), run(300, { 300: 5 }, { hash: "bbbb1111" })]) as any).hash)
    .toBe("mixed");
  expect(combineReplays([run(300, { 300: 5 }), { error: "a frame didn't finish" }]))
    .toEqual({ error: "a frame didn't finish" });
  expect(combineReplays([], "timed out after 70s")).toEqual({ error: "timed out after 70s" });
});

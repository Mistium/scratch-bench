import { expect, test } from "bun:test";
import { combineReplays } from "./measure-suite.ts";

const run = (frames: number, checkpoints: Record<number, number>, extra = {}) => ({
  frame_ms: checkpoints[frames] ?? 0,
  script_ms: 1,
  draw_ms: 2,
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
  ], 3) as any;
  expect(r.frames).toBe(250);
  expect(r.checkpoints).toEqual({ 1: 2, 30: 42 });
  expect(r.frame_ms.median).toBe(500);
  // Stopped at different frames, so their hashes cover different work.
  expect(r.hash).toBeNull();
  expect((combineReplays([run(300, { 300: 5 }), run(300, { 300: 6 })], 2) as any).hash).toBe("aaaa0000");
});

test("combineReplays marks a hash that changed between runs, and fails on a failed run", () => {
  expect((combineReplays([run(300, { 300: 5 }), run(300, { 300: 5 }, { hash: "bbbb1111" })], 2) as any).hash)
    .toBe("mixed");
  expect(combineReplays([run(300, { 300: 5 }), { error: "a frame didn't finish" }], 2))
    .toEqual({ error: "a frame didn't finish" });
  // A run that crashed before printing a result.
  expect(combineReplays([run(300, { 300: 5 }), run(300, { 300: 5 })], 3, "timed out after 70s"))
    .toEqual({ error: "timed out after 70s" });
  expect(combineReplays([], 3, "timed out after 70s")).toEqual({ error: "timed out after 70s" });
});

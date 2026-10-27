import { describe, expect, test } from "bun:test";
import { runOnce } from "./measure.ts";
import type { Suite } from "./suites.ts";

const suite = {
  id: "x",
  isDone: (l: string) => l === "DONE",
} as unknown as Suite;
const node = (script: string) => ["node", "-e", script];

describe("runOnce", () => {
  test("reads [PROJECT] lines by default and stops at the end marker", async () => {
    const r = await runOnce(
      {
        cmd: node(
          'console.log("noise");console.log("[PROJECT] a");console.log("[PROJECT] DONE");setTimeout(()=>{},60000)',
        ),
      },
      suite,
      20_000,
    );
    expect(r.ok).toBe(true);
    expect(r.lines).toEqual(["a", "DONE"]);
  });

  test("a command's own line pattern replaces the marker", async () => {
    const r = await runOnce(
      {
        cmd: node(
          'console.log("status line");console.log("Stage: a | 1");console.log("Sprite1: DONE");setTimeout(()=>{},60000)',
        ),
        projectLine: /^[^:|\[\]]+: (.*)$/,
      },
      suite,
      20_000,
    );
    expect(r.ok).toBe(true);
    expect(r.lines).toEqual(["a | 1", "DONE"]);
  });
});

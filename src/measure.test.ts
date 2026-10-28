import { describe, expect, test } from "bun:test";
import { errorSummary, runOnce } from "./measure.ts";
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

test("a failure's summary keeps its error message, not the end of its stack trace", () => {
  const pm = `/x/thread.js:506
            const block = this.target.blocks.getBlock(this.stackFrames[i].op.id) ||
                                                                             ^

TypeError: Cannot read properties of null (reading 'id')
    at Thread.isRecursiveCall (/x/thread.js:506:78)
    at listOnTimeout (node:internal/timers:685:17)

Node.js v24.22.1`;
  expect(errorSummary(pm)).toBe("TypeError: Cannot read properties of null (reading 'id')");
  const webpack = `Browserslist: caniuse-lite is outdated. Please run:
  npx update-browserslist-db@latest
Error: Cannot find module 'babel-loader'
Require stack:
- /x/webpack.config.js
  requireStack: [ '/x/webpack.config.js' ]`;
  expect(errorSummary(webpack)).toStartWith("Error: Cannot find module 'babel-loader'");
});

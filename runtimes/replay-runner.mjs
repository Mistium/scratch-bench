// What the browser runners (chromium-vm.mjs, forkphorus.mjs) share when they replay a recording.
import fs from "fs";

/** How long a frame may still run after the budget before the replay is cut there. */
export const LATE_MS = 3_000;
const CHECKPOINTS = [1, 2, 3, 5, 8, 13, 20, 30, 50, 80, 120, 200, 300, 500, 800];

const ms = (x) => Math.round(x * 10) / 10;

/**
 * Replays in the page with `run` (which calls its `window.replay`) and prints the result line and
 * DONE, then exits.
 *
 * The page checks its budget between frames, so a frame that doesn't end (a script that would never
 * finish, or one a runtime is too slow to finish) would keep it going past the recording's length.
 * LATE_MS after the budget, counted from the first frame, the replay is cut: it reports the frames
 * up to its last checkpoint, and the next checkpoint as reached no sooner than LATE_MS more of
 * script time later. The frame started before the budget ran out and has run since, so that is a
 * bound the runtime would only have done worse than: compared there, it is scored no lower than it
 * deserves, rather than left out (which would score it on only the projects it can manage).
 */
export const replayInPage = async (page, { recording, replayId, budgetMs }, run) => {
  const recorded = JSON.parse(fs.readFileSync(recording, "utf8")).frames;
  const marks = [];
  let last = { frame: 0, frameMs: 0, scriptMs: 0, drawMs: 0, drifted: 0 };
  let stuck;
  page.on("console", (m) => {
    const text = m.text();
    if (text.startsWith("[REPLAY] checkpoint ")) {
      const [frame, frameMs, scriptMs, drawMs, drifted] = text.split(" ").slice(2).map(Number);
      last = { frame, frameMs, scriptMs, drawMs, drifted };
      marks.push(`${frame}:${ms(scriptMs)}`);
    }
    if (text !== "[REPLAY] frames start") return;
    stuck = setTimeout(() => {
      const next = CHECKPOINTS.find((f) => f > last.frame) ?? recorded;
      const bound = `${next}:${ms(last.scriptMs + LATE_MS)}`;
      console.log(
        `[PROJECT] ${replayId} | ${ms(last.scriptMs + LATE_MS)} | ${ms(last.drawMs)} | ${ms(budgetMs + LATE_MS)} | ${last.frame}/${recorded} | ${last.drifted} | unfinished | ${[...marks, bound].join(",")}`,
      );
      console.log("[PROJECT] DONE");
      process.exit(1);
    }, budgetMs + LATE_MS);
  });
  const line = await run().catch((e) => `${replayId} | error | ${String(e.message).split("\n")[0]}`);
  clearTimeout(stuck);
  console.log(`[PROJECT] ${line}`);
  console.log("[PROJECT] DONE");
};
